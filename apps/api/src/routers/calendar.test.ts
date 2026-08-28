import { describe, it, expect } from "vitest";
import { calendarRouter } from "./calendar.js";

function mockCtx(overrides?: {
  session?: { user: { id: string; email: string; name: string } } | null;
  creatorId?: string | null;
  db?: any;
}) {
  return {
    session: overrides?.session ?? null,
    creatorId: overrides?.creatorId ?? null,
    db: overrides?.db ?? {},
  };
}

describe("calendarRouter.events", () => {
  const mockDb = {
    select: vi.fn(() => mockDb),
    from: vi.fn(() => mockDb),
    innerJoin: vi.fn(() => mockDb),
    leftJoin: vi.fn(() => mockDb),
    where: vi.fn(() => mockDb),
    orderBy: vi.fn(() => Promise.resolve([])),
  };

  it("rejects unauthenticated requests", async () => {
    const caller = calendarRouter.createCaller(mockCtx({ db: mockDb }));
    await expect(caller.events({})).rejects.toSatisfy(
      (err: any) => err.code === "UNAUTHORIZED"
    );
  });

  it("rejects requests without a creator workspace", async () => {
    const caller = calendarRouter.createCaller(
      mockCtx({
        session: { user: { id: "u1", email: "a@b.com", name: "A" } },
        creatorId: null,
        db: mockDb,
      })
    );
    await expect(caller.events({})).rejects.toSatisfy(
      (err: any) => err.code === "FORBIDDEN"
    );
  });

  it("returns deliverables, invoices, and deal stages scoped to creator", async () => {
    const yesterday = new Date(Date.now() - 86400000);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);

    const dbSequence: any[] = [
      // deliverables query
      Promise.resolve([
        {
          id: "del-1",
          title: "Twitch stream",
          dueAt: tomorrow,
          status: "scheduled",
          dealId: "deal-1",
          dealTitle: "Acme Corp",
        },
      ]),
      // invoices query
      Promise.resolve([
        {
          id: "inv-1",
          title: "Invoice A",
          number: 1,
          dueAt: tomorrow,
          status: "open",
          amountCents: 50000,
          currency: "USD",
        },
      ]),
      // deals query
      Promise.resolve([
        {
          id: "deal-1",
          title: "Acme Corp",
          stage: "live",
          stageEnteredAt: yesterday,
          brandName: "Acme",
        },
      ]),
    ];

    let callIdx = 0;
    const chainableDb = {
      select: vi.fn(() => chainableDb),
      from: vi.fn(() => chainableDb),
      innerJoin: vi.fn(() => chainableDb),
      leftJoin: vi.fn(() => chainableDb),
      where: vi.fn(() => chainableDb),
      orderBy: vi.fn(() => dbSequence[callIdx++]),
    };

    const caller = calendarRouter.createCaller(
      mockCtx({
        session: { user: { id: "u1", email: "a@b.com", name: "A" } },
        creatorId: "creator-a",
        db: chainableDb,
      })
    );

    const result = await caller.events({});

    expect(result).toHaveLength(3);
    expect(result.map((r: any) => r.type)).toEqual([
      "deal_stage",
      "deliverable",
      "invoice",
    ]);
  });

  it("filters out events with null dates", async () => {
    const dbSequence: any[] = [
      // deliverables query — one with dueAt, one without
      Promise.resolve([
        { id: "del-1", title: "A", dueAt: new Date(), status: "scheduled", dealId: "d1", dealTitle: "D1" },
        { id: "del-2", title: "B", dueAt: null, status: "not_started", dealId: "d1", dealTitle: "D1" },
      ]),
      // invoices query
      Promise.resolve([]),
      // deals query
      Promise.resolve([]),
    ];

    let callIdx = 0;
    const chainableDb = {
      select: vi.fn(() => chainableDb),
      from: vi.fn(() => chainableDb),
      innerJoin: vi.fn(() => chainableDb),
      leftJoin: vi.fn(() => chainableDb),
      where: vi.fn(() => chainableDb),
      orderBy: vi.fn(() => dbSequence[callIdx++]),
    };

    const caller = calendarRouter.createCaller(
      mockCtx({
        session: { user: { id: "u1", email: "a@b.com", name: "A" } },
        creatorId: "creator-a",
        db: chainableDb,
      })
    );

    const result = await caller.events({});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("del-1");
  });

  it("applies date-range filter when start/end provided", async () => {
    const jan1 = new Date("2026-01-01T00:00:00Z");
    const jan15 = new Date("2026-01-15T00:00:00Z");
    const feb1 = new Date("2026-02-01T00:00:00Z");

    const dbSequence: any[] = [
      Promise.resolve([
        { id: "del-1", title: "Jan 1", dueAt: jan1, status: "scheduled", dealId: "d1", dealTitle: "D1" },
        { id: "del-2", title: "Jan 15", dueAt: jan15, status: "scheduled", dealId: "d1", dealTitle: "D1" },
        { id: "del-3", title: "Feb 1", dueAt: feb1, status: "scheduled", dealId: "d1", dealTitle: "D1" },
      ]),
      Promise.resolve([]),
      Promise.resolve([]),
    ];

    let callIdx = 0;
    const chainableDb = {
      select: vi.fn(() => chainableDb),
      from: vi.fn(() => chainableDb),
      innerJoin: vi.fn(() => chainableDb),
      leftJoin: vi.fn(() => chainableDb),
      where: vi.fn(() => chainableDb),
      orderBy: vi.fn(() => dbSequence[callIdx++]),
    };

    const caller = calendarRouter.createCaller(
      mockCtx({
        session: { user: { id: "u1", email: "a@b.com", name: "A" } },
        creatorId: "creator-a",
        db: chainableDb,
      })
    );

    const result = await caller.events({
      start: "2026-01-10T00:00:00Z",
      end: "2026-01-20T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Jan 15");
  });
});
