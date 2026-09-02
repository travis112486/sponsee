import { describe, it, expect, vi, afterEach } from "vitest";
import { z, ZodError } from "zod";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import {
  DEFAULT_MESSAGE_BY_CODE,
  INTERNAL_ERROR_MESSAGE,
  formatTRPCError,
  humanizeFieldName,
  logTRPCError,
  summarizeZodError,
  type FlattenedZodError,
} from "./error-formatter.js";
import { createTRPCRouter, publicProcedure } from "./trpc.js";
import { QuotaExceededError } from "./storage/errors.js";

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

/**
 * The realistic non-500 cause. A unique violation is the one a `CONFLICT` gets
 * built from, and Postgres puts the constraint name, the columns *and* the
 * conflicting values in the message — creator ids and brand names included.
 * Every assertion below searches for those raw substrings rather than for a
 * humanized label; a label is what SPO-117's assertion checked while the raw
 * text sailed past it.
 */
const PG_UNIQUE_VIOLATION = new Error(
  'duplicate key value violates unique constraint "deals_creator_id_brand_id_uq" — ' +
    "Key (creator_id, brand_id)=(cr_8fa21c, br_nordvpn) already exists."
);

/** A rethrown SDK failure: a `BAD_REQUEST` whose cause is not a ZodError. */
const STRIPE_SDK_FAILURE = new Error(
  "No such price: 'price_1QhSecretInternalId'; a similar object exists in test mode"
);

/**
 * The shape tRPC's own `getErrorShape` hands the formatter, built from the error
 * rather than invented by the test. `message` is `error.message` *verbatim* —
 * that identity is the whole subject of these tests, so a fixture that sets its
 * own message would assert against a body no client ever receives.
 */
