import { describe, it, expect } from "vitest";
import { z, ZodError } from "zod";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import {
  formatTRPCError,
  humanizeFieldName,
  summarizeZodError,
  type FlattenedZodError,
} from "./error-formatter.js";
import { createTRPCRouter, publicProcedure } from "./trpc.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const baseShape = {
  message: "original message",
  code: -32600,
  data: { code: "BAD_REQUEST", httpStatus: 400, path: "settings.updateProfile" },
};

function zodErrorFor<T extends z.ZodTypeAny>(schema: T, value: unknown): ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("expected the schema to reject this value");
  return result.error;
}

/** What tRPC itself does: wraps the ZodError as the `cause` of a BAD_REQUEST. */
function badRequestFrom(cause: ZodError): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", cause });
}

/**
 * What tRPC does when a ZodError escapes a *procedure body* rather than input
 * parsing: the same `cause`, but the code is INTERNAL_SERVER_ERROR. Verified
 * against the installed tRPC 11.18 in the wire tests at the bottom of this file.
 */
function internalErrorFrom(cause: ZodError): TRPCError {
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
}

// ── humanizeFieldName ──────────────────────────────────────────────────────

describe("humanizeFieldName", () => {
  it("splits camelCase into words", () => {
    expect(humanizeFieldName("displayName")).toBe("Display name");
    expect(humanizeFieldName("scheduleLabel")).toBe("Schedule label");
  });

  it("uppercases known acronyms", () => {
    expect(humanizeFieldName("avatarUrl")).toBe("Avatar URL");
    expect(humanizeFieldName("ccv")).toBe("CCV");
  });

  it("leaves a single lowercase word capitalized", () => {
    expect(humanizeFieldName("platform")).toBe("Platform");
  });

  it("returns the input unchanged when there is nothing to split", () => {
    expect(humanizeFieldName("")).toBe("");
  });
});

// ── summarizeZodError ──────────────────────────────────────────────────────

describe("summarizeZodError", () => {
  it("attributes each message to its field", () => {
    const flattened: FlattenedZodError = {
      formErrors: [],
      fieldErrors: { avatarUrl: ["Must be an https:// URL"] },
    };
    expect(summarizeZodError(flattened)).toBe("Avatar URL: Must be an https:// URL");
  });

  it("joins multiple fields and multiple messages per field", () => {
    const flattened: FlattenedZodError = {
      formErrors: [],
      fieldErrors: {
        displayName: ["Required", "Too short"],
        defaultCurrency: ["Must be 3 characters"],
      },
    };
    expect(summarizeZodError(flattened)).toBe(
      "Display name: Required, Too short; Default currency: Must be 3 characters"
    );
  });

  it("includes form-level errors that have no field", () => {
    const flattened: FlattenedZodError = {
      formErrors: ["Expected object, received string"],
      fieldErrors: {},
    };
    expect(summarizeZodError(flattened)).toBe("Expected object, received string");
  });

  it("skips fields whose message list is empty", () => {
    const flattened: FlattenedZodError = {
      formErrors: [],
      fieldErrors: { avatarUrl: [], displayName: ["Required"] },
    };
    expect(summarizeZodError(flattened)).toBe("Display name: Required");
  });

  it("falls back to a generic message when there is nothing to say", () => {
    expect(summarizeZodError({ formErrors: [], fieldErrors: {} })).toBe("Invalid input");
  });
});

// ── formatTRPCError ────────────────────────────────────────────────────────

