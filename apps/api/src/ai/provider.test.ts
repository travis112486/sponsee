import { describe, it, expect, vi } from "vitest";
import {
  AnthropicProvider,
  createDraftProvider,
  ANTHROPIC_VERSION,
  DEFAULT_BASE_URL,
} from "./provider.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: vi.fn(async () => (ok ? "" : "boom")),
    json: vi.fn(async () => body),
  } as unknown as Response;
}

describe("AnthropicProvider.complete", () => {
  it("POSTs the message to the Messages API with the key server-side only", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ content: [{ type: "text", text: "Hello world" }] }),
    ) as unknown as typeof fetch;

    const provider = new AnthropicProvider("sk-test", "claude-haiku-4-5", DEFAULT_BASE_URL, fetchImpl);
    const result = await provider.complete("SYS", "USER");

    expect(result.text).toBe("Hello world");
    expect(result.model).toBe("claude-haiku-4-5");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DEFAULT_BASE_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.system).toBe("SYS");
    expect(body.messages).toEqual([{ role: "user", content: "USER" }]);
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500)) as unknown as typeof fetch;
    const provider = new AnthropicProvider("sk-test", "m", DEFAULT_BASE_URL, fetchImpl);
    await expect(provider.complete("SYS", "USER")).rejects.toThrow(/500/);
  });

  it("throws when the response has no text content", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ content: [] })) as unknown as typeof fetch;
    const provider = new AnthropicProvider("sk-test", "m", DEFAULT_BASE_URL, fetchImpl);
    await expect(provider.complete("SYS", "USER")).rejects.toThrow(/no text content/);
  });
});

describe("createDraftProvider", () => {
  it("returns null when the key is absent", () => {
    expect(createDraftProvider({})).toBeNull();
    expect(createDraftProvider({ ANTHROPIC_API_KEY: "  " })).toBeNull();
  });

  it("returns a provider with defaults when the key is present", () => {
    const provider = createDraftProvider({ ANTHROPIC_API_KEY: "sk-test" });
    expect(provider).not.toBeNull();
  });

  it("honours model override", () => {
    const env = { ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_MODEL: "claude-sonnet-5" };
    const provider = createDraftProvider(env) as AnthropicProvider;
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect((provider as unknown as { model: string }).model).toBe("claude-sonnet-5");
  });
});
