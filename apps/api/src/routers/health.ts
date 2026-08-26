import { z } from "zod";
import { createTRPCRouter, publicProcedure, creatorScopedProcedure } from "../trpc.js";

export const healthRouter = createTRPCRouter({
  check: publicProcedure.query(() => {
    return { status: "ok", version: "0.1.0" };
  }),
});

export const dashboardRouter = createTRPCRouter({
  overview: creatorScopedProcedure.query(async ({ ctx }) => {
    // M0 stub: return empty state
    return {
      kpis: {
        activeDeals: 0,
        pipelineValueCents: 0,
        outstandingCents: 0,
        ytdRevenueCents: 0,
        closeRate: 0,
      },
      revenueByMonth: [] as Array<{ month: string; valueCents: number }>,
      platformMix: [] as Array<{ platform: string; valueCents: number }>,
      deliverablesDue: [] as Array<{
        id: string;
        title: string;
        dealTitle: string;
        dueAt: string | null;
        dueLabel: string | null;
        status: string;
      }>,
      pipelineSnapshot: [] as Array<{ stage: string; count: number; valueCents: number }>,
      activityFeed: [] as Array<{
        id: string;
        actor: string;
        kind: string;
        text: string;
        createdAt: string;
      }>,
    };
  }),
});