function shapeFor(error: TRPCError, data: Record<string, unknown> = {}) {
  return {
    message: error.message,
    code: -32603,
    data: {
      code: error.code,
      httpStatus: 500,
      path: "platforms.sync",
      ...data,
    },
  };
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

  // SPO-349: the UI needs a real "X of Y used" message, not a generic
  // FORBIDDEN — so this cause's message and its extra fields both survive
  // the scrub that would otherwise apply to a non-500 with no authored text.
  it("publishes a QuotaExceededError's message and structured fields", () => {
    const cause = new QuotaExceededError(5_368_198_246, 5 * 1024 * 1024 * 1024, "starter");
    const error = new TRPCError({ code: "FORBIDDEN", cause });
    const shape = { ...baseShape, message: cause.message, data: { ...baseShape.data, code: "FORBIDDEN" } };

    const formatted = formatTRPCError({ shape, error });

    expect(formatted.message).toBe(cause.message);
    expect(formatted.message).toMatch(/starter plan's storage limit/);
    expect(formatted.data.usedBytes).toBe(5_368_198_246);
    expect(formatted.data.capBytes).toBe(5 * 1024 * 1024 * 1024);
    expect(formatted.data.planTier).toBe("starter");
    expect(formatted.data.zodError).toBeNull();
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

  it("never dresses an internal ZodError up as creator-fixable input", () => {
    // A procedure body parsing an untrusted payload (webhook, platform sync).
    const webhookSchema = z.object({ secretInternalField: z.string(), apiToken: z.string() });
    const error = internalErrorFrom(
      zodErrorFor(webhookSchema, { secretInternalField: 42, apiToken: 7 })
    );

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.data.zodError).toBeNull();
    // Assert the *raw* path names carried by the ZodError's JSON dump, not the
    // humanized labels the formatter would have produced. SPO-117's assertion
    // checked "Secret internal field" and passed while the dump — containing
    // `secretInternalField` — was still going out on `message`.
    expect(formatted.message).not.toContain("secretInternalField");
    expect(formatted.message).not.toContain("apiToken");
    expect(formatted.message).not.toContain("invalid_type");
    expect(formatted.message).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("scrubs a 500 message inherited from any cause, not just a Zod one", () => {
    // `TRPCError({ code, cause })` with no message inherits `cause.message`, so
    // whatever a driver or SDK put in there becomes the wire message.
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: new Error('column "stripe_customer_id" does not exist'),
    });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).not.toContain("stripe_customer_id");
    expect(formatted.message).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("preserves a 500 message the procedure authored, cause and all", () => {
    // chase.ts's enqueue failure: a deliberate, creator-actionable sentence on a
    // 500 with an internal cause attached. This is the blast-radius guard.
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to queue chase email. Please retry.",
      cause: new Error("connect ECONNREFUSED 10.0.0.5:6379"),
    });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).toBe("Failed to queue chase email. Please retry.");
    expect(formatted.message).not.toContain("ECONNREFUSED");
  });

  it("does not pass tRPC's bare code fallback off as a message", () => {
    // No message and no cause: tRPC falls back to the code string itself.
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("scrubs a cause-inherited message on a non-500 too", () => {
    // The SPO-129 hole: message inheritance is not a property of the 500 code.
    // `TRPCError({ code, cause })` resolves `opts.message ?? cause?.message ??
    // opts.code` for every code, so a driver's sentence — constraint name,
    // column, sometimes the conflicting value — rides out on a CONFLICT.
    const error = new TRPCError({ code: "CONFLICT", cause: PG_UNIQUE_VIOLATION });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).not.toContain("deals_creator_id_brand_id_uq");
    expect(formatted.message).not.toContain("unique constraint");
    expect(formatted.message).not.toContain("duplicate key");
    // Postgres names the conflicting values, not just the constraint.
    expect(formatted.message).not.toContain("cr_8fa21c");
    expect(formatted.message).not.toContain("br_nordvpn");
    // A 409 is usually something the creator can act on, so it gets a sentence
    // of its own rather than the 500's "went wrong on our end".
    expect(formatted.message).toBe(
      "That conflicts with something that already exists. Refresh and try again."
    );
    expect(formatted.message).not.toBe(INTERNAL_ERROR_MESSAGE);
  });

  it.each([
    ["PRECONDITION_FAILED", "This changed somewhere else. Refresh and try again."],
    [
      "UNPROCESSABLE_CONTENT",
      "We could not process that. Please check what you entered and try again.",
    ],
    ["TIMEOUT", "That took too long to finish. Please try again."],
  ] as const)("scrubs a cause-inherited message on a %s as well", (code, expected) => {
    // Pinned literals, not a derived list: the point is that the guard is not
    // keyed on the code at all, so it must hold for codes nobody has used yet.
    // The expected sentence is pinned here too rather than read back out of
    // DEFAULT_MESSAGE_BY_CODE — a test that indexes the table it is checking
    // passes for any value the table happens to hold.
    const error = new TRPCError({
      code,
      cause: new Error("connect ECONNREFUSED 10.0.0.5:6379"),
    });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).not.toContain("ECONNREFUSED");
    expect(formatted.message).not.toContain("10.0.0.5");
    expect(formatted.message).toBe(expected);
  });

  it("scrubs a BAD_REQUEST whose cause is not a ZodError", () => {
    // Misses the zod branch — which gates on `cause instanceof ZodError` — and
    // misses the 500 branch, so before SPO-131 it fell straight through with
    // the SDK's text on `message`. Wider than the case SPO-129 covered.
    const error = new TRPCError({ code: "BAD_REQUEST", cause: STRIPE_SDK_FAILURE });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).not.toContain("price_1QhSecretInternalId");
    expect(formatted.message).not.toContain("No such price");
    expect(formatted.message).toBe(
      "That request was not valid. Please check what you entered and try again."
    );
    expect(formatted.data.zodError).toBeNull();
  });

  it("scrubs a 5xx-family code the same way it scrubs a 500", () => {
    // NOT_IMPLEMENTED, BAD_GATEWAY, SERVICE_UNAVAILABLE and GATEWAY_TIMEOUT
    // share INTERNAL_SERVER_ERROR's JSON-RPC number (-32603) and HTTP class, so
    // a branch keyed on the string "INTERNAL_SERVER_ERROR" misses all four.
    const error = new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      cause: new Error("connect ECONNREFUSED 10.0.0.5:5432"),
    });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).not.toContain("ECONNREFUSED");
    expect(formatted.message).not.toContain("10.0.0.5");
    expect(formatted.message).toBe(
      "That service is temporarily unavailable. Please try again in a moment."
    );
  });

  it.each([
    ["PRECONDITION_FAILED", "No Stripe customer found"],
    ["UNPROCESSABLE_CONTENT", "Deal is already paid"],
    ["TIMEOUT", "That took too long — try again"],
  ] as const)("keeps an authored %s sentence, cause and all", (code, message) => {
    const error = new TRPCError({
      code,
      message,
      cause: new Error("connect ECONNREFUSED 10.0.0.5:6379"),
    });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).toBe(message);
  });

  it("keeps the authored non-500 sentences creators actually see", () => {
    // settings.ts's rate-limit line and NOT_FOUND guards, verbatim from source.
    // Widening the scrub must be a no-op on every call site that exists today.
    const authored = [
      new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many syncs — try again in 42s" }),
      new TRPCError({ code: "NOT_FOUND", message: "Platform not found" }),
      new TRPCError({ code: "FORBIDDEN", message: "No creator workspace" }),
      new TRPCError({ code: "BAD_REQUEST", message: "Add a channel handle first" }),
    ];

    for (const error of authored) {
      const formatted = formatTRPCError({ shape: shapeFor(error), error });
      expect(formatted.message).toBe(error.message);
    }
  });

  it("answers tRPC's bare code fallback with a sentence, not the code", () => {
    // trpc.ts:18 throws `TRPCError({ code: "UNAUTHORIZED" })` with no message,
    // so its wire message was the code string. `apps/web/src/trpc.tsx` has no
    // 401 interceptor and the panels do `toast.error(err.message)`, so a
    // creator whose session lapsed read the enum name "UNAUTHORIZED" in a
    // toast. The code itself is not lost — it stays on `data.code`, which is
    // where a client should branch on it anyway.
    const error = new TRPCError({ code: "UNAUTHORIZED" });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).toBe("Please sign in and try again.");
    expect(formatted.message).not.toBe("UNAUTHORIZED");
    expect(formatted.message).not.toBe(INTERNAL_ERROR_MESSAGE);
    expect(formatted.data.code).toBe("UNAUTHORIZED");
  });

  it("drops the dev-only stack when it scrubs a non-500", () => {
    // A V8 stack opens with `${name}: ${message}`, so the inherited text the
    // scrub just removed from `message` is still on the trace's first line.
    const error = new TRPCError({ code: "CONFLICT", cause: PG_UNIQUE_VIOLATION });
    // Fixture sanity: if the stack did not carry it, the guard below would pass
    // without proving anything.
    expect(error.stack).toContain("deals_creator_id_brand_id_uq");

    const formatted = formatTRPCError({ shape: shapeFor(error, { stack: error.stack }), error });

    expect(formatted.data.stack).toBeUndefined();
  });

  it("drops the dev-only stack even on an authored non-500", () => {
    // Widened from "keep it when the message was ours" (SPO-129's rule). A
    // trace is never publishable whoever wrote the sentence in front of it: it
    // carries absolute paths and our internal call structure, and the creator
    // can do nothing with either. tRPC's own unknown-procedure NOT_FOUND is the
    // live example — authored by the library, full trace attached.
    const error = new TRPCError({ code: "NOT_FOUND", message: "Platform not found" });

    const formatted = formatTRPCError({
      shape: shapeFor(error, { stack: "Error: at /srv/app/apps/api/src/settings.ts:41" }),
      error,
    });

    expect(formatted.message).toBe("Platform not found");
    expect(formatted.data.stack).toBeUndefined();
  });

  it("drops the dev-only stack from a 500", () => {
    // tRPC only withholds `data.stack` when NODE_ENV is exactly "production",
    // and the stack of an escaped ZodError *is* the issue dump again.
    const error = internalErrorFrom(zodErrorFor(z.object({ apiToken: z.string() }), {}));

    const formatted = formatTRPCError({ shape: shapeFor(error, { stack: error.stack }), error });

    expect(formatted.data.stack).toBeUndefined();
  });

  it("drops the dev-only stack from a validation failure too", () => {
    // The last branch that still published a trace. The creator's own bad form
    // data is fully described by `message` and `data.zodError`; the trace adds
    // only our file layout, so it goes with the rest.
    const error = badRequestFrom(zodErrorFor(profileSchema, {}));
    const shape = {
      ...baseShape,
      data: { ...baseShape.data, stack: "Error: at /srv/app/apps/api/src/settings.ts:41" },
    };

    const formatted = formatTRPCError({ shape, error });

    // The expanded sentence is untouched — only the trace goes.
    expect(formatted.message).toBe("Display name: Required; Avatar URL: Required");
    expect(formatted.data.zodError).not.toBeNull();
    expect(formatted.data.stack).toBeUndefined();
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

  it("preserves an authored 4xx sentence, cause and all", () => {
    // The blast-radius guard for the widened scrub, and the reason a 4xx cannot
    // just reuse INTERNAL_ERROR_MESSAGE: this sentence is the creator's way out.
    const error = new TRPCError({
      code: "CONFLICT",
      message: "That brand already has an open deal. Close it first.",
      cause: PG_UNIQUE_VIOLATION,
    });

    const formatted = formatTRPCError({ shape: shapeFor(error), error });

    expect(formatted.message).toBe("That brand already has an open deal. Close it first.");
    expect(formatted.message).not.toContain("deals_creator_id_brand_id_uq");
  });
});

