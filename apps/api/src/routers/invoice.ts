import { randomBytes } from "crypto";
import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql } from "drizzle-orm";
import type { DB } from "@sponsee/db";
import {
  invoices,
  invoiceChaseState,
  invoiceDeliveries,
  deals,
  contacts,
  brands,
  creators,
  activityEvents,
} from "@sponsee/db/schema";
import { createEmailProvider } from "../email/index.js";
import { resolveCreatorReplyToEmail } from "../email/reply-to.js";
import { calculateNextActionAt } from "../jobs/chase-tick.js";
import { clientIp } from "../client-ip.js";
import { SlidingWindowLimiter } from "../rate-limit.js";

const PAID_REQUIRES_PAID_AT_CONSTRAINT = "invoices_paid_requires_paid_at";

// The hosted invoice view (`invoice.publicView`, keyed on
// `invoice_deliveries.public_token`) is the only unauthenticated read of tenant
// data in the product. It gets its own limiter rather than the auth bucket: the
// auth limiter is a single global bucket, so sharing it would let a brand's
// reload of their invoice lock creators out of login. Keyed per client IP so one
// AP team's legitimate reloads can't starve another's view, and a distinct-token
// burst from a single source still shares one budget (the enumeration oracle the
// limit exists to close).
export const INVOICE_VIEW_MAX_PER_WINDOW = 30;
export const INVOICE_VIEW_WINDOW_MS = 60 * 1000;
export const invoiceViewLimiter = new SlidingWindowLimiter(
  INVOICE_VIEW_MAX_PER_WINDOW,
  INVOICE_VIEW_WINDOW_MS
);

type RailsSnapshot = {
  displayName: string | null;
  paypalLink: string | null;
  wiseText: string | null;
  bankText: string | null;
};

/**
 * Resolve the brand-side recipient for an invoice at send time: the
 * invoice's own contact first, falling back to the deal's primary contact.
 * Mirrors resolveChaseRecipient in chase.ts — kept as a separate,
 * invoice-scoped copy rather than a shared import so this router does not
 * reach into the chase router's file.
 *
 * Read-only and unscoped by tenant, same as its chase.ts counterpart: safe by
 * construction because every writer of invoices.contactId /
 * deals.primaryContactId already tenant-validates its input (SPO-347
 * lineage) before this ever reads it.
 */
