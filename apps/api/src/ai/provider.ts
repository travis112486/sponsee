export const DEFAULT_MODEL = "claude-haiku-4-5";
export const DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

export interface DraftProvider {
  complete(system: string, user: string): Promise<{ text: string; model: string }>;
}

type FetchLike = typeof fetch;

export class AnthropicProvider implements DraftProvider {
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string,
    private fetchImpl: FetchLike = fetch,
    private maxTokens: number = DEFAULT_MAX_TOKENS,
  ) {}

  async complete(system: string, user: string): Promise<{ text: string; model: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Anthropic API responded ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = (data.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("")
        .trim();

      if (!text) throw new Error("Anthropic API returned no text content");
      return { text, model: this.model };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Build the provider from environment only. Returns `null` when no key is
 * configured — the caller degrades gracefully instead of throwing. The key is
 * read server-side here and never leaves the API process.
 */
export function createDraftProvider(env: NodeJS.ProcessEnv = process.env): DraftProvider | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const baseUrl = env.ANTHROPIC_API_URL?.trim() || DEFAULT_BASE_URL;
  const maxTokens = env.ANTHROPIC_MAX_TOKENS
    ? Number.parseInt(env.ANTHROPIC_MAX_TOKENS, 10)
    : DEFAULT_MAX_TOKENS;

  return new AnthropicProvider(
    apiKey,
    model,
    baseUrl,
    fetch,
    Number.isFinite(maxTokens) ? maxTokens : DEFAULT_MAX_TOKENS,
  );
}
