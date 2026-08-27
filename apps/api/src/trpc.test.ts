import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  authedProcedure,
  creatorScopedProcedure,
  createTRPCRouter,
} from "./trpc.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function mockCtx(overrides?: {
  session?: { user: { id: string; email: string; name: string } } | null;
  creatorId?: string | null;
}) {
  return {
    session: overrides?.session ?? null,
    creatorId: overrides?.creatorId ?? null,
    db: {} as any,
  };
}

// ── Middleware unit tests ──────────────────────────────────────────────────

describe("authedProcedure", () => {
  it("rejects requests without a session", async () => {
    const caller = createTRPCRouter({
      test: authedProcedure.query(() => "ok"),
    }).createCaller(mockCtx());

    await expect(caller.test()).rejects.toSatisfy((err: TRPCError) => err.code === "UNAUTHORIZED");
  });

  it("allows requests with a valid session", async () => {
    const caller = createTRPCRouter({
      test: authedProcedure.query(({ ctx }) => ctx.user.id),
    }).createCaller(
      mockCtx({
        session: { user: { id: "user-1", email: "a@b.com", name: "A" } },
      })
    );

    await expect(caller.test()).resolves.toBe("user-1");
  });
});

describe("creatorScopedProcedure", () => {
  it("rejects unauthenticated requests", async () => {
    const caller = createTRPCRouter({
      test: creatorScopedProcedure.query(() => "ok"),
    }).createCaller(mockCtx());

    await expect(caller.test()).rejects.toSatisfy((err: TRPCError) => err.code === "UNAUTHORIZED");
  });

  it("rejects authenticated users without a creator workspace", async () => {
    const caller = createTRPCRouter({
      test: creatorScopedProcedure.query(() => "ok"),
    }).createCaller(
      mockCtx({
        session: { user: { id: "user-1", email: "a@b.com", name: "A" } },
        creatorId: null,
      })
    );

    await expect(caller.test()).rejects.toSatisfy(
      (err: TRPCError) => err.code === "FORBIDDEN" && err.message === "No creator workspace"
    );
  });

  it("injects creatorId into context for scoped queries", async () => {
    const caller = createTRPCRouter({
      test: creatorScopedProcedure.query(({ ctx }) => ctx.creatorId),
    }).createCaller(
      mockCtx({
        session: { user: { id: "user-1", email: "a@b.com", name: "A" } },
        creatorId: "creator-abc",
      })
    );

    await expect(caller.test()).resolves.toBe("creator-abc");
  });
});

// ── Tenant isolation integration tests ─────────────────────────────────────

describe("tenant isolation", () => {
  /**
   * Simulated deals router that mimics the real deals.list pattern:
   * returns only rows matching ctx.creatorId.
   */
  const mockDb = {
    deals: [
      { id: "deal-1", creatorId: "creator-a", title: "Deal A" },
      { id: "deal-2", creatorId: "creator-b", title: "Deal B" },
      { id: "deal-3", creatorId: "creator-a", title: "Deal C" },
    ],
  };

  const testRouter = createTRPCRouter({
    listDeals: creatorScopedProcedure.query(({ ctx }) => {
      // In the real router this is a SQL WHERE; here we filter in-memory
      // to prove the middleware supplies the correct scoped ID.
      return mockDb.deals.filter((d) => d.creatorId === ctx.creatorId);
    }),

    getDeal: creatorScopedProcedure
      .input((val: unknown) => {
        if (typeof val === "string") return val;
        throw new TRPCError({ code: "BAD_REQUEST" });
      })
      .query(({ ctx, input }) => {
        const deal = mockDb.deals.find(
          (d) => d.id === input && d.creatorId === ctx.creatorId
        );
        if (!deal) throw new TRPCError({ code: "NOT_FOUND" });
        return deal;
      }),
  });

  it("listDeals returns only the calling creator's deals", async () => {
    const callerA = testRouter.createCaller(
      mockCtx({
        session: { user: { id: "user-a", email: "a@b.com", name: "A" } },
        creatorId: "creator-a",
      })
    );

    const results = await callerA.listDeals();
    expect(results).toHaveLength(2);
    expect(results.map((d) => d.id)).toEqual(["deal-1", "deal-3"]);
  });

  it("getDeal returns the deal only when it belongs to the caller", async () => {
    const callerA = testRouter.createCaller(
      mockCtx({
        session: { user: { id: "user-a", email: "a@b.com", name: "A" } },
        creatorId: "creator-a",
      })
    );

    // Own deal
    await expect(callerA.getDeal("deal-1")).resolves.toMatchObject({
      id: "deal-1",
      title: "Deal A",
    });

    // Other creator's deal → NOT_FOUND
    await expect(callerA.getDeal("deal-2")).rejects.toThrow("NOT_FOUND");
  });

  it("different creators cannot see each other's data", async () => {
    const callerA = testRouter.createCaller(
      mockCtx({
        session: { user: { id: "user-a", email: "a@b.com", name: "A" } },
        creatorId: "creator-a",
      })
    );
    const callerB = testRouter.createCaller(
      mockCtx({
        session: { user: { id: "user-b", email: "b@b.com", name: "B" } },
        creatorId: "creator-b",
      })
    );

    const aDeals = await callerA.listDeals();
    const bDeals = await callerB.listDeals();

    // No overlap
    const aIds = new Set(aDeals.map((d) => d.id));
    const bIds = new Set(bDeals.map((d) => d.id));
    for (const id of aIds) {
      expect(bIds.has(id)).toBe(false);
    }
  });
});

// ── Context shape audit ────────────────────────────────────────────────────

describe("context audit", () => {
  it("creatorScopedProcedure narrows ctx to a non-null creatorId", async () => {
    // This test documents the type-narrowing contract: downstream code should
    // be able to assume ctx.creatorId is a string inside creatorScopedProcedure.
    const router = createTRPCRouter({
      test: creatorScopedProcedure.query(({ ctx }) => {
        // If this compiles and runs, the type narrowing is working.
        const id: string = ctx.creatorId;
        return id;
      }),
    });

    const caller = router.createCaller(
      mockCtx({
        session: { user: { id: "u1", email: "a@b.com", name: "A" } },
        creatorId: "creator-x",
      })
    );

    await expect(caller.test()).resolves.toBe("creator-x");
  });
});
