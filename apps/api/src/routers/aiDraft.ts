import { z } from "zod";
import { createTRPCRouter, creatorScopedProcedure } from "../trpc.js";
import { generateDraft } from "../ai/draft.js";
import { createDraftProvider } from "../ai/provider.js";
import { draftSections } from "../ai/types.js";

const offeringInput = z.object({
  title: z.string().trim().min(1).max(255),
  priceCents: z.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
});

const brandInput = z.object({
  name: z.string().trim().min(1).max(255),
  category: z.string().trim().max(128).optional(),
});

export const aiDraftRouter = createTRPCRouter({
  /**
   * Whether the server has a configured LLM provider. Lets the UI hide the
   * "Draft with AI" entry point before a founder-provisioned key exists, and
   * proves the key itself never leaves the server (only a boolean does).
   */
  status: creatorScopedProcedure.query(() => ({
    configured: createDraftProvider() !== null,
  })),

  draft: creatorScopedProcedure
    .input(
      z.object({
        section: z.enum(draftSections),
        offering: offeringInput.optional(),
        brand: brandInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return generateDraft({
        db: ctx.db,
        creatorId: ctx.creatorId,
        section: input.section,
        offering: input.offering,
        brand: input.brand,
      });
    }),
});