describe("formatTRPCError", () => {
  const profileSchema = z.object({
    displayName: z.string().min(1, "Display name is required"),
    avatarUrl: z
      .string()
      .url()
      .refine((v) => v.startsWith("https://"), "Must be an https:// URL"),
  });

  it("exposes flattened fieldErrors on data.zodError", () => {
    const error = badRequestFrom(
      zodErrorFor(profileSchema, { displayName: "", avatarUrl: "http://example.com/a.png" })
    );

    const formatted = formatTRPCError({ shape: baseShape, error });

    expect(formatted.data.zodError).toEqual({
      formErrors: [],
      fieldErrors: {
        displayName: ["Display name is required"],
        avatarUrl: ["Must be an https:// URL"],
      },
    });
  });

  it("replaces the stringified ZodError message with a field-attributed one", () => {
    const error = badRequestFrom(
      zodErrorFor(profileSchema, { displayName: "Alex", avatarUrl: "http://example.com/a.png" })
    );

    const formatted = formatTRPCError({ shape: baseShape, error });

    expect(formatted.message).toBe("Avatar URL: Must be an https:// URL");
    // The blob this issue exists to kill: a JSON array literal in a toast.
    expect(formatted.message).not.toContain("[");
    expect(formatted.message).not.toContain('"code"');
  });

  it("leaves non-Zod errors completely untouched", () => {
    const error = new TRPCError({ code: "FORBIDDEN", message: "No creator workspace" });
    const shape = { ...baseShape, message: "No creator workspace" };

    const formatted = formatTRPCError({ shape, error });

    expect(formatted.message).toBe("No creator workspace");
    expect(formatted.data.zodError).toBeNull();
    expect(formatted.data.code).toBe("BAD_REQUEST");
    expect(formatted.code).toBe(baseShape.code);
  });

  it("leaves an internal ZodError alone — same cause, different phase", () => {
    // A procedure body parsing an untrusted payload (webhook, platform sync).
    const webhookSchema = z.object({ secretInternalField: z.string() });
    const error = internalErrorFrom(zodErrorFor(webhookSchema, { secretInternalField: 42 }));
    const shape = { ...baseShape, message: "internal server error" };

    const formatted = formatTRPCError({ shape, error });

    // Not reformatted into a friendly, creator-fixable sentence...
    expect(formatted.message).toBe("internal server error");
    // ...and our internal field names stay off the wire.
    expect(formatted.data.zodError).toBeNull();
  });

  it("still formats a BAD_REQUEST a procedure body raises deliberately", () => {
    // An explicit "the caller sent this" signal is a validation failure even
    // though it did not come from the input parser.
    const error = badRequestFrom(zodErrorFor(profileSchema, { displayName: "Alex" }));

    const formatted = formatTRPCError({ shape: baseShape, error });

    expect(formatted.message).toBe("Avatar URL: Required");
    expect(formatted.data.zodError).not.toBeNull();
  });

  it("preserves every other key on the default shape", () => {
    const error = badRequestFrom(zodErrorFor(profileSchema, {}));
    const formatted = formatTRPCError({ shape: baseShape, error });

    expect(formatted.code).toBe(baseShape.code);
    expect(formatted.data.httpStatus).toBe(400);
    expect(formatted.data.path).toBe("settings.updateProfile");
  });
});

// ── Wired into the real root ───────────────────────────────────────────────

/**
 * The unit tests above prove the formatter; this proves the root actually uses
 * it. It runs a validation failure through the same fetch adapter app.ts
 * mounts, so it asserts the JSON body a browser client really receives —
 * including surviving superjson serialization of the error shape.
 */
describe("tRPC root wiring", () => {
  const router = createTRPCRouter({
    echo: publicProcedure
      .input(z.object({ avatarUrl: z.string().url("Enter a valid URL") }))
      .mutation(({ input }) => input),
    boom: publicProcedure.mutation(() => {
      throw new TRPCError({ code: "FORBIDDEN", message: "No creator workspace" });
    }),
    // Stands in for the first webhook / platform-sync handler: the *body*
    // parses a payload the creator never typed and never sees.
    parseUntrusted: publicProcedure.mutation(() => {
      const payloadFromThirdParty = { secretInternalField: 42 };
      return z.object({ secretInternalField: z.string() }).parse(payloadFromThirdParty);
    }),
  });

  async function call(path: string, input: unknown) {
    const res = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request(`http://localhost/api/trpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(superjson.serialize(input)),
      }),
      router,
      createContext: () => ({ session: null, creatorId: null, db: {} as never }),
    });
    const body = (await res.json()) as {
      error?: { json?: Record<string, any> } & Record<string, any>;
    };
    // superjson wraps the payload under `json`; unwrap if present.
    const error = body.error ? body.error.json ?? body.error : undefined;
    return { status: res.status, error };
  }

  it("returns a readable message and structured zodError over the wire", async () => {
    const { status, error } = await call("echo", { avatarUrl: "not-a-url" });

    expect(status).toBe(400);
    expect(error!.message).toBe("Avatar URL: Enter a valid URL");
    expect(error!.data.zodError.fieldErrors).toEqual({ avatarUrl: ["Enter a valid URL"] });
    expect(error!.data.code).toBe("BAD_REQUEST");
  });

  it("sends zodError: null for errors that are not validation failures", async () => {
    const { error } = await call("boom", {});

    expect(error!.message).toBe("No creator workspace");
    expect(error!.data.code).toBe("FORBIDDEN");
    expect(error!.data.zodError).toBeNull();
  });

  /**
   * The SPO-117 regression. Both phases produce a TRPCError whose `cause` is a
   * ZodError; only the code tells them apart. Before the fix this call came back
   * 500 but with `message: "Secret internal field: Expected string, received
   * number"` and `data.zodError.fieldErrors.secretInternalField` on the wire.
   */
  it("does not reformat a ZodError thrown inside a procedure body", async () => {
    const { status, error } = await call("parseUntrusted", {});

    expect(status).toBe(500);
    expect(error!.data.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error!.data.zodError).toBeNull();
    expect(error!.message).not.toContain("Secret internal field");
  });

  it("does not disturb successful calls", async () => {
    const { status, error } = await call("echo", { avatarUrl: "https://example.com" });

    expect(status).toBe(200);
    expect(error).toBeUndefined();
  });
});
