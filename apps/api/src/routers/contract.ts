import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, and, isNull } from "drizzle-orm";
import { contracts, deals, activityEvents } from "@sponsee/db/schema";
import { contractStatuses } from "@sponsee/shared";
import { createStorageProvider } from "../storage/index.js";
import { assertSizeWithinCap, isOwnedKey } from "../storage/limits.js";
import { httpUrl } from "./validators.js";

import { type db as Db } from "@sponsee/db";

async function getOwnedDeal(ctx: { db: typeof Db; creatorId: string }, dealId: string) {
  const [deal] = await ctx.db
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.creatorId, ctx.creatorId), isNull(deals.deletedAt)));
  if (!deal) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
  }
  return deal;
}

export const contractRouter = createTRPCRouter({
  // One contract per deal in v1 (Phase A) — get/upsert semantics.
  getByDeal: creatorScopedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await getOwnedDeal(ctx, input.dealId);
      const [contract] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.dealId, input.dealId));
      if (!contract) return null;
      // An uploaded PDF is private: serve it through a fresh presigned GET so
      // the client never sees the raw storage key.
      if (contract.storageKey) {
        const provider = createStorageProvider();
        return { ...contract, fileUrl: await provider.createPresignedGetUrl(contract.storageKey) };
      }
      return contract;
    }),

  upsert: creatorScopedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid(),
          bodyText: z.string().max(200_000).optional().nullable(),
          fileUrl: httpUrl.optional().nullable(),
        })
        .refine((v) => Boolean(v.bodyText?.trim()) || Boolean(v.fileUrl), {
          message: "Provide a contract link or pasted text",
        })
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await getOwnedDeal(ctx, input.dealId);
      const [existing] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.dealId, input.dealId));

      const values = {
        bodyText: input.bodyText?.trim() || null,
        fileUrl: input.fileUrl || null,
        // Replacing a pasted link/text with an upload (or vice versa) clears the
        // other source so a contract never has two conflicting origins.
        storageKey: null,
        mimeType: null,
        sizeBytes: null,
        uploadedAt: null,
      };

      let contract;
      let action: "attached" | "updated";
      if (existing) {
        [contract] = await ctx.db
          .update(contracts)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(contracts.id, existing.id))
          .returning();
        action = "updated";
      } else {
        [contract] = await ctx.db
          .insert(contracts)
          .values({ dealId: input.dealId, ...values })
          .returning();
        action = "attached";
      }

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "contract",
        entityId: contract.id,
        kind: "contract",
        payload: {
          action,
          dealId: deal.id,
          hasFile: Boolean(contract.fileUrl),
          hasText: Boolean(contract.bodyText),
        },
      });

      return contract;
    }),

  /**
   * Persist an uploaded contract PDF. Called after the browser has PUT the
   * bytes to the presigned URL returned by storage.requestUpload. PDF-only.
   */
  confirmUpload: creatorScopedProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        key: z.string().min(1).max(2048),
        mimeType: z.string().min(1).max(255),
        sizeBytes: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await getOwnedDeal(ctx, input.dealId);

      if (!isOwnedKey(input.key, ctx.creatorId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your file" });
      }

      if (input.mimeType !== "application/pdf") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Contract uploads must be a PDF" });
      }

      try {
        assertSizeWithinCap(input.sizeBytes);
      } catch {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File exceeds the 100 MB upload limit" });
      }

      const [existing] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.dealId, input.dealId));

      const values = {
        storageKey: input.key,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedAt: new Date(),
        bodyText: null,
        fileUrl: null,
      };

      let contract;
      let action: "attached" | "updated";
      if (existing) {
        [contract] = await ctx.db
          .update(contracts)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(contracts.id, existing.id))
          .returning();
        action = "updated";
      } else {
        [contract] = await ctx.db
          .insert(contracts)
          .values({ dealId: input.dealId, ...values })
          .returning();
        action = "attached";
      }

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "contract",
        entityId: contract.id,
        kind: "contract",
        payload: {
          action,
          dealId: deal.id,
          hasFile: true,
          hasText: false,
        },
      });

      return contract;
    }),

  updateStatus: creatorScopedProcedure
    .input(z.object({ dealId: z.string().uuid(), status: z.enum(contractStatuses) }))
    .mutation(async ({ ctx, input }) => {
      const deal = await getOwnedDeal(ctx, input.dealId);
      const [existing] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.dealId, input.dealId));
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }
      if (existing.status === input.status) {
        return { contract: existing, dealStage: deal.stage };
      }

      const [contract] = await ctx.db
        .update(contracts)
        .set({
          status: input.status,
          signedAt: input.status === "signed" ? existing.signedAt ?? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(contracts.id, existing.id))
        .returning();

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "contract",
        entityId: contract.id,
        kind: "contract",
        payload: { action: "status_change", dealId: deal.id, from: existing.status, to: input.status },
      });

      // Marking the contract sent pulls the deal forward into the existing
      // contract_sent pipeline stage; later stages are never moved backwards.
      let dealStage = deal.stage;
      if (input.status === "sent" && (deal.stage === "inbound" || deal.stage === "negotiating")) {
        const [updatedDeal] = await ctx.db
          .update(deals)
          .set({ stage: "contract_sent", stageEnteredAt: new Date(), updatedAt: new Date() })
          .where(eq(deals.id, deal.id))
          .returning();
        dealStage = updatedDeal.stage;

        await ctx.db.insert(activityEvents).values({
          creatorId: ctx.creatorId,
          actor: "system",
          entityType: "deal",
          entityId: deal.id,
          kind: "stage_change",
          payload: { from: deal.stage, to: "contract_sent", trigger: "contract_status" },
        });
      }

      return { contract, dealStage };
    }),

  remove: creatorScopedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await getOwnedDeal(ctx, input.dealId);
      const [existing] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.dealId, input.dealId));
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
      }

      await ctx.db.delete(contracts).where(eq(contracts.id, existing.id));

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "contract",
        entityId: existing.id,
        kind: "contract",
        payload: { action: "removed", dealId: input.dealId },
      });

      return { success: true };
    }),
});