async function resolveInvoiceRecipientEmail(
  db: DB,
  invoice: { contactId: string | null; dealId: string | null }
): Promise<string | null> {
  if (invoice.contactId) {
    const contact = await db.query.contacts.findFirst({
      where: (c, { eq }) => eq(c.id, invoice.contactId!),
    });
    if (contact?.email) return contact.email;
  }

  if (invoice.dealId) {
    const deal = await db.query.deals.findFirst({
      where: (d, { eq }) => eq(d.id, invoice.dealId!),
    });
    if (deal?.primaryContactId) {
      const contact = await db.query.contacts.findFirst({
        where: (c, { eq }) => eq(c.id, deal.primaryContactId!),
      });
      if (contact?.email) return contact.email;
    }
  }

  return null;
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatInvoiceDate(date: Date, style: "short" | "long" = "short"): string {
  return date.toLocaleDateString("en-US", {
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Plain-text invoice body. This is the only body a brand's AP inbox is
 * guaranteed to render — many strip HTML and images — so it must carry the
 * full invoice, not a "view it online" stub. The Product Designer refines
 * the HTML companion separately (SPO-358 item 5).
 */
function buildInvoiceText(args: {
  invoice: typeof invoices.$inferSelect;
  invoiceLabel: string;
  rails: RailsSnapshot;
  hostedInvoiceUrl: string;
}): string {
  const { invoice, invoiceLabel, rails, hostedInvoiceUrl } = args;
  const amount = formatCents(invoice.amountCents, invoice.currency);
  const dueDate = invoice.dueAt
    ? formatInvoiceDate(new Date(invoice.dueAt))
    : "on receipt";

  const railLines = [
    rails.paypalLink ? `PayPal: ${rails.paypalLink}` : null,
    rails.wiseText ? `Wise: ${rails.wiseText}` : null,
    rails.bankText ? `Bank transfer: ${rails.bankText}` : null,
  ].filter((line): line is string => line !== null);

  return [
    `Invoice ${invoiceLabel}`,
    invoice.title || null,
    "",
    `Amount due: ${amount}`,
    `Due date: ${dueDate}`,
    "",
    "Payment details:",
    ...(railLines.length > 0 ? railLines : ["Contact the sender for payment instructions."]),
    "",
    `From: ${rails.displayName || "your creator partner"}`,
    "",
    `View invoice online: ${hostedInvoiceUrl}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/**
 * Did this update fail the DB-level status='paid' <=> paidAt not-null invariant?
 *
 * The router-level guards in `update` reject the input shapes they can decide
 * from the input alone (`paidAt` with no `status`, in either direction) and
 * normalize paidAt whenever `status` is provided, so no input to this
 * mutation can itself request an inconsistent row. The CHECK is now a
 * biconditional (SPO-273), so it is enforced on every column, not just the
 * ones this mutation touches: an `update` on an unrelated field (e.g.
 * `title`) against a row that is already inconsistent — a legacy row, or one
 * written by some other path that bypasses these guards — still reaches
 * Postgres and fails the `invoices_paid_requires_paid_at` CHECK. Catching
 * that here turns it into a typed BAD_REQUEST instead of a 500 that carries
 * the raw query in `error.message`.
 */
function isPaidInvariantViolation(error: unknown): boolean {
  const cause = (error as { cause?: { constraint?: string } } | undefined)?.cause;
  return cause?.constraint === PAID_REQUIRES_PAID_AT_CONSTRAINT;
}

export const invoiceRouter = createTRPCRouter({
  list: creatorScopedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(invoices)
      .where(eq(invoices.creatorId, ctx.creatorId))
      .orderBy(desc(invoices.createdAt));
  }),

  // One row per invoice — the latest send attempt only (SPO-365). The
  // Payments list renders a delivery chip per row and needs this in one
  // round trip, not N+1 queries per invoice. `invoice_deliveries.status`
  // has no "opened" member (see webhooks.ts) — callers derive Opened from
  // `openedAt` themselves.
  latestDeliveries: creatorScopedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        invoiceId: invoiceDeliveries.invoiceId,
        attempt: invoiceDeliveries.attempt,
        status: invoiceDeliveries.status,
        toEmail: invoiceDeliveries.toEmail,
        sentAt: invoiceDeliveries.sentAt,
        deliveredAt: invoiceDeliveries.deliveredAt,
        openedAt: invoiceDeliveries.openedAt,
        bouncedAt: invoiceDeliveries.bouncedAt,
      })
      .from(invoiceDeliveries)
      .innerJoin(invoices, eq(invoiceDeliveries.invoiceId, invoices.id))
      .where(eq(invoices.creatorId, ctx.creatorId))
      .orderBy(invoiceDeliveries.invoiceId, desc(invoiceDeliveries.attempt));

    const latestByInvoice = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latestByInvoice.has(row.invoiceId)) {
        latestByInvoice.set(row.invoiceId, row);
      }
    }
    return Array.from(latestByInvoice.values());
  }),

  listByDeal: creatorScopedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.dealId, input.dealId), eq(invoices.creatorId, ctx.creatorId)))
        .orderBy(desc(invoices.createdAt));
    }),

  // The one unauthenticated read of tenant data in the product. The response
  // shape is a security boundary, not a convenience: pick every field by hand
  // and never spread the invoice/delivery row, so a future column cannot leak
  // the creator's email, contacts, deal pipeline, or other invoices.
  publicView: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ ctx, input }) => {
      const ip = clientIp(ctx.headers) ?? "unknown";
      const decision = invoiceViewLimiter.check(ip);
      if (!decision.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      }

      // Single resolve path on purpose (SPO-364): a wrong token, a rotated
      // token, and a deleted invoice (whose deliveries cascade away) all miss
      // this lookup and produce the identical 404. No token-format early return
      // before the query — that would leak which tokens once existed.
      const [row] = await ctx.db
        .select({
          number: invoices.number,
          title: invoices.title,
          milestoneNote: invoices.milestoneNote,
          amountCents: invoices.amountCents,
          currency: invoices.currency,
          terms: invoices.terms,
          issuedAt: invoices.issuedAt,
          dueAt: invoices.dueAt,
          railsSnapshot: invoices.railsSnapshot,
          status: invoices.status,
        })
        .from(invoiceDeliveries)
        .innerJoin(invoices, eq(invoiceDeliveries.invoiceId, invoices.id))
        .where(eq(invoiceDeliveries.publicToken, input.token))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const rails = (row.railsSnapshot ?? {}) as Partial<RailsSnapshot>;

      return {
        invoiceNumber: row.number,
        title: row.title,
        milestoneNote: row.milestoneNote,
        amountCents: row.amountCents,
        currency: row.currency,
        terms: row.terms,
        issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
        dueAt: row.dueAt ? row.dueAt.toISOString() : null,
        railsSnapshot: {
          displayName: rails.displayName ?? null,
          paypalLink: rails.paypalLink ?? null,
          wiseText: rails.wiseText ?? null,
          bankText: rails.bankText ?? null,
        },
        creatorDisplayName: rails.displayName ?? null,
        paid: row.status === "paid",
      };
    }),

  create: creatorScopedProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        contactId: z.string().uuid().optional(),
        title: z.string().max(512).optional(),
        amountCents: z.number().int().min(0),
        currency: z.string().length(3).default("USD"),
        terms: z.enum(["net_15", "net_30", "net_45"]).default("net_30"),
        dueAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify deal ownership
      const [deal] = await ctx.db
        .select()
        .from(deals)
        .where(and(eq(deals.id, input.dealId), eq(deals.creatorId, ctx.creatorId)));
      if (!deal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
      }

      // Verify contact ownership if provided
      if (input.contactId) {
        const [contact] = await ctx.db
          .select()
          .from(contacts)
          .innerJoin(brands, eq(contacts.brandId, brands.id))
          .where(
            and(eq(contacts.id, input.contactId), eq(brands.creatorId, ctx.creatorId))
          );
        if (!contact) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
        }
      }

      // Get next invoice number for creator
      const [{ max }] = await ctx.db
        .select({ max: sql<number>`COALESCE(MAX(${invoices.number}), 0)` })
        .from(invoices)
        .where(eq(invoices.creatorId, ctx.creatorId));

      const [invoice] = await ctx.db
        .insert(invoices)
        .values({
          ...input,
          creatorId: ctx.creatorId,
          number: max + 1,
          status: "open",
        })
        .returning();

      // Chase arms on invoice.send, not here (SPO-363) — chasing an invoice
      // that was never delivered is worse than not chasing. No
      // invoiceChaseState row is written until the first successful send.

      return invoice;
    }),

  send: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.creatorId, ctx.creatorId)));

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      if (invoice.status !== "draft" && invoice.status !== "open") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot send an invoice that is ${invoice.status}.`,
        });
      }

      // Re-resolve the recipient at send time, not from a value captured at
      // create (SPO-347 lesson applied to a second send path): the contact
      // may not have existed yet, or may have changed since.
      const toEmail = await resolveInvoiceRecipientEmail(ctx.db, invoice);
      if (!toEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Add an email for this invoice's contact (or the deal's primary contact) before sending.",
        });
      }

      // Unlike chase — machine-authored, so it logs a warning and falls back
      // to the platform address — an invoice is the creator's own document.
      // A brand replying to it must reach a human, so a missing owner email
      // refuses the send outright instead of silently defaulting to the
      // shared platform inbox.
      const replyToEmail = await resolveCreatorReplyToEmail(ctx.creatorId);
      if (!replyToEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This workspace has no owner email on file; add one before sending invoices.",
        });
      }

      const fromEmail =
        process.env.INVOICE_FROM_EMAIL || process.env.CHASE_FROM_EMAIL || "invoices@sponsee.app";

      const [creator] = await ctx.db.select().from(creators).where(eq(creators.id, ctx.creatorId));
      const rails: RailsSnapshot = {
        displayName: creator?.displayName ?? null,
        paypalLink: creator?.paypalLink ?? null,
        wiseText: creator?.wiseText ?? null,
        bankText: creator?.bankText ?? null,
      };

      const [{ maxAttempt }] = await ctx.db
        .select({ maxAttempt: sql<number>`COALESCE(MAX(${invoiceDeliveries.attempt}), 0)` })
        .from(invoiceDeliveries)
        .where(eq(invoiceDeliveries.invoiceId, invoice.id));
      const attempt = maxAttempt + 1;
      const idempotencyKey = `invoice:${invoice.id}:delivery:${attempt}`;
      const publicToken = randomBytes(16).toString("hex"); // 128 bits

      const invoiceLabel = `INV-${String(invoice.number).padStart(4, "0")}`;
      const subject = `Invoice ${invoiceLabel} from ${rails.displayName || "your creator partner"}`;
      const hostedInvoiceUrl = new URL(
        `/i/${publicToken}`,
        process.env.WEB_URL || "https://sponsee.app",
      ).toString();
      const text = buildInvoiceText({ invoice, invoiceLabel, rails, hostedInvoiceUrl });

      // Claim the attempt before calling the provider. The unique index on
      // (invoice_id, attempt) — and on idempotency_key — means a concurrent
      // second call for the same attempt fails right here, before it can
      // reach the provider and send a duplicate email.
      let delivery: typeof invoiceDeliveries.$inferSelect;
      try {
        [delivery] = await ctx.db
          .insert(invoiceDeliveries)
          .values({
            invoiceId: invoice.id,
            attempt,
            toEmail,
            fromEmail,
            replyToEmail,
            subjectSnapshot: subject,
            textSnapshot: text,
            publicToken,
            idempotencyKey,
            status: "queued",
          })
          .returning();
      } catch (error) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A send for this invoice is already in progress. Please retry.",
          cause: error,
        });
      }

      let providerMessageId: string;
      try {
        const info = await createEmailProvider().send({
          to: toEmail,
          from: fromEmail,
          replyTo: replyToEmail,
          subject,
          text,
          metadata: { idempotencyKey, tags: ["invoice"] },
        });
        providerMessageId = info.providerMessageId;
      } catch (error) {
        await ctx.db
          .update(invoiceDeliveries)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(invoiceDeliveries.id, delivery.id));

        // Only reachable on a resend: the chase arms below, after a send that
        // succeeded. So a failure here can leave an armed chase on an invoice
        // whose latest send never left — same asymmetry as the bounce webhook,
        // and the Payments lock line makes the same promise for both. Stopping
        // is the safe direction; the creator re-arms with Resume once a resend
        // gets through. Scoped to armed so a completed or manually paused
        // sequence is left as the creator left it.
        await ctx.db
          .update(invoiceChaseState)
          .set({ mode: "paused", pausedReason: "invoice_send_failed", updatedAt: new Date() })
          .where(
            and(
              eq(invoiceChaseState.invoiceId, invoice.id),
              eq(invoiceChaseState.mode, "armed")
            )
          );
        throw error;
      }

      await ctx.db
        .update(invoiceDeliveries)
        .set({ status: "sent", providerMessageId, sentAt: new Date(), updatedAt: new Date() })
        .where(eq(invoiceDeliveries.id, delivery.id));

      // rails_snapshot freezes at send and is never rewritten by a later
      // settings edit. draft -> open on first delivery; already-open invoices
      // (the only status invoice.create currently produces) are left alone.
      await ctx.db
        .update(invoices)
        .set({
          railsSnapshot: rails,
          status: invoice.status === "draft" ? "open" : invoice.status,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoice.id));

      // Chase arms on send, not on create (SPO-363). onConflictDoNothing so a
      // resend never clobbers a creator's pause or an already-armed state.
      const nextActionAt = await calculateNextActionAt(invoice, 1);
      await ctx.db
        .insert(invoiceChaseState)
        .values({ invoiceId: invoice.id, mode: "armed", nextStep: 1, nextActionAt })
        .onConflictDoNothing({ target: invoiceChaseState.invoiceId });

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "invoice",
        entityId: invoice.id,
        kind: "invoice_sent",
        payload: { attempt, toEmail, providerMessageId },
      });

      return { success: true, deliveryId: delivery.id, publicToken, attempt };
    }),

  update: creatorScopedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(512).optional().nullable(),
        amountCents: z.number().int().min(0).optional(),
        status: z.enum(["draft", "open", "paid", "void"]).optional(),
        paidAt: z.date().optional().nullable(),
        paidNote: z.string().optional().nullable(),
        contactId: z.string().uuid().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Verify contact ownership when the caller sets it (mirrors create). Zod
      // strips unknown keys silently, so a repair attempt referencing a
      // cross-tenant contact must be rejected loudly, never silently dropped.
      if (data.contactId) {
        const [contact] = await ctx.db
          .select()
          .from(contacts)
          .innerJoin(brands, eq(contacts.brandId, brands.id))
          .where(
            and(eq(contacts.id, data.contactId), eq(brands.creatorId, ctx.creatorId))
          );
        if (!contact) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
        }
      }

      // `paidAt` with no `status` is undecidable from the input alone, in both
      // directions, so both are rejected rather than resolved by reading the row.
      // The 0014 CHECK (SPO-273) is now biconditional and owns the invariant at
      // the schema layer for every writer, not just this mutation; these two
      // guards are belt-and-braces — they exist to reject a bad input shape
      // early with a typed, actionable message instead of surfacing the CHECK
      // violation as a BAD_REQUEST with a generic message (see
      // isPaidInvariantViolation below).
      //
      // `paidAt: null` (SPO-260): on a paid invoice it would strand status='paid'
      // with a null paidAt. On a non-paid one it is a no-op — either way the
      // intent is better expressed as status: "open".
      if (data.paidAt === null && data.status === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: 'Set "status" to change whether an invoice is paid; "paidAt" alone cannot clear it.',
        });
      }

      // `paidAt: <date>` (SPO-265): the mirror image. It would silently write
      // paid_at onto a draft/open/void invoice. The intent is better expressed
      // as status: "paid" (which may carry an explicit paidAt alongside it to
      // backdate the payment).
      if (data.paidAt != null && data.status === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: 'Set "status" to "paid" to mark an invoice paid; "paidAt" alone cannot do it.',
        });
      }

      // Keep status='paid' <=> paidAt IS NOT NULL atomic: callers may set either
      // field independently, so this mutation must not be able to produce a
      // paid invoice with no paidAt (or a non-paid invoice with a stale one).
      if (data.status === "paid" && data.paidAt == null) {
        data.paidAt = new Date();
      } else if (data.status !== undefined && data.status !== "paid") {
        data.paidAt = null;
      }

      let invoice;
      try {
        [invoice] = await ctx.db
          .update(invoices)
          .set({ ...data, updatedAt: new Date() })
          .where(and(eq(invoices.id, id), eq(invoices.creatorId, ctx.creatorId)))
          .returning();
      } catch (error) {
        if (isPaidInvariantViolation(error)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That update would leave a paid invoice without a paid date.",
          });
        }
        throw error;
      }

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      return invoice;
    }),

  markPaid: creatorScopedProcedure
    .input(z.object({ id: z.string().uuid(), paidNote: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .update(invoices)
        .set({ status: "paid", paidAt: new Date(), paidNote: input.paidNote, updatedAt: new Date() })
        .where(and(eq(invoices.id, input.id), eq(invoices.creatorId, ctx.creatorId)))
        .returning();

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      // Complete chase state
      await ctx.db
        .update(invoiceChaseState)
        .set({ mode: "completed", updatedAt: new Date() })
        .where(eq(invoiceChaseState.invoiceId, input.id));

      return invoice;
    }),
});
