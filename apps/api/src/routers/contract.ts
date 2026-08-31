import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { eq, and, isNull } from "drizzle-orm";
import { contracts, deals, activityEvents } from "@sponsee/db/schema";
import { contractStatuses } from "@sponsee/shared";
import { httpUrl } from "./validators.js";
import {
  MAX_UPLOAD_BYTES,
  StorageNotConfiguredError,
  createDownloadUrl,
  deleteObject,
  extensionFromKey,
  keyBelongsToDeal,
  mimeTypeForExtension,
  sanitizeFilename,
} from "../storage/index.js";

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

/**
 * The client's declared MIME type is never trusted for the PDF-only gate —
 * the object key's extension was chosen server-side at presign time
 * (storage/keys.ts), so re-deriving the MIME type from it is what actually
 * reflects what got uploaded.
 */
function assertContractPdfKey(key: string): void {
  const extension = extensionFromKey(key);
  const mimeType = extension ? mimeTypeForExtension(extension) : null;
  if (mimeType !== "application/pdf") {
    throw new TRPCError({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Contracts must be uploaded as a PDF" });
  }
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

      if (!contract.storageKey) {
        return { ...contract, viewUrl: null };
      }

      // Short-TTL presigned GET so the in-platform viewer can render the
      // uploaded PDF without the object (or a long-lived URL) ever going to
      // the client at rest. Signing is a local computation (see storage/
      // presign.ts) — no network round trip — so this is cheap on every read.
      try {
        const download = await createDownloadUrl({
          key: contract.storageKey,
          filename: contract.originalFilename ?? undefined,
        });
        return { ...contract, viewUrl: download.url };
      } catch (err) {
        if (err instanceof StorageNotConfiguredError) {
          return { ...contract, viewUrl: null };
        }
        throw err;
      }
    }),

  upsert: creatorScopedProcedure
    .input(
      z
        .object({
          dealId: z.string().uuid(),
          bodyText: z.string().max(200_000).optional().nullable(),
          fileUrl: httpUrl.optional().nullable(),
          storageKey: z.string().min(1).max(1024).optional().nullable(),
          sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES).optional(),
          originalFilename: z.string().min(1).max(255).optional(),
        })
        .refine((v) => Boolean(v.bodyText?.trim()) || Boolean(v.fileUrl) || Boolean(v.storageKey), {
          message: "Provide a contract link, pasted text, or an uploaded PDF",
        })
    )
    .mutation(async ({ ctx, input }) => {
      const deal = await getOwnedDeal(ctx, input.dealId);
      const [existing] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.dealId, input.dealId));
      const existedBefore = Boolean(existing);

      let values: {
        bodyText: string | null;
        fileUrl: string | null;
        storageKey: string | null;
        mimeType: string | null;
        sizeBytes: number | null;
        originalFilename: string | null;
      };

      if (input.storageKey) {
        // Belt-and-suspenders on top of creatorScopedProcedure: the key
        // itself must carry this exact creator/deal pair, so a creator can't
        // attach a key copied from another deal (their own or another
        // tenant's) just by pasting a string into this mutation.
        if (!keyBelongsToDeal(input.storageKey, { creatorId: ctx.creatorId, dealId: input.dealId })) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to that file" });
        }
        assertContractPdfKey(input.storageKey);

        values = {
          bodyText: input.bodyText?.trim() || null,
          fileUrl: null,
          storageKey: input.storageKey,
          mimeType: "application/pdf",
          sizeBytes: input.sizeBytes ?? null,
          originalFilename: input.originalFilename ? sanitizeFilename(input.originalFilename) : null,
        };
      } else {
        values = {
          bodyText: input.bodyText?.trim() || null,
          fileUrl: input.fileUrl || null,
          storageKey: null,
          mimeType: null,
          sizeBytes: null,
          originalFilename: null,
        };
      }

      // Concurrent double-clicks race on the select-then-insert above, so the
      // unique index on deal_id is the real guard — onConflictDoUpdate makes
      // the loser of the race converge on an update instead of a 23505.
      const [contract] = await ctx.db
        .insert(contracts)
        .values({ dealId: input.dealId, ...values })
        .onConflictDoUpdate({
          target: contracts.dealId,
          set: { ...values, updatedAt: new Date() },
        })
        .returning();

      // contracts.dealId is uniquely indexed (SPO-115: one contract per
      // deal), so replacing an uploaded PDF — or overwriting it with a pasted
      // link/text — never creates a second row. The superseded object has to
      // be deleted here or it orphans in the bucket (see delete.ts).
      if (existing?.storageKey && existing.storageKey !== contract.storageKey) {
        await deleteObject(existing.storageKey);
      }

      const action: "attached" | "updated" = existedBefore ? "updated" : "attached";

      await ctx.db.insert(activityEvents).values({
        creatorId: ctx.creatorId,
        actor: "creator",
        entityType: "contract",
        entityId: contract.id,
        kind: "contract",
        payload: {
          action,
          dealId: deal.id,
          hasFile: Boolean(contract.fileUrl || contract.storageKey),
          hasText: Boolean(contract.bodyText),
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

      if (existing.storageKey) {
        await deleteObject(existing.storageKey);
      }

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
