import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  chaseTemplates,
  invoiceChaseState,
  chaseEvents,
  invoices,
  activityEvents,
} from "@sponsee/db/schema";
import { getBoss } from "../jobs/boss.js";
import { TRPCError } from "@trpc/server";

const CHASE_SEND_JOB = "chase-send";

// `status = approved` is claimed atomically *before* boss.send() resolves, and
// is reverted if that enqueue fails. So an overlapping request that merely sees
// `approved` has no idea whether a durable job exists yet. It waits for the
// in-flight winner to resolve (enqueuedAt written, or status reverted) instead
// of reporting a "queued" it cannot vouch for.
const APPROVE_INFLIGHT_TIMEOUT_MS = 3000;
const APPROVE_INFLIGHT_POLL_MS = 25;

// Statuses only reachable after the chase-send job was picked up off the queue,
// which itself proves the enqueue succeeded durably.
const POST_ENQUEUE_STATUSES = new Set(["sending", "sent", "delivered", "opened"]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const chaseRouter = createTRPCRouter({
  // ── Templates ──
  templates: creatorScopedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(chaseTemplates)
      .where(eq(chaseTemplates.creatorId, ctx.creatorId))
      .orderBy(chaseTemplates.step);
  }),

  updateTemplate: creatorScopedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        subject: z.string().optional(),
        body: z.string().optional(),
        offsetDays: z.number().int().min(0).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [template] = await ctx.db
        .update(chaseTemplates)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(chaseTemplates.id, id), eq(chaseTemplates.creatorId, ctx.creatorId)))
        .returning();

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }

      return template;
    }),

  // ── Chase state per invoice ──
  state: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.creatorId, ctx.creatorId)));

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      const [state] = await ctx.db
        .select()
        .from(invoiceChaseState)
        .where(eq(invoiceChaseState.invoiceId, input.invoiceId));
      return state || null;
    }),

  pause: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.creatorId, ctx.creatorId)));

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      await ctx.db
        .update(invoiceChaseState)
        .set({ mode: "paused", pausedReason: input.reason || "manual", updatedAt: new Date() })
        .where(eq(invoiceChaseState.invoiceId, input.invoiceId));

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "invoice",
        entityId: input.invoiceId,
        kind: "chase_sent",
        payload: { action: "pause", reason: input.reason || "manual" },
      });

      return { success: true };
    }),

  resume: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.creatorId, ctx.creatorId)));

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      await ctx.db
        .update(invoiceChaseState)
        .set({ mode: "armed", pausedReason: null, updatedAt: new Date() })
        .where(eq(invoiceChaseState.invoiceId, input.invoiceId));

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "invoice",
        entityId: input.invoiceId,
        kind: "chase_sent",
        payload: { action: "resume" },
      });

      return { success: true };
    }),

  // ── Events timeline ──
  events: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.creatorId, ctx.creatorId)));

      if (!invoice) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      }

      return ctx.db
        .select()
        .from(chaseEvents)
        .where(eq(chaseEvents.invoiceId, input.invoiceId))
        .orderBy(desc(chaseEvents.createdAt));
    }),

  // ── Awaiting review queue (new) ──
  awaitingReview: creatorScopedProcedure.query(async ({ ctx }) => {
    // Find all open invoices for this creator that have awaiting_review chase events
    const creatorInvoices = await ctx.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.creatorId, ctx.creatorId), eq(invoices.status, "open")));

    const invoiceIds = creatorInvoices.map((i) => i.id);
    if (invoiceIds.length === 0) return [];

    return ctx.db
      .select({
        event: chaseEvents,
        invoice: invoices,
      })
      .from(chaseEvents)
      .innerJoin(invoices, eq(chaseEvents.invoiceId, invoices.id))
      .where(and(inArray(chaseEvents.invoiceId, invoiceIds), eq(chaseEvents.status, "awaiting_review")))
      .orderBy(desc(chaseEvents.createdAt));
  }),

  // ── Approve and send (new) ──
  approve: creatorScopedProcedure
    .input(z.object({ chaseEventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const inflightDeadline = Date.now() + APPROVE_INFLIGHT_TIMEOUT_MS;

      // Re-read on every attempt: a concurrent approve can claim the event, then
      // either finish its enqueue (durable) or fail and hand the event back.
      for (;;) {
        const [event] = await ctx.db
          .select()
          .from(chaseEvents)
          .innerJoin(invoices, eq(chaseEvents.invoiceId, invoices.id))
          .where(
            and(
              eq(chaseEvents.id, input.chaseEventId),
              eq(invoices.creatorId, ctx.creatorId)
            )
          );

        if (!event) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Chase event not found" });
        }

        const chaseEvent = event.chase_events;

        // The worker already pulled the job off the queue — the enqueue is proven.
        if (POST_ENQUEUE_STATUSES.has(chaseEvent.status)) {
          return { success: true, queued: true, alreadyQueued: true };
        }

        if (chaseEvent.status === "approved") {
          if (chaseEvent.enqueuedAt) {
            // Idempotent repeat: a previous approve durably enqueued the send
            // job, so a double-click never surfaces a spurious failure (the job
            // layer's atomic claim + pg-boss singletonKey prevent a second message).
            return { success: true, queued: true, alreadyQueued: true };
          }

          // Claimed, but the winner's boss.send() has not resolved yet. Reporting
          // "queued" here would be a lie if that enqueue then fails and reverts
          // the event. Wait for the winner to settle one way or the other.
          if (Date.now() >= inflightDeadline) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "An approval for this chase email is still being queued. Please retry.",
            });
          }
          await sleep(APPROVE_INFLIGHT_POLL_MS);
          continue;
        }

        if (chaseEvent.status !== "awaiting_review") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Event is ${chaseEvent.status}` });
        }

        if (!chaseEvent.toEmail) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No recipient email configured" });
        }

        // Atomic claim: only one request can move from awaiting_review -> approved
        const [claimed] = await ctx.db
          .update(chaseEvents)
          .set({ status: "approved", enqueuedAt: null, sendJobId: null, updatedAt: new Date() })
          .where(and(eq(chaseEvents.id, input.chaseEventId), eq(chaseEvents.status, "awaiting_review")))
          .returning();

        if (!claimed) {
          // Lost the claim to an overlapping request; loop to resolve against
          // that winner's actual enqueue outcome rather than guessing.
          if (Date.now() >= inflightDeadline) {
            throw new TRPCError({ code: "CONFLICT", message: "Event already claimed or processed" });
          }
          continue;
        }

        const fromEmail = process.env.CHASE_FROM_EMAIL || "chase@sponsee.app";
        const replyToEmail = ctx.session.user.email || fromEmail;
        const idempotencyKey = chaseEvent.idempotencyKey || `invoice:${event.invoices.id}:step:${chaseEvent.step}`;

        // Enqueue durable send job (singletonKey guarantees idempotency within the TTL)
        const boss = await getBoss();
        let jobId: string | null = null;
        try {
          jobId = (await boss.send(CHASE_SEND_JOB, {
            chaseEventId: chaseEvent.id,
            invoiceId: event.invoices.id,
            step: chaseEvent.step,
            toEmail: chaseEvent.toEmail,
            fromEmail,
            replyToEmail,
            subject: chaseEvent.subjectSnapshot || "",
            body: chaseEvent.bodySnapshot || "",
            idempotencyKey,
          }, {
            singletonKey: idempotencyKey,
            singletonSeconds: 3600,
            retryLimit: 3,
            retryDelay: 30,
            retryBackoff: true,
          })) ?? null;
        } catch (enqueueErr) {
          // Revert status so the creator can retry approval; do not strand in
          // approved. Scoped to `approved` so we never clobber a worker that has
          // already moved the row on.
          await ctx.db
            .update(chaseEvents)
            .set({ status: "awaiting_review", updatedAt: new Date() })
            .where(and(eq(chaseEvents.id, input.chaseEventId), eq(chaseEvents.status, "approved")));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to queue chase email. Please retry.",
            cause: enqueueErr,
          });
        }

        // Durable, observable proof of the enqueue. Status is deliberately not
        // touched here: the worker may already have advanced it to sending/sent.
        await ctx.db
          .update(chaseEvents)
          .set({ enqueuedAt: new Date(), sendJobId: jobId, updatedAt: new Date() })
          .where(eq(chaseEvents.id, input.chaseEventId));

        // Write activity event for approval
        await ctx.db.insert(activityEvents).values({
          creatorId: ctx.creatorId,
          actor: "creator",
          entityType: "invoice",
          entityId: event.invoices.id,
          kind: "chase_sent",
          payload: {
            step: chaseEvent.step,
            status: "approved",
            action: "approve",
          },
        });

        return { success: true, queued: true };
      }
    }),

  // ── Edit and send (new) ──
  editAndSend: creatorScopedProcedure
    .input(
      z.object({
        chaseEventId: z.string().uuid(),
        subject: z.string().min(1).max(998),
        body: z.string().min(1).max(50000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [event] = await ctx.db
        .select()
        .from(chaseEvents)
        .innerJoin(invoices, eq(chaseEvents.invoiceId, invoices.id))
        .where(
          and(
            eq(chaseEvents.id, input.chaseEventId),
            eq(invoices.creatorId, ctx.creatorId)
          )
        );

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Chase event not found" });
      }

      const chaseEvent = event.chase_events;
      if (chaseEvent.status !== "awaiting_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Event is ${chaseEvent.status}` });
      }

      if (!chaseEvent.toEmail) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No recipient email configured" });
      }

      // Atomic edit + claim: combine snapshot update with status transition so a
      // losing concurrent request cannot overwrite subject/body after the winner claims.
      const [claimed] = await ctx.db
        .update(chaseEvents)
        .set({
          status: "approved",
          subjectSnapshot: input.subject,
          bodySnapshot: input.body,
          enqueuedAt: null,
          sendJobId: null,
          updatedAt: new Date(),
        })
        .where(and(eq(chaseEvents.id, input.chaseEventId), eq(chaseEvents.status, "awaiting_review")))
        .returning();

      if (!claimed) {
        throw new TRPCError({ code: "CONFLICT", message: "Event already claimed or processed" });
      }

      const fromEmail = process.env.CHASE_FROM_EMAIL || "chase@sponsee.app";
      const replyToEmail = ctx.session.user.email || fromEmail;
      const idempotencyKey = chaseEvent.idempotencyKey || `invoice:${event.invoices.id}:step:${chaseEvent.step}`;

      const boss = await getBoss();
      let jobId: string | null = null;
      try {
        jobId = (await boss.send(CHASE_SEND_JOB, {
          chaseEventId: chaseEvent.id,
          invoiceId: event.invoices.id,
          step: chaseEvent.step,
          toEmail: chaseEvent.toEmail,
          fromEmail,
          replyToEmail,
          subject: input.subject,
          body: input.body,
          idempotencyKey,
        }, {
          singletonKey: idempotencyKey,
          singletonSeconds: 3600,
          retryLimit: 3,
          retryDelay: 30,
          retryBackoff: true,
        })) ?? null;
      } catch (enqueueErr) {
        // Revert status so the creator can retry; snapshots are preserved
        await ctx.db
          .update(chaseEvents)
          .set({ status: "awaiting_review", updatedAt: new Date() })
          .where(and(eq(chaseEvents.id, input.chaseEventId), eq(chaseEvents.status, "approved")));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to queue chase email. Please retry.",
          cause: enqueueErr,
        });
      }

      // Same durable enqueue marker the approve path writes, so a follow-up
      // approve() on this event resolves immediately instead of waiting on a
      // winner that already finished.
      await ctx.db
        .update(chaseEvents)
        .set({ enqueuedAt: new Date(), sendJobId: jobId, updatedAt: new Date() })
        .where(eq(chaseEvents.id, input.chaseEventId));

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "invoice",
        entityId: event.invoices.id,
        kind: "chase_sent",
        payload: {
          step: chaseEvent.step,
          status: "approved",
          action: "edit_and_send",
        },
      });

      return { success: true, queued: true };
    }),

  // ── Dead letter / failed events (new) ──
  failedEvents: creatorScopedProcedure.query(async ({ ctx }) => {
    const creatorInvoices = await ctx.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.creatorId, ctx.creatorId));

    const invoiceIds = creatorInvoices.map((i) => i.id);
    if (invoiceIds.length === 0) return [];

    return ctx.db
      .select()
      .from(chaseEvents)
      .where(and(inArray(chaseEvents.invoiceId, invoiceIds), eq(chaseEvents.status, "failed")))
      .orderBy(desc(chaseEvents.createdAt));
  }),
});
