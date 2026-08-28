import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, desc } from "drizzle-orm";
import { activityEvents } from "@sponsee/db/schema";

export const activityRouter = createTRPCRouter({
  // Newest-first feed for the Dashboard (D-010) — ordering is enforced in
  // the query, not left to client-side sort, so it can never regress silently.
  list: creatorScopedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.creatorId, ctx.creatorId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(input?.limit ?? 10);
    }),
});
