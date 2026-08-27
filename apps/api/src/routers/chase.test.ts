import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { chaseRouter } from "./chase.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TABLE_NAME = Symbol.for("drizzle:Name");

function getTableName(table: any): string {
  return table[TABLE_NAME] ?? "";
}

function mockCtx(overrides?: {
  session?: { user: { id: string; email: string; name: string } } | null;
  creatorId?: string | null;
  db?: any;
}) {
  return {
    session: overrides?.session ?? { user: { id: "user-1", email: "a@b.com", name: "A" } },
    creatorId: overrides?.creatorId ?? "creator-a",
    db: overrides?.db,
  };
}

interface ActivityEvent {
  creatorId: string;
  actor: string;
  entityType: string;
  entityId: string;
  kind: string;
  payload: unknown;
}

function createDb() {
  const activityEvents: ActivityEvent[] = [];

  const db = {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    query: { invoices: { findFirst: vi.fn() } },
    _activityEvents: activityEvents,
  };

  db.insert.mockReturnValue({
    values: vi.fn((vals: any) => {
      const items = Array.isArray(vals) ? vals : [vals];
      for (const item of items) {
        activityEvents.push(item);
      }
      return Promise.resolve();
    }),
  });

  return db;
}

// ── Tenant isolation tests ──────────────────────────────────────────────────

describe("chase router tenant isolation", () => {
  const now = new Date();

  const invA = "38a05f70-403e-4d22-91c5-a51dbb91a13c";
  const invB = "a2978c2d-d741-427f-b252-fd14b0a4a224";
  const evtA = "de906d68-4380-419f-b3a3-ae6b91522956";
  const evtB = "b9d67243-7c14-49c6-ac78-0f2964922c0a";
  const creatorA = "695b31f4-ec47-451f-9828-07f1272128f9";
  const creatorB = "348cd44c-18fa-4d97-ae28-e5779c40a7b5";

  const invoiceA = { id: invA, creatorId: creatorA, status: "open" };
  const invoiceB = { id: invB, creatorId: creatorB, status: "open" };
  const chaseStateA = {
    invoiceId: invA,
    mode: "armed",
    nextStep: 1,
    pausedReason: null,
    createdAt: now,
    updatedAt: now,
  };
  const chaseEventA = {
    id: evtA,
    invoiceId: invA,
    step: 1,
    subjectSnapshot: "Pay up",
    bodySnapshot: "Please pay",
    toEmail: "brand@example.com",
    status: "awaiting_review",
    createdAt: now,
  };
  const chaseEventB = {
    id: evtB,
    invoiceId: invB,
    step: 1,
    subjectSnapshot: "Pay up",
    bodySnapshot: "Please pay",
    toEmail: "brand@example.com",
    status: "awaiting_review",
    createdAt: now,
  };

  describe("chase.state", () => {
    it("returns chase state for an owned invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn((table: any) => {
          const name = getTableName(table);
          if (name === "invoices") {
            return { where: vi.fn().mockResolvedValue([invoiceA]) };
          }
          if (name === "invoice_chase_state") {
            return { where: vi.fn().mockResolvedValue([chaseStateA]) };
          }
          return { where: vi.fn().mockResolvedValue([]) };
        }),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      const result = await caller.state({ invoiceId: invA });
      expect(result).toMatchObject({ invoiceId: invA, mode: "armed" });
    });

    it("returns null when owned invoice has no chase state", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn((table: any) => {
          const name = getTableName(table);
          if (name === "invoices") {
            return { where: vi.fn().mockResolvedValue([invoiceA]) };
          }
          if (name === "invoice_chase_state") {
            return { where: vi.fn().mockResolvedValue([]) };
          }
          return { where: vi.fn().mockResolvedValue([]) };
        }),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      const result = await caller.state({ invoiceId: invA });
      expect(result).toBeNull();
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      await expect(caller.state({ invoiceId: invB })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("chase.events", () => {
    it("returns events for an owned invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn((table: any) => {
          const name = getTableName(table);
          if (name === "invoices") {
            return { where: vi.fn().mockResolvedValue([invoiceA]) };
          }
          if (name === "chase_events") {
            return {
              where: vi.fn(() => ({
                orderBy: vi.fn().mockResolvedValue([chaseEventA]),
              })),
              innerJoin: vi.fn(() => ({
                where: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          return { where: vi.fn().mockResolvedValue([]) };
        }),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      const result = await caller.events({ invoiceId: invA });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: evtA });
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      await expect(caller.events({ invoiceId: invB })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("chase.pause", () => {
    it("succeeds for an owned invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([invoiceA]),
        })),
      });
      db.update.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      const result = await caller.pause({ invoiceId: invA, reason: "vacation" });
      expect(result.success).toBe(true);
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      await expect(caller.pause({ invoiceId: invB })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not write an activity event for a cross-creator invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      try {
        await caller.pause({ invoiceId: invB, reason: "vacation" });
      } catch {
        // expected
      }

      const crossTenantEvents = db._activityEvents.filter(
        (e: ActivityEvent) => e.entityId === invB && e.creatorId === creatorA
      );
      expect(crossTenantEvents).toHaveLength(0);
    });
  });

  describe("chase.resume", () => {
    it("succeeds for an owned invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([invoiceA]),
        })),
      });
      db.update.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      const result = await caller.resume({ invoiceId: invA });
      expect(result.success).toBe(true);
    });

    it("throws NOT_FOUND for a cross-creator invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      await expect(caller.resume({ invoiceId: invB })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });

    it("does not write an activity event for a cross-creator invoice", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      try {
        await caller.resume({ invoiceId: invB });
      } catch {
        // expected
      }

      const crossTenantEvents = db._activityEvents.filter(
        (e: ActivityEvent) => e.entityId === invB && e.creatorId === creatorA
      );
      expect(crossTenantEvents).toHaveLength(0);
    });
  });

  describe("chase.approve", () => {
    it("throws NOT_FOUND for a cross-creator chase event", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      await expect(caller.approve({ chaseEventId: evtB })).rejects.toSatisfy(
        (err: TRPCError) => err.code === "NOT_FOUND"
      );
    });
  });

  describe("chase.editAndSend", () => {
    it("throws NOT_FOUND for a cross-creator chase event", async () => {
      const db = createDb();
      db.select.mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      });

      const caller = chaseRouter.createCaller(mockCtx({ creatorId: creatorA, db }));
      await expect(
        caller.editAndSend({ chaseEventId: evtB, subject: "Hey", body: "Pay" })
      ).rejects.toSatisfy((err: TRPCError) => err.code === "NOT_FOUND");
    });
  });
});
