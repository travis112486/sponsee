import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { createTRPCRouter, publicProcedure, creatorScopedProcedure } from "../trpc.js";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import {
  compute,
  defaultBenchmarkConfig,
  validateBenchmarkConfig,
  benchmarkDeliverableTypes,
} from "@sponsee/shared";

export const calculatorRouter = createTRPCRouter({
  compute: publicProcedure
    .input(
      z.object({
        ccv: z.number().int().min(0),
        durationMinutes: z.number().int().min(0),
        deliverableType: z.enum(benchmarkDeliverableTypes),
        platforms: z.array(z.string()).optional(),
      })
    )
    .query(async ({ input }) => {
      // Load latest benchmark config from DB, fallback to default
      const [latest] = await db
        .select()
        .from(schema.benchmarkConfigs)
        .orderBy(desc(schema.benchmarkConfigs.effectiveDate))
        .limit(1);

      const config = latest?.cpvhBands
        ? validateBenchmarkConfig({
            version: latest.version,
            effectiveDate: latest.effectiveDate.toISOString(),
            cpvhBands: latest.cpvhBands,
            deliverableMultipliers:
              (latest.adjustments as Record<string, unknown> | null)
                ?.deliverableMultipliers ?? defaultBenchmarkConfig.deliverableMultipliers,
            platformMixAdjustments:
              (latest.adjustments as Record<string, unknown> | null)
                ?.platformMix ?? defaultBenchmarkConfig.platformMixAdjustments,
          }) ?? defaultBenchmarkConfig
        : defaultBenchmarkConfig;

      return compute(input, config);
    }),

  profile: createTRPCRouter({
    get: creatorScopedProcedure.query(async ({ ctx }) => {
      const [profile] = await db
        .select()
        .from(schema.calculatorProfiles)
        .where(eq(schema.calculatorProfiles.creatorId, ctx.creatorId));
      return profile ?? null;
    }),

    save: creatorScopedProcedure
      .input(
        z.object({
          inputs: z.record(z.unknown()),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await db
          .select()
          .from(schema.calculatorProfiles)
          .where(eq(schema.calculatorProfiles.creatorId, ctx.creatorId));

        if (existing.length > 0) {
          const [updated] = await db
            .update(schema.calculatorProfiles)
            .set({ inputs: input.inputs, updatedAt: new Date() })
            .where(eq(schema.calculatorProfiles.creatorId, ctx.creatorId))
            .returning();
          return updated;
        }

        const [created] = await db
          .insert(schema.calculatorProfiles)
          .values({
            creatorId: ctx.creatorId,
            inputs: input.inputs,
          })
          .returning();
        return created;
      }),
  }),
});
