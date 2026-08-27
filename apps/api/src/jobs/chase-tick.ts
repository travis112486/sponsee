import { eq, and, or, sql, isNotNull } from "drizzle-orm";
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
  // Atomic claim: only one worker can move approved|failed -> sending
  const [claimed] = await db
    .update(chaseEvents)
    .set({ status: "sending" })
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
    throw new Error(
      `Chase event ${args.chaseEventId} is not in approved state or already being processed`
    );
  }

  const provider = createEmailProvider();

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

    // Update chase event to sent
    await db
      .update(chaseEvents)
      .set({
        status: "sent",
        providerMessageId: info.providerMessageId,
        sentAt: new Date(),
      })
      .where(eq(chaseEvents.id, args.chaseEventId));

    // Write activity event
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
    // Record failure so it surfaces in the timeline / dead-letter view
    await db
      .update(chaseEvents)
      .set({
        status: "failed",
        providerMessageId: null,
      })
      .where(eq(chaseEvents.id, args.chaseEventId));

    throw err;
  }
}

async function calculateNextActionAt(invoice: typeof invoices.$inferSelect, nextStep: number): Promise<Date | null> {
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
