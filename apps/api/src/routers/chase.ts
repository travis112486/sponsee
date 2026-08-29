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
      if (chaseEvent.status === "approved") {
        // Idempotent repeat: the first approve already claimed the event and
        // enqueued the send job. Return success instead of erroring so a
        // double-click never surfaces a spurious failure (the job layer's
        // atomic claim + pg-boss singletonKey already prevent a second message).
        return { success: true, queued: true, alreadyQueued: true };
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
        .set({ status: "approved", updatedAt: new Date() })
        .where(and(eq(chaseEvents.id, input.chaseEventId), eq(chaseEvents.status, "awaiting_review")))
        .returning();

      if (!claimed) {
        throw new TRPCError({ code: "CONFLICT", message: "Event already claimed or processed" });
      }

      const fromEmail = process.env.CHASE_FROM_EMAIL || "chase@sponsee.app";
      const replyToEmail = ctx.session.user.email || fromEmail;
      const idempotencyKey = chaseEvent.idempotencyKey || `invoice:${event.invoices.id}:step:${chaseEvent.step}`;

      // Enqueue durable send job (singletonKey guarantees idempotency within the TTL)
      const boss = await getBoss();
      try {
        await boss.send(CHASE_SEND_JOB, {
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
        });
      } catch (enqueueErr) {
        // Revert status so the creator can retry approval; do not strand in approved
        await ctx.db
          .update(chaseEvents)
          .set({ status: "awaiting_review", updatedAt: new Date() })
          .where(eq(chaseEvents.id, input.chaseEventId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to queue chase email. Please retry.",
          cause: enqueueErr,
        });
      }

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
        .set({ status: "approved", subjectSnapshot: input.subject, bodySnapshot: input.body, updatedAt: new Date() })
        .where(and(eq(chaseEvents.id, input.chaseEventId), eq(chaseEvents.status, "awaiting_review")))
        .returning();

      if (!claimed) {
        throw new TRPCError({ code: "CONFLICT", message: "Event already claimed or processed" });
      }

      const fromEmail = process.env.CHASE_FROM_EMAIL || "chase@sponsee.app";
      const replyToEmail = ctx.session.user.email || fromEmail;
      const idempotencyKey = chaseEvent.idempotencyKey || `invoice:${event.invoices.id}:step:${chaseEvent.step}`;

      const boss = await getBoss();
      try {
        await boss.send(CHASE_SEND_JOB, {
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
        });
      } catch (enqueueErr) {
        // Revert status so the creator can retry; snapshots are preserved
        await ctx.db
          .update(chaseEvents)
          .set({ status: "awaiting_review", updatedAt: new Date() })
          .where(eq(chaseEvents.id, input.chaseEventId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to queue chase email. Please retry.",
          cause: enqueueErr,
        });
      }

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
