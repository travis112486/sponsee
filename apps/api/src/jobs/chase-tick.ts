import { eq, and, or, sql, isNotNull, isNull } from "drizzle-orm";
import { db } from "@sponsee/db";
import {
  invoices,
  chaseTemplates,
  invoiceChaseState,
  chaseEvents,
  activityEvents,
} from "@sponsee/db/schema";
import { renderMergeTokens } from "@sponsee/shared";
import { createEmailProvider } from "../email/index.js";
import { resolveCreatorReplyToEmail } from "../email/reply-to.js";
import { getBoss } from "./boss.js";

export { resolveCreatorReplyToEmail };

const STEP_NAMES: Record<number, string> = {
  1: "Friendly reminder",
  2: "Second notice",
  3: "Final notice",
};

/**
 * Chase tick: finds armed invoices whose next step is due and creates
 * awaiting_review chase_events. Called by the 15-min cron job.
 */
export async function runChaseTick(): Promise<number> {
  const now = new Date();

  // Find armed chase states whose next action time has passed
  const dueStates = await db
    .select({
      state: invoiceChaseState,
      invoice: invoices,
    })
    .from(invoiceChaseState)
    .innerJoin(invoices, eq(invoiceChaseState.invoiceId, invoices.id))
    .where(
      and(
        eq(invoiceChaseState.mode, "armed"),
        eq(invoices.status, "open"),
        sql`${invoiceChaseState.nextStep} <= 3`,
        isNotNull(invoiceChaseState.nextActionAt),
        sql`${invoiceChaseState.nextActionAt} <= ${now}`
      )
    );

  let created = 0;

  for (const { state, invoice } of dueStates) {
    const step = state.nextStep;
    if (!step || step > 3) continue;

    // Fetch template for this creator + step
    const [template] = await db
      .select()
      .from(chaseTemplates)
      .where(and(eq(chaseTemplates.creatorId, invoice.creatorId), eq(chaseTemplates.step, step)));

    if (!template || !template.enabled) {
      // Template missing or disabled — skip this step and advance to next
      await db
        .update(invoiceChaseState)
        .set({
          nextStep: step + 1,
          nextActionAt: await calculateNextActionAt(invoice, step + 1),
          updatedAt: now,
        })
        .where(eq(invoiceChaseState.invoiceId, invoice.id));
      continue;
    }

    // Check if an event for this step already exists in a non-terminal state
    const [existing] = await db
      .select({ count: sql<number>`count(*)` })
      .from(chaseEvents)
      .where(and(eq(chaseEvents.invoiceId, invoice.id), eq(chaseEvents.step, step)));

    if (existing && existing.count > 0) {
      // Already queued/reviewed/sent for this step — advance
      await db
        .update(invoiceChaseState)
        .set({
          nextStep: step + 1,
          nextActionAt: await calculateNextActionAt(invoice, step + 1),
          updatedAt: now,
        })
        .where(eq(invoiceChaseState.invoiceId, invoice.id));
      continue;
    }

    // Resolve contact + deal context for merge tokens
    const contact = invoice.contactId
      ? await db.query.contacts.findFirst({
          where: (c, { eq }) => eq(c.id, invoice.contactId!),
        })
      : null;

    const deal = invoice.dealId
      ? await db.query.deals.findFirst({
          where: (d, { eq }) => eq(d.id, invoice.dealId!),
        })
      : null;

    const brand = deal?.brandId
      ? await db.query.brands.findFirst({
          where: (b, { eq }) => eq(b.id, deal.brandId!),
        })
      : null;

    const creator = await db.query.creators.findFirst({
      where: (c, { eq }) => eq(c.id, invoice.creatorId),
    });

    const daysLate = invoice.dueAt
      ? Math.max(0, Math.floor((now.getTime() - new Date(invoice.dueAt).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    const mergeCtx = {
      brandContact: contact?.name || "there",
      brand: brand?.name || "your team",
      dealTitle: deal?.title || "our partnership",
      invoiceId: `INV-${String(invoice.number).padStart(4, "0")}`,
      amount: formatCents(invoice.amountCents, invoice.currency),
      dueDate: invoice.dueAt
        ? new Date(invoice.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "—",
      daysLate,
      creatorName: creator?.displayName || "",
    };

    const subject = renderMergeTokens(template.subject, mergeCtx);
    const body = renderMergeTokens(template.body, mergeCtx);

    // Create awaiting_review event
    await db.insert(chaseEvents).values({
      invoiceId: invoice.id,
      step,
      subjectSnapshot: subject,
      bodySnapshot: body,
      toEmail: contact?.email || null,
      status: "awaiting_review",
      idempotencyKey: `invoice:${invoice.id}:step:${step}`,
      queuedAt: now,
    });

    // Update chase state: advance step and set next action time
    await db
      .update(invoiceChaseState)
      .set({
        nextStep: step + 1,
        nextActionAt: await calculateNextActionAt(invoice, step + 1),
        updatedAt: now,
      })
      .where(eq(invoiceChaseState.invoiceId, invoice.id));

    // Write activity event
    await db.insert(activityEvents).values({
      creatorId: invoice.creatorId,
      actor: "system",
      entityType: "invoice",
      entityId: invoice.id,
      kind: "chase_sent",
      payload: {
        step,
        status: "awaiting_review",
        subject,
        toEmail: contact?.email,
        note: `Step ${step} (${STEP_NAMES[step]}) queued for review`,
      },
    });

    created++;
  }

  // One creator can own several rescued events in a single tick, so memoize the
  // owner lookup rather than repeating it per event.
  const replyToByCreator = new Map<string, string | null>();
  async function replyToFor(creatorId: string, fromEmail: string): Promise<string> {
    if (!replyToByCreator.has(creatorId)) {
      replyToByCreator.set(creatorId, await resolveCreatorReplyToEmail(creatorId));
    }
    const ownerEmail = replyToByCreator.get(creatorId) ?? null;
    if (!ownerEmail) {
      console.warn(
        `[chase-tick] No owner email for creator ${creatorId}; brand replies will go to ${fromEmail} instead of the creator`
      );
      return fromEmail;
    }
    return ownerEmail;
  }

  // ── Rescue: approved events that were stranded before enqueue ──
  // enqueuedAt is the durable proof that a send job reached the queue, so only
  // events missing it can actually be stranded.
  const stranded = await db
    .select()
    .from(chaseEvents)
    .where(
      and(
        eq(chaseEvents.status, "approved"),
        isNull(chaseEvents.enqueuedAt),
        isNull(chaseEvents.sentAt),
        sql`${chaseEvents.updatedAt} < NOW() - INTERVAL '5 minutes'`
      )
    );

  if (stranded.length > 0) {
    const boss = await getBoss();
    for (const event of stranded) {
      const invoice = await db.query.invoices.findFirst({
        where: (i, { eq }) => eq(i.id, event.invoiceId),
      });
      if (!invoice) continue;

      const fromEmail = process.env.CHASE_FROM_EMAIL || "chase@sponsee.app";
      const replyToEmail = await replyToFor(invoice.creatorId, fromEmail);
      const idempotencyKey =
        event.idempotencyKey || `invoice:${event.invoiceId}:step:${event.step}`;

      const jobId = await boss.send(
        "chase-send",
        {
          chaseEventId: event.id,
          invoiceId: event.invoiceId,
          step: event.step,
          toEmail: event.toEmail || "",
          fromEmail,
          replyToEmail,
          subject: event.subjectSnapshot || "",
          body: event.bodySnapshot || "",
          idempotencyKey,
        },
        {
          singletonKey: idempotencyKey,
          singletonSeconds: 3600,
          retryLimit: 3,
          retryDelay: 30,
          retryBackoff: true,
        }
      );

      // Record the enqueue so the next tick does not rescue this event again.
      await db
        .update(chaseEvents)
        .set({ enqueuedAt: new Date(), sendJobId: jobId ?? null })
        .where(eq(chaseEvents.id, event.id));
    }
  }

  // ── Rescue: sending events that never recorded a providerMessageId ──
  // After 30 minutes we assume the worker died; mark failed so retries or
  // manual review can proceed.  Normal sends complete in seconds.
  const strandedSending = await db
    .select()
    .from(chaseEvents)
    .where(
      and(
        eq(chaseEvents.status, "sending"),
        isNull(chaseEvents.providerMessageId),
        sql`${chaseEvents.updatedAt} < NOW() - INTERVAL '30 minutes'`
      )
    );

  if (strandedSending.length > 0) {
    const boss = await getBoss();
    for (const event of strandedSending) {
      await db
        .update(chaseEvents)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(chaseEvents.id, event.id));

      // Re-enqueue so the retry worker can pick it up.
      // singletonKey deduplicates against any surviving original job.
      const invoice = await db.query.invoices.findFirst({
        where: (i, { eq }) => eq(i.id, event.invoiceId),
      });
      if (!invoice) continue;

      const fromEmail = process.env.CHASE_FROM_EMAIL || "chase@sponsee.app";
      const replyToEmail = await replyToFor(invoice.creatorId, fromEmail);
      const idempotencyKey =
        event.idempotencyKey || `invoice:${event.invoiceId}:step:${event.step}`;

      await boss.send(
        "chase-send",
        {
          chaseEventId: event.id,
          invoiceId: event.invoiceId,
          step: event.step,
          toEmail: event.toEmail || "",
          fromEmail,
          replyToEmail,
          subject: event.subjectSnapshot || "",
          body: event.bodySnapshot || "",
          idempotencyKey,
        },
        {
          singletonKey: idempotencyKey,
          singletonSeconds: 3600,
          retryLimit: 3,
          retryDelay: 30,
          retryBackoff: true,
        }
      );
    }
  }

  return created;
}

/**
 * Idempotent send: called by the chase-send pg-boss job.
 * On provider failure, updates the event to failed and re-throws so pg-boss retries.
 */
export async function sendChaseEmail(args: {
  chaseEventId: string;
  invoiceId: string;
  step: number;
  toEmail: string;
  fromEmail: string;
  replyToEmail: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}): Promise<{ providerMessageId: string }> {
  // Resolve the provider before the atomic claim. The factory is pure config
  // resolution (it reads env vars and constructs a provider instance) with no
  // database state, so a config error throws while the event is still
  // `approved` and pg-boss retries it cleanly — instead of stranding it in
  // `sending` (or burning the claim to mark it `failed`) for a mere
  // misconfiguration.
  const provider = createEmailProvider();

  // Atomic claim: only `approved` or `failed` may transition to `sending`.
  // A `sending` event is NEVER reclaimed here; stranded sends are rescued
  // periodically by runChaseTick after a staleness threshold.
  const [claimed] = await db
    .update(chaseEvents)
    .set({ status: "sending", updatedAt: new Date() })
    .where(
      and(
        eq(chaseEvents.id, args.chaseEventId),
        or(eq(chaseEvents.status, "approved"), eq(chaseEvents.status, "failed"))
      )
    )
    .returning();

  if (!claimed) {
    // Another worker got it; return existing result if already sent
    const [existing] = await db
      .select({ status: chaseEvents.status, providerMessageId: chaseEvents.providerMessageId })
      .from(chaseEvents)
      .where(eq(chaseEvents.id, args.chaseEventId))
      .limit(1);

    if (existing?.status === "sent" && existing.providerMessageId) {
      return { providerMessageId: existing.providerMessageId };
    }

    // Previous attempt sent successfully but DB status update failed.
    // providerMessageId is already recorded; just flip status to sent.
    if (existing?.status === "sending" && existing.providerMessageId) {
      await db
        .update(chaseEvents)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(chaseEvents.id, args.chaseEventId));
      return { providerMessageId: existing.providerMessageId };
    }

    throw new Error(
      `Chase event ${args.chaseEventId} is not in approved/failed state or is already being processed`
    );
  }

  try {
    const info = await provider.send({
      to: args.toEmail,
      from: args.fromEmail,
      replyTo: args.replyToEmail,
      subject: args.subject,
      text: args.body,
      metadata: {
        idempotencyKey: args.idempotencyKey,
        tags: ["chase", `step-${args.step}`],
      },
    });

    // Single atomic write: providerMessageId + sent status together.
    // If this UPDATE fails, the retry will see a `sending` event with no
    // providerMessageId and will be blocked until the stranded-send rescue
    // marks it failed (or the provider's idempotency key makes the retry safe).
    await db
      .update(chaseEvents)
      .set({
        providerMessageId: info.providerMessageId,
        status: "sent",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(chaseEvents.id, args.chaseEventId));

    // Write activity event (best-effort after delivery truth is recorded)
    const invoice = await db.query.invoices.findFirst({
      where: (i, { eq }) => eq(i.id, args.invoiceId),
    });
    if (invoice) {
      await db.insert(activityEvents).values({
        creatorId: invoice.creatorId,
        actor: "system",
        entityType: "invoice",
        entityId: invoice.id,
        kind: "chase_sent",
        payload: {
          step: args.step,
          status: "sent",
          providerMessageId: info.providerMessageId,
        },
      });
    }

    return info;
  } catch (err) {
    // Record failure only if providerMessageId was not yet written.
    // If it WAS written, the send succeeded and a retry will promote to sent.
    const [existing] = await db
      .select({ providerMessageId: chaseEvents.providerMessageId })
      .from(chaseEvents)
      .where(eq(chaseEvents.id, args.chaseEventId))
      .limit(1);

    if (!existing?.providerMessageId) {
      await db
        .update(chaseEvents)
        .set({
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(chaseEvents.id, args.chaseEventId));
    }

    throw err;
  }
}

export async function calculateNextActionAt(invoice: typeof invoices.$inferSelect, nextStep: number): Promise<Date | null> {
  if (nextStep > 3) return null;

  // Look up the template offset for this step
  const [template] = await db
    .select()
    .from(chaseTemplates)
    .where(and(eq(chaseTemplates.creatorId, invoice.creatorId), eq(chaseTemplates.step, nextStep)));

  if (!template || !template.enabled) return null;

  const baseDate = invoice.dueAt ? new Date(invoice.dueAt) : new Date(invoice.issuedAt);
  const next = new Date(baseDate.getTime() + template.offsetDays * 24 * 60 * 60 * 1000);
  return next;
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