// ── DEFAULT_MESSAGE_BY_CODE ────────────────────────────────────────────────

describe("DEFAULT_MESSAGE_BY_CODE", () => {
  it("gives every code a sentence rather than an identifier", () => {
    const entries = Object.entries(DEFAULT_MESSAGE_BY_CODE);
    // Iterating the map only proves what the map happens to contain, so the
    // count is pinned too: deleting a code to make this pass is a visible edit,
    // not a silent one. The `Record<TRPCError["code"], string>` type is the
    // guard against a tRPC upgrade *adding* one.
    expect(entries).toHaveLength(21);

    for (const [code, message] of entries) {
      expect(message).not.toBe(code);
      expect(message).not.toMatch(/_/);
      expect(message).toMatch(/^[A-Z].*[.!]$/);
    }
  });

  it("pins the copy for the codes procedures actually throw today", () => {
    expect(DEFAULT_MESSAGE_BY_CODE.UNAUTHORIZED).toBe("Please sign in and try again.");
    expect(DEFAULT_MESSAGE_BY_CODE.FORBIDDEN).toBe("You do not have access to that.");
    expect(DEFAULT_MESSAGE_BY_CODE.NOT_FOUND).toBe("We could not find that.");
    expect(DEFAULT_MESSAGE_BY_CODE.INTERNAL_SERVER_ERROR).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("does not answer a 4xx with the 500's sentence", () => {
    // A CONFLICT or a FORBIDDEN is usually something the creator can act on.
    // "Something went wrong on our end" would make a fixable error look like
    // our outage and strand them.
    const actionable = [
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "PAYMENT_REQUIRED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "TOO_MANY_REQUESTS",
    ] as const;

    for (const code of actionable) {
      expect(DEFAULT_MESSAGE_BY_CODE[code]).not.toBe(INTERNAL_ERROR_MESSAGE);
    }
  });
});

// ── logTRPCError ───────────────────────────────────────────────────────────

describe("logTRPCError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the message the wire no longer carries", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error('column "stripe_customer_id" does not exist');
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });

    logTRPCError({ error, path: "billing.createCheckoutSession" });

    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("billing.createCheckoutSession");
    expect(logged).toContain("stripe_customer_id");
  });

  it("keeps the cause, which never reaches the shape at all", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("redis://internal-queue:6379 unreachable");
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to queue chase email. Please retry.",
      cause,
    });

    logTRPCError({ error, path: "chase.approve" });

    expect(spy.mock.calls.flat()).toContain(cause);
  });

  it("stays quiet for errors that are not incidents", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logTRPCError({ error: new TRPCError({ code: "UNAUTHORIZED" }), path: "deals.list" });
    logTRPCError({ error: badRequestFrom(zodErrorFor(z.string(), 1)), path: "deals.create" });
    // Worded by the procedure, so the creator already has the actionable half
    // and nothing was withheld from them.
    logTRPCError({
      error: new TRPCError({ code: "NOT_FOUND", message: "Platform not found" }),
      path: "settings.sync",
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("logs a non-500 cause the formatter scrubs, which nothing else would keep", () => {
    // The counterpart to the widened scrub: once a CONFLICT's inherited message
    // stops reaching the client, this is the only place the detail survives.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error(
      'duplicate key value violates unique constraint "deals_creator_id_brand_id_uq"'
    );

    logTRPCError({ error: new TRPCError({ code: "CONFLICT", cause }), path: "deals.create" });

    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("deals.create");
    expect(logged).toContain("deals_creator_id_brand_id_uq");
    expect(spy.mock.calls.flat()).toContain(cause);
  });

  it("logs a BAD_REQUEST whose cause is not a ZodError", () => {
    // Now scrubbed by the formatter, so this is the only surviving copy. The
    // zod-caused BAD_REQUEST above stays quiet because its message is expanded
    // onto the wire rather than withheld from it.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new TRPCError({ code: "BAD_REQUEST", cause: STRIPE_SDK_FAILURE });

    logTRPCError({ error, path: "billing.createCheckoutSession" });

    expect(spy.mock.calls.flat().join(" ")).toContain("price_1QhSecretInternalId");
  });

  it("logs the whole 5xx family, not only INTERNAL_SERVER_ERROR", () => {
    // A server fault is an incident whatever it says, so it is logged even when
    // the sentence on the wire is one we wrote. Keyed on the string
    // "INTERNAL_SERVER_ERROR", these four went unlogged.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const code of [
      "NOT_IMPLEMENTED",
      "BAD_GATEWAY",
      "SERVICE_UNAVAILABLE",
      "GATEWAY_TIMEOUT",
    ] as const) {
      logTRPCError({
        error: new TRPCError({ code, message: `Upstream refused (${code})` }),
        path: "platforms.sync",
      });
    }

    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("Upstream refused (NOT_IMPLEMENTED)");
    expect(logged).toContain("Upstream refused (BAD_GATEWAY)");
    expect(logged).toContain("Upstream refused (SERVICE_UNAVAILABLE)");
    expect(logged).toContain("Upstream refused (GATEWAY_TIMEOUT)");
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
      const payloadFromThirdParty = { secretInternalField: 42, apiToken: 7 };
      return z
        .object({ secretInternalField: z.string(), apiToken: z.string() })
        .parse(payloadFromThirdParty);
    }),
    // A plain throw escaping a body — the ordinary 500. tRPC wraps it via
    // `getTRPCErrorFromUnknown`, which inherits the message the same way.
    explodes: publicProcedure.mutation(() => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    }),
    // The SPO-129 shape: a non-500 wrapping a driver error with no message of
    // its own. tRPC inherits `cause.message`, so the constraint name is the
    // wire message unless the formatter scrubs codes other than 500.
    conflicts: publicProcedure.mutation(() => {
      throw new TRPCError({ code: "CONFLICT", cause: PG_UNIQUE_VIOLATION });
    }),
    // SPO-131's wider case: a BAD_REQUEST whose cause is not a ZodError misses
    // the zod branch and the 500 branch both.
    rejectedBySdk: publicProcedure.mutation(() => {
      throw new TRPCError({ code: "BAD_REQUEST", cause: STRIPE_SDK_FAILURE });
    }),
    // The same code, worded by the procedure — billing/router.ts:71's shape.
    // The creator-facing sentence must survive the widened scrub.
    authoredConflict: publicProcedure.mutation(() => {
      throw new TRPCError({
        code: "CONFLICT",
        message: "You already have an active subscription.",
        cause: new Error('duplicate key value violates unique constraint "subs_uq"'),
      });
    }),
    // trpc.ts:18's bare guard: no message, no cause. tRPC falls back to the code
    // string, which a creator would read as "UNAUTHORIZED" in a toast; the
    // per-code table replaces it with a sentence. The only live copy change here.
    guarded: publicProcedure.mutation(() => {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }),
    // A 500 we phrased ourselves, with an internal cause attached — the
    // chase.ts:296 shape. The sentence must survive; the cause must not.
    authoredFailure: publicProcedure.mutation(() => {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to queue chase email. Please retry.",
        cause: new Error("redis://internal-queue:6379 unreachable"),
      });
    }),
  });

  async function call(path: string, input: unknown, onError?: (opts: any) => void) {
    const res = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request(`http://localhost/api/trpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(superjson.serialize(input)),
      }),
      router,
      createContext: () => ({ session: null, creatorId: null, db: {} as never }),
      onError,
    });
    // Keep the untouched bytes: `message` was not the only key leaking the dump,
    // so the assertions below search the whole body rather than one field.
    const raw = await res.text();
    const body = JSON.parse(raw) as {
      error?: { json?: Record<string, any> } & Record<string, any>;
    };
    // superjson wraps the payload under `json`; unwrap if present.
    const error = body.error ? body.error.json ?? body.error : undefined;
    return { status: res.status, error, raw };
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
   * The SPO-117 regression, re-cut against the raw body. SPO-117 stopped the
   * dump reaching `data.zodError`, but `new TRPCError({ code, cause })` inherits
   * `cause.message`, and a ZodError's message *is* the JSON dump of every issue
   * with its field path — so it kept going out on `message`, and on `data.stack`
   * in every environment where NODE_ENV is not exactly "production".
   */
  it("publishes no part of an internal ZodError anywhere in the body", async () => {
    const { status, error, raw } = await call("parseUntrusted", {});

    expect(status).toBe(500);
    expect(error!.data.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error!.data.zodError).toBeNull();
    expect(raw).not.toContain("secretInternalField");
    expect(raw).not.toContain("apiToken");
    expect(raw).not.toContain("invalid_type");
    expect(error!.message).toBe(INTERNAL_ERROR_MESSAGE);
    // The dev-only stack is the same dump a second time. tRPC keeps it whenever
    // NODE_ENV is not exactly "production" — including under vitest, right now.
    expect(error!.data.stack).toBeUndefined();
  });

  it("publishes nothing about an ordinary uncaught throw", async () => {
    const { status, error, raw } = await call("explodes", {});

    expect(status).toBe(500);
    expect(error!.data.code).toBe("INTERNAL_SERVER_ERROR");
    expect(raw).not.toContain("ECONNREFUSED");
    expect(raw).not.toContain("10.0.0.5");
    expect(error!.message).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("hands the scrubbed detail to onError instead of the client", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { raw } = await call("explodes", {}, logTRPCError);

    // Gone from the response, present in the log: the exchange this fix makes.
    expect(raw).not.toContain("ECONNREFUSED");
    expect(spy.mock.calls.flat().join(" ")).toContain("ECONNREFUSED 10.0.0.5:5432");
    expect(spy.mock.calls.flat().join(" ")).toContain("explodes");

    spy.mockRestore();
  });

  it("publishes no part of a driver error carried by a non-500", async () => {
    const { status, error, raw } = await call("conflicts", {});

    expect(status).toBe(409);
    expect(error!.data.code).toBe("CONFLICT");
    expect(raw).not.toContain("deals_creator_id_brand_id_uq");
    expect(raw).not.toContain("unique constraint");
    expect(raw).not.toContain("duplicate key");
    // Postgres names the conflicting rows, so the creator id and the brand
    // handle are in that message too.
    expect(raw).not.toContain("cr_8fa21c");
    expect(raw).not.toContain("br_nordvpn");
    // The stack carries the same sentence on its first line.
    expect(error!.data.stack).toBeUndefined();
    // Still actionable: a 409 tells the creator what to do, so it must not be
    // answered with the 500's "something went wrong on our end".
    expect(error!.message).not.toBe(INTERNAL_ERROR_MESSAGE);
    expect(error!.message).toBe(
      "That conflicts with something that already exists. Refresh and try again."
    );
  });

  it("publishes no part of a non-Zod BAD_REQUEST's cause", async () => {
    const { status, error, raw } = await call("rejectedBySdk", {});

    expect(status).toBe(400);
    expect(raw).not.toContain("price_1QhSecretInternalId");
    expect(raw).not.toContain("No such price");
    expect(error!.data.zodError).toBeNull();
    expect(error!.data.stack).toBeUndefined();
  });

  it("still sends a non-500 message the procedure authored", async () => {
    const { status, error, raw } = await call("authoredConflict", {});

    expect(status).toBe(409);
    expect(error!.message).toBe("You already have an active subscription.");
    expect(raw).not.toContain("subs_uq");
  });

  it("sends a sentence, not the bare code, when a session has lapsed", async () => {
    const { status, error } = await call("guarded", {});

    expect(status).toBe(401);
    // The code a client branches on is untouched; only the human sentence moved.
    expect(error!.data.code).toBe("UNAUTHORIZED");
    expect(error!.message).toBe("Please sign in and try again.");
  });

  it("publishes no trace on an authored 4xx either", async () => {
    // `boom` throws a FORBIDDEN it worded itself, so nothing is scrubbed from
    // `message` — but tRPC still attaches `data.stack` outside production, and
    // that trace names our source paths.
    const { status, error, raw } = await call("boom", {});

    expect(status).toBe(403);
    expect(error!.message).toBe("No creator workspace");
    expect(error!.data.stack).toBeUndefined();
    expect(raw).not.toContain("error-formatter");
  });

  it("publishes no trace on tRPC's own unknown-procedure NOT_FOUND", async () => {
    // The live instance of the case above: tRPC authors this message itself and
    // attaches a full absolute-path trace through node_modules. Nothing in our
    // code throws it, so only a rule that covers authored messages catches it.
    const { status, error, raw } = await call("noSuchProcedure", {});

    expect(status).toBe(404);
    expect(error!.data.code).toBe("NOT_FOUND");
    expect(error!.data.stack).toBeUndefined();
    expect(raw).not.toContain("node_modules");
    expect(raw).not.toContain("/apps/api/");
  });

  it("hands a scrubbed non-500 cause to onError instead of the client", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { raw } = await call("conflicts", {}, logTRPCError);

    expect(raw).not.toContain("deals_creator_id_brand_id_uq");
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("deals_creator_id_brand_id_uq");
    expect(logged).toContain("conflicts");

    spy.mockRestore();
  });

  it("still sends a 500 message the procedure authored", async () => {
    const { status, error, raw } = await call("authoredFailure", {});

    expect(status).toBe(500);
    expect(error!.message).toBe("Failed to queue chase email. Please retry.");
    expect(raw).not.toContain("internal-queue");
  });

  it("does not disturb successful calls", async () => {
    const { status, error } = await call("echo", { avatarUrl: "https://example.com" });

    expect(status).toBe(200);
    expect(error).toBeUndefined();
  });
});
