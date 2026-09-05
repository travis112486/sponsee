import type { DB } from "@sponsee/db";
import { loadCreatorContext } from "./context.js";
import { buildDraftPrompt } from "./prompt.js";
import { createDraftProvider, type DraftProvider } from "./provider.js";
import type { BrandContext, DraftResult, DraftSection, OfferingContext } from "./types.js";

export interface GenerateDraftArgs {
  db: DB;
  creatorId: string;
  section: DraftSection;
  offering?: OfferingContext;
  brand?: BrandContext;
  /** Injectable for tests; defaults to the environment-backed provider. */
  provider?: DraftProvider | null;
}

/**
 * Orchestrates one draft: load the creator's own data, build the prompt, call
 * the provider, and fold every failure mode into a typed result the client can
 * render without crashing. A missing key yields `not_configured`; a provider
 * failure yields `error` (retryable) — neither throws to the caller.
 */
export async function generateDraft(args: GenerateDraftArgs): Promise<DraftResult> {
  const provider = args.provider === undefined ? createDraftProvider() : args.provider;
  if (!provider) {
    return { status: "not_configured" };
  }

  const context = await loadCreatorContext(args.db, args.creatorId);
  const { system, user } = buildDraftPrompt(context, args.section, args.offering, args.brand);

  try {
    const { text, model } = await provider.complete(system, user);
    return { status: "ok", text, model, section: args.section };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Draft generation failed",
    };
  }
}
