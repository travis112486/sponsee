import { db } from "@sponsee/db";
import { chaseEvents, invoiceChaseState, activityEvents, invoiceDeliveries } from "@sponsee/db/schema";
import { eq } from "drizzle-orm";
import { createEmailProvider } from "../email/index.js";
import type { Context } from "hono";

/**
 * Handle inbound webhooks from email providers (Postmark, Resend).
 * Mounted at /api/webhooks/email/:provider
 */
export async function handleEmailWebhook(c: Context) {
  const providerName = c.req.param("provider");

  // Read raw body for signature verification
  const rawBody = await c.req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!payload) {
    return c.json({ error: "Empty payload" }, 400);
  }

  const provider = createEmailProvider(providerName);

  // Every provider that emits webhooks MUST implement signature verification.
  // Reject requests from providers that do not support it (e.g. mailpit).
  if (typeof provider.verifyWebhookSignature !== "function") {
    return c.json({ error: "Provider does not support webhook verification" }, 401);
  }

  const headers: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const valid = provider.verifyWebhookSignature(rawBody, headers);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 401);
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
    // Not a chase event — correlate against an invoice delivery (SPO-364). The
    // invoice email is a separate send from a chase, so its provider message ID
    // lives on invoice_deliveries, not chase_events.
    const [delivery] = await db
      .select()
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.providerMessageId, event.providerMessageId))
      .limit(1);

    if (delivery) {
      const now = event.timestamp || new Date();

      switch (event.type) {
        case "delivered":
          await db
            .update(invoiceDeliveries)
            .set({ status: "delivered", deliveredAt: now, updatedAt: now })
            .where(eq(invoiceDeliveries.id, delivery.id));
          break;
        case "opened":
          // Opening implies delivery. The status enum has no "opened", so
          // back-fill delivered only if a delivered event never arrived.
          await db
            .update(invoiceDeliveries)
            .set({
              openedAt: now,
              ...(delivery.deliveredAt ? {} : { deliveredAt: now, status: "delivered" }),
              updatedAt: now,
            })
            .where(eq(invoiceDeliveries.id, delivery.id));
          break;
        case "bounced": {
          // Persist the provider's reason on the row, not just in the activity
          // payload (SPO-433) — the Payments bounce line needs it to tell a
          // retryable "mailbox full" apart from a "no such user" that makes
          // Resend a trap. `?? null` rather than leaving it undefined: Drizzle
          // omits undefined keys from the UPDATE, which would strand a stale
          // reason from an earlier bounce on the same row. Blank detail is
          // normalized to null so the UI falls back instead of rendering "".
          const bounceDetail = event.detail?.trim() || null;
          await db
            .update(invoiceDeliveries)
            .set({ status: "bounced", bouncedAt: now, bounceDetail, updatedAt: now })
            .where(eq(invoiceDeliveries.id, delivery.id));

          // Loud: a bounced invoice is the same failure as no delivery. The
          // activity event mirrors the chase-bounce shape so the timeline
          // surfaces it the same way (SPO-365).
          const invoice = await db.query.invoices.findFirst({
            where: (i, { eq }) => eq(i.id, delivery.invoiceId),
          });
          if (invoice) {
            await db.insert(activityEvents).values({
              creatorId: invoice.creatorId,
              actor: "system",
              entityType: "invoice",
              entityId: invoice.id,
              kind: "invoice_sent",
              payload: {
                status: "bounced",
                providerMessageId: event.providerMessageId,
                detail: event.detail,
                alert: "Invoice email bounced — delivery failed",
              },
            });
          }
          break;
        }
      }

      return c.json({ ok: true, handled: true, type: event.type }, 200);
    }

    return c.json({ ok: true, matched: false }, 200);
  }

  const now = event.timestamp || new Date();

  // Update chase event status
  switch (event.type) {
    case "delivered":
      await db
        .update(chaseEvents)
        .set({ status: "delivered", deliveredAt: now, updatedAt: now })
        .where(eq(chaseEvents.id, chaseEvent.id));
      break;
    case "opened":
      await db
        .update(chaseEvents)
        .set({ status: "opened", openedAt: now, updatedAt: now })
        .where(eq(chaseEvents.id, chaseEvent.id));
      break;
    case "bounced": {
      await db
        .update(chaseEvents)
        .set({ status: "bounced", bouncedAt: now, updatedAt: now })
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
        .set({ status: "failed", updatedAt: now })
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
