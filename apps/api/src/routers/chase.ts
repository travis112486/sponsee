import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  chaseTemplates,
  invoiceChaseState,
  chaseEvents,
  invoices,
  activityEvents,
} from "@sponsee/db/schema";
import { sendChaseEmail } from "../jobs/chase-tick.js";
import { TRPCError } from "@trpc/server";

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
      return template;
    }),

  // ── Chase state per invoice ──
  state: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [state] = await ctx.db
        .select()
        .from(invoiceChaseState)
        .where(eq(invoiceChaseState.invoiceId, input.invoiceId));
      return state || null;
    }),

  pause: creatorScopedProcedure
    .input(z.object({ invoiceId: z.string().uuid(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
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
        .where(eq(chaseEvents.id, input.chaseEventId));

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Chase event not found" });
      }

      // Security: ensure the invoice belongs to this creator
      const invoice = event.invoices;
      if (invoice.creatorId !== ctx.creatorId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const chaseEvent = event.chase_events;
      if (chaseEvent.status !== "awaiting_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Event is ${chaseEvent.status}` });
      }

      if (!chaseEvent.toEmail) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No recipient email configured" });
      }

      const fromEmail = process.env.CHASE_FROM_EMAIL || "chase@sponsee.app";
      const replyToEmail = ctx.session.user.email || fromEmail;

      // Idempotent send
      const info = await sendChaseEmail({
        chaseEventId: chaseEvent.id,
        invoiceId: invoice.id,
        step: chaseEvent.step,
        toEmail: chaseEvent.toEmail,
        fromEmail,
        replyToEmail,
        subject: chaseEvent.subjectSnapshot || "",
        body: chaseEvent.bodySnapshot || "",
        idempotencyKey: chaseEvent.idempotencyKey || `invoice:${invoice.id}:step:${chaseEvent.step}`,
      });

      // Write activity event
      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "invoice",
        entityId: invoice.id,
        kind: "chase_sent",
        payload: {
          step: chaseEvent.step,
          status: "sent",
          providerMessageId: info.providerMessageId,
          action: "approve",
        },
      });

      return { success: true, providerMessageId: info.providerMessageId };
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
        .where(eq(chaseEvents.id, input.chaseEventId));

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Chase event not found" });
      }

      const invoice = event.invoices;
      if (invoice.creatorId !== ctx.creatorId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const chaseEvent = event.chase_events;
      if (chaseEvent.status !== "awaiting_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Event is ${chaseEvent.status}` });
      }

      if (!chaseEvent.toEmail) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No recipient email configured" });
      }

      // Update snapshot with user's edits
      await ctx.db
        .update(chaseEvents)
        .set({ subjectSnapshot: input.subject, bodySnapshot: input.body })
        .where(eq(chaseEvents.id, input.chaseEventId));

      const fromEmail = process.env.CHASE_FROM_EMAIL || "chase@sponsee.app";
      const replyToEmail = ctx.session.user.email || fromEmail;

      const info = await sendChaseEmail({
        chaseEventId: chaseEvent.id,
        invoiceId: invoice.id,
        step: chaseEvent.step,
        toEmail: chaseEvent.toEmail,
        fromEmail,
        replyToEmail,
        subject: input.subject,
        body: input.body,
        idempotencyKey: chaseEvent.idempotencyKey || `invoice:${invoice.id}:step:${chaseEvent.step}`,
      });

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "invoice",
        entityId: invoice.id,
        kind: "chase_sent",
        payload: {
          step: chaseEvent.step,
          status: "sent",
          providerMessageId: info.providerMessageId,
          action: "edit_and_send",
        },
      });

      return { success: true, providerMessageId: info.providerMessageId };
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
