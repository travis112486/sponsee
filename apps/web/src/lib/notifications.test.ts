import { describe, it, expect } from "vitest";
import {
  buildNotifications,
  countUnread,
  readWatermark,
  type ActivityEventLike,
  type InvoiceLike,
} from "./notifications";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function activityEvent(overrides: Partial<ActivityEventLike> = {}): ActivityEventLike {
  return {
    id: "a1",
    actor: "system",
    entityType: "invoice",
    entityId: "inv-1",
    payload: { status: "sent", step: 1 },
    createdAt: "2026-03-10T09:00:00.000Z",
    ...overrides,
  };
}

function invoice(overrides: Partial<InvoiceLike> = {}): InvoiceLike {
  return {
    id: "i1",
    number: 7,
    status: "open",
    dueAt: "2026-03-01T00:00:00.000Z",
    createdAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildNotifications", () => {
  it("returns nothing when there is no activity and no overdue invoice", () => {
    expect(buildNotifications({ activity: [], invoices: [], now: NOW })).toEqual([]);
  });

  it("tolerates undefined queries that have not resolved yet", () => {
    expect(buildNotifications({ now: NOW })).toEqual([]);
  });

  it("describes activity events with the shared activity label", () => {
    const [n] = buildNotifications({ activity: [activityEvent()], now: NOW });
    expect(n.title).toBe("Chase step 1 sent");
    expect(n.tone).toBe("default");
  });

  it("surfaces open invoices past their due date as alerts", () => {
    const [n] = buildNotifications({ invoices: [invoice()], now: NOW });
    expect(n.title).toBe("Invoice #7 is overdue");
    expect(n.tone).toBe("alert");
    expect(n.href).toBe("/payments");
    expect(n.at).toBe("2026-03-01T00:00:00.000Z");
  });

  it("ignores invoices that are not open or not yet due", () => {
    const items = buildNotifications({
      invoices: [
        invoice({ id: "paid", status: "paid" }),
        invoice({ id: "draft", status: "draft" }),
        invoice({ id: "no-due", dueAt: null }),
        invoice({ id: "future", dueAt: "2026-04-01T00:00:00.000Z" }),
      ],
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it("timestamps a backdated overdue invoice at creation, not its due date", () => {
    // Created today with a due date last month — it became notification-worthy
    // now, so it must not arrive already older than the read watermark.
    const [n] = buildNotifications({
      invoices: [
        invoice({ dueAt: "2026-02-01T00:00:00.000Z", createdAt: "2026-03-10T11:00:00.000Z" }),
      ],
      now: NOW,
    });
    expect(n.at).toBe("2026-03-10T11:00:00.000Z");
  });

  it("links deal activity to the deal and leaves ambiguous entities unlinked", () => {
    const items = buildNotifications({
      activity: [
        activityEvent({ id: "a1", entityType: "deal", entityId: "deal-9" }),
        activityEvent({ id: "a2", entityType: "invoice" }),
        activityEvent({ id: "a3", entityType: "contract", entityId: "c-1" }),
      ],
      now: NOW,
    });
    const byId = Object.fromEntries(items.map((n) => [n.id, n.href]));
    expect(byId["activity:a1"]).toBe("/pipeline/deal-9");
    expect(byId["activity:a2"]).toBe("/payments");
    expect(byId["activity:a3"]).toBeUndefined();
  });

  it("merges both sources newest-first", () => {
    const items = buildNotifications({
      activity: [
        activityEvent({ id: "old", createdAt: "2026-02-20T00:00:00.000Z" }),
        activityEvent({ id: "new", createdAt: "2026-03-09T00:00:00.000Z" }),
      ],
      invoices: [invoice()],
      now: NOW,
    });
    expect(items.map((n) => n.id)).toEqual([
      "activity:new",
      "invoice-overdue:i1",
      "activity:old",
    ]);
  });

  it("caps the list at the requested limit", () => {
    const activity = Array.from({ length: 20 }, (_, i) =>
      activityEvent({ id: `a${i}`, createdAt: new Date(Date.UTC(2026, 1, i + 1)).toISOString() })
    );
    expect(buildNotifications({ activity, now: NOW })).toHaveLength(8);
    expect(buildNotifications({ activity, now: NOW, limit: 3 })).toHaveLength(3);
  });
});

describe("countUnread", () => {
  const items = buildNotifications({
    activity: [
      activityEvent({ id: "a", createdAt: "2026-03-09T00:00:00.000Z" }),
      activityEvent({ id: "b", createdAt: "2026-03-08T00:00:00.000Z" }),
    ],
    now: NOW,
  });

  it("treats everything as unread on a first visit", () => {
    expect(countUnread(items, null)).toBe(2);
  });

  it("counts only events newer than the watermark", () => {
    expect(countUnread(items, "2026-03-08T12:00:00.000Z")).toBe(1);
  });

  it("is zero once the watermark covers the newest event", () => {
    expect(countUnread(items, readWatermark(items, NOW))).toBe(0);
  });

  it("is zero for an empty list — the dot must never show over nothing (SPO-153)", () => {
    expect(countUnread([], null)).toBe(0);
  });
});

describe("readWatermark", () => {
  it("falls back to now when there is nothing to read", () => {
    expect(readWatermark([], NOW)).toBe(NOW.toISOString());
  });

  it("advances past a future-dated event so clock skew cannot pin the dot on", () => {
    const skewed = buildNotifications({
      activity: [activityEvent({ createdAt: "2026-03-10T18:00:00.000Z" })],
      now: NOW,
    });
    const watermark = readWatermark(skewed, NOW);
    expect(watermark).toBe("2026-03-10T18:00:00.000Z");
    expect(countUnread(skewed, watermark)).toBe(0);
  });
});
