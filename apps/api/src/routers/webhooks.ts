import { db } from "@sponsee/db";
import { chaseEvents, invoiceChaseState, activityEvents } from "@sponsee/db/schema";
import { eq } from "drizzle-orm";
import { createEmailProvider } from "../email/index.js";
import type { Context } from "hono";

/**
 * Handle inbound webhooks from email providers (Postmark, Resend).
 * Mounted at /api/webhooks/email/:provider
 */
export async function handleEmailWebhook(c: Context) {
  const providerName = c.req.param("provider");
  const payload = await c.req.json().catch(() => null);

  if (!payload) {
    return c.json({ error: "Empty payload" }, 400);
  }

  const provider = createEmailProvider();
  if (provider.name !== providerName) {
    // If the configured provider doesn't match the webhook path, still try to
    // ingest with the path's provider type for safety. In practice we create
    // the provider that matches the env; for multi-provider setups this would
    // need a registry.
    console.warn(`[webhook] Provider mismatch: path=${providerName}, config=${provider.name}`);
  }

  const event = provider.ingestWebhook(payload);
  if (!event) {
    return c.json({ ok: true, handled: false }, 200);
  }

  // Find the chase event by provider message ID
  const [chaseEvent] = await db
    .select()
    .from(chaseEvents)
    .where(eq(chaseEvents.providerMessageId, event.providerMessageId))
    .limit(1);

  if (!chaseEvent) {
    return c.json({ ok: true, matched: false }, 200);
  }

  const now = event.timestamp || new Date();

  // Update chase event status
  switch (event.type) {
    case "delivered":
      await db
        .update(chaseEvents)
        .set({ status: "delivered", deliveredAt: now })
        .where(eq(chaseEvents.id, chaseEvent.id));
      break;
    case "opened":
      await db
        .update(chaseEvents)
        .set({ status: "opened", openedAt: now })
        .where(eq(chaseEvents.id, chaseEvent.id));
      break;
    case "bounced": {
      await db
        .update(chaseEvents)
        .set({ status: "bounced", bouncedAt: now })
        .where(eq(chaseEvents.id, chaseEvent.id));

      // Hard bounce → pause chase state (loud alert)
      await db
        .update(invoiceChaseState)
        .set({ mode: "paused", pausedReason: "hard_bounce", updatedAt: now })
        .where(eq(invoiceChaseState.invoiceId, chaseEvent.invoiceId));

      // Fetch invoice for activity
      const invoice = await db.query.invoices.findFirst({
        where: (i, { eq }) => eq(i.id, chaseEvent.invoiceId),
      });

      if (invoice) {
        await db.insert(activityEvents).values({
          creatorId: invoice.creatorId,
          actor: "system",
          entityType: "invoice",
          entityId: invoice.id,
          kind: "chase_sent",
          payload: {
            step: chaseEvent.step,
            status: "bounced",
            providerMessageId: event.providerMessageId,
            detail: event.detail,
            alert: "Chase paused due to hard bounce",
          },
        });
      }
      break;
    }
    case "failed": {
      await db
        .update(chaseEvents)
        .set({ status: "failed" })
        .where(eq(chaseEvents.id, chaseEvent.id));

      const invoice = await db.query.invoices.findFirst({
        where: (i, { eq }) => eq(i.id, chaseEvent.invoiceId),
      });

      if (invoice) {
        await db.insert(activityEvents).values({
          creatorId: invoice.creatorId,
          actor: "system",
          entityType: "invoice",
          entityId: invoice.id,
          kind: "chase_sent",
          payload: {
            step: chaseEvent.step,
            status: "failed",
            providerMessageId: event.providerMessageId,
            detail: event.detail,
          },
        });
      }
      break;
    }
    case "complained": {
      const invoice = await db.query.invoices.findFirst({
        where: (i, { eq }) => eq(i.id, chaseEvent.invoiceId),
      });

      if (invoice) {
        await db.insert(activityEvents).values({
          creatorId: invoice.creatorId,
          actor: "system",
          entityType: "invoice",
          entityId: invoice.id,
          kind: "chase_sent",
          payload: {
            step: chaseEvent.step,
            status: "complained",
            providerMessageId: event.providerMessageId,
            alert: "Spam complaint received",
          },
        });
      }
      break;
    }
  }

  return c.json({ ok: true, handled: true, type: event.type }, 200);
}
