import type { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { QuotaExceededError } from "./storage/errors.js";

/**
 * Flattened Zod failure, as it crosses the wire on `error.data.zodError`.
 *
 * `fieldErrors` is keyed by the *top-level* input key — `flatten()` collapses
 * nested paths onto their root — which is the shape react-hook-form's
 * `setError` consumes directly. Every tRPC input we accept today is a flat
 * object, so nothing is lost; a nested input would still surface its messages,
 * just attributed to the containing key.
 */
export type FlattenedZodError = {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
};

const ACRONYMS = new Set(["url", "id", "ccv", "cpvh", "usd", "api", "ppv"]);

/**
 * `avatarUrl` → `Avatar URL`. Input keys are camelCase and go straight into a
 * user-facing sentence, so they need to read as words, not identifiers.
 */
export function humanizeFieldName(field: string): string {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_.]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.toLowerCase()));

  if (words.length === 0) return field;

  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/**
 * Turn a flattened ZodError into one readable line.
 *
 * tRPC's default `message` for an input-validation failure is the stringified
 * `ZodError` — a JSON array literal. Callers that do `toast.error(err.message)`
 * (which is every panel) render that blob verbatim, with no field attribution.
 * Rewriting `message` here fixes those call sites without touching them; the
 * structured `zodError` below is for forms that can do better than a toast.
 */
export function summarizeZodError(flattened: FlattenedZodError): string {
  const parts: string[] = [];

  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    if (!messages || messages.length === 0) continue;
    parts.push(`${humanizeFieldName(field)}: ${messages.join(", ")}`);
  }

  for (const message of flattened.formErrors) {
    if (message) parts.push(message);
  }

  return parts.length > 0 ? parts.join("; ") : "Invalid input";
}

/** The parts of tRPC's default error shape this formatter reads. */
type ErrorShapeLike = { message: string; data: Record<string, unknown> };

/**
 * What a creator sees when a procedure fails for a reason they cannot act on.
 *
 * A 500 is by definition our bug, not their input. There is nothing in the real
 * error a creator could use, and plenty in it we do not want to publish.
 */
export const INTERNAL_ERROR_MESSAGE = "Something went wrong on our end. Please try again.";

/** Every error code tRPC can put on the wire. */
type TRPCErrorCode = TRPCError["code"];

/**
 * The codes that mean *we* failed, not the caller.
 *
 * tRPC gives four more codes INTERNAL_SERVER_ERROR's JSON-RPC number (-32603)
 * and its HTTP class. They carry our internals for the same reason a 500 does
 * and tell the creator nothing they can act on, so they get a 500's treatment —
 * scrub unless authored, and log every one. A branch keyed on the string
 * "INTERNAL_SERVER_ERROR" silently misses all four.
 */
const SERVER_FAULT_CODES = new Set<TRPCErrorCode>([
  "INTERNAL_SERVER_ERROR",
  "NOT_IMPLEMENTED",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
]);

function isServerFault(code: TRPCErrorCode): boolean {
  return SERVER_FAULT_CODES.has(code);
}

/**
 * What to publish when the message we would otherwise send is not ours to send:
 * inherited from a cause, or tRPC's bare code string.
 *
 * One generic sentence for everything would be wrong. It is right for a 500 —
 * our bug, nothing in it a creator could use — but a CONFLICT or a FORBIDDEN is
 * usually something they *can* act on, and answering those with "something went
 * wrong on our end" turns a fixable error into an apparent outage and strands
 * them. So each code gets a default that says what happened and, where there is
 * one, what to do about it.
 *
 * These are fallbacks, not the norm. A procedure that words its own message
 * keeps it (see `isAuthoredMessage`); this is what a creator sees when nobody
 * wrote anything for them, which today is the lapsed-session UNAUTHORIZED in
 * trpc.ts and, from here on, any call site that attaches a `cause` and no text.
 *
 * Typed as a total Record over tRPC's code union deliberately: a tRPC upgrade
 * that adds a code fails typecheck here, rather than silently falling back to
 * the raw code string this table exists to keep off the wire.
 */
export const DEFAULT_MESSAGE_BY_CODE: Record<TRPCErrorCode, string> = {
  // Ours to fix. Nothing actionable, so say nothing specific.
  INTERNAL_SERVER_ERROR: INTERNAL_ERROR_MESSAGE,
  NOT_IMPLEMENTED: INTERNAL_ERROR_MESSAGE,
  BAD_GATEWAY: INTERNAL_ERROR_MESSAGE,
  SERVICE_UNAVAILABLE: "That service is temporarily unavailable. Please try again in a moment.",
  GATEWAY_TIMEOUT: "That took too long to finish. Please try again.",

  // Theirs to act on. Name the problem and the way out.
  PARSE_ERROR: "We could not read that request. Please try again.",
  BAD_REQUEST: "That request was not valid. Please check what you entered and try again.",
  UNAUTHORIZED: "Please sign in and try again.",
  PAYMENT_REQUIRED: "Your plan does not include this. Upgrade in Settings to continue.",
  FORBIDDEN: "You do not have access to that.",
  NOT_FOUND: "We could not find that.",
  METHOD_NOT_SUPPORTED: "That action is not supported here.",
  TIMEOUT: "That took too long to finish. Please try again.",
  CONFLICT: "That conflicts with something that already exists. Refresh and try again.",
  PRECONDITION_FAILED: "This changed somewhere else. Refresh and try again.",
  PRECONDITION_REQUIRED: "This changed somewhere else. Refresh and try again.",
  PAYLOAD_TOO_LARGE: "That is too large to send. Please try something smaller.",
  UNSUPPORTED_MEDIA_TYPE: "That file type is not supported.",
  UNPROCESSABLE_CONTENT: "We could not process that. Please check what you entered and try again.",
  TOO_MANY_REQUESTS: "Too many attempts. Please wait a moment and try again.",
  CLIENT_CLOSED_REQUEST: "That request was cancelled.",
};

/**
 * Is this message the thrown value's own text, handed to the client verbatim?
 *
 * `new TRPCError({ code, cause })` with no `message` inherits `cause.message` —
 * tRPC 11 resolves `opts.message ?? cause?.message ?? opts.code` — and an
 * uncaught throw is wrapped exactly the same way by `getTRPCErrorFromUnknown`.
 * So whenever this returns true, `error.message` is some library's internal
 * text: a ZodError's JSON dump of every failing field path, a driver's failed
 * query naming a constraint and column, an SDK's provider detail. tRPC's
 * default shape then passes it to `shape.message` in every environment.
 *
 * Nothing about that depends on the code. `TRPCError({ code: "CONFLICT", cause:
 * pgUniqueViolation })` publishes the driver's sentence exactly as a 500 would,
 * which is why this test is applied to every code rather than to 500s alone.
 *
 * Comparing against `cause.message` is the only signal available here, and it
 * fails closed: an authored message that happens to equal its cause's is
 * scrubbed, never the reverse. It also needs no cooperation from call sites, so
 * a procedure that words its own message keeps it without opting in.
 */
function isInheritedFromCause(error: TRPCError): boolean {
  return Boolean(error.cause) && error.message === error.cause!.message;
}

/**
 * A failure to parse the procedure's declared input — the creator's own form
 * data, which {@link summarizeZodError} rewrites into a readable sentence.
 *
 * Its message is inherited from the ZodError like any other, but it is the one
 * inherited message we publish (in expanded form) rather than scrub.
 */
function isInputValidationFailure(error: TRPCError): boolean {
  return error.code === "BAD_REQUEST" && error.cause instanceof ZodError;
}

/**
 * Storage quota rejection (SPO-349). Like the ZodError case above, this is a
 * cause the client needs structured, not just a sentence: the UI renders a
 * real "X of Y GB used" message from `usedBytes`/`capBytes`/`planTier` rather
 * than parsing them back out of prose.
 */
function isQuotaExceededFailure(error: TRPCError): error is TRPCError & { cause: QuotaExceededError } {
  return error.cause instanceof QuotaExceededError;
}

/**
 * Did a procedure deliberately phrase this message, or did it fall out of
 * whatever was thrown?
 *
 * Stricter than {@link isInheritedFromCause} by one case: no message and no
 * cause at all, where tRPC falls back to the code string itself. That fallback
 * is an enum name, not a sentence — "INTERNAL_SERVER_ERROR", "UNAUTHORIZED" —
 * and it reaches creators verbatim, since the panels render `err.message` into
 * a toast. It is not internal the way a driver's message is, but it is not
 * something we chose to show anyone either, so it is replaced on every code
 * rather than only on 500s (SPO-131). The code itself stays on `data.code`,
 * which is where a client should branch on it.
 */
function isAuthoredMessage(error: TRPCError): boolean {
  if (isInheritedFromCause(error)) return false;
  return error.message !== error.code;
}

/**
 * tRPC root `errorFormatter`. Applies to every router, and does three things:
 * drop the trace from every body, expand a validation failure into a readable
 * sentence, and publish nothing on any other error that we did not word
 * ourselves.
 *
 * Input validation is the special case. The phase matters as much as the cause. A ZodError raised while parsing the
 * procedure's declared input is a creator's own bad form data: tRPC wraps it as
 * `BAD_REQUEST`, and rewriting it into a readable sentence is the whole point of
 * this formatter. A ZodError raised *inside* a procedure body — `.parse()` on a
 * Stripe webhook payload, a platform-sync response — is an internal failure that
 * tRPC surfaces as `INTERNAL_SERVER_ERROR`. Formatting that one would dress a
 * server bug up as user-fixable input and publish our internal field names.
 *
 * (A body that deliberately throws `TRPCError({ code: "BAD_REQUEST", cause:
 * zodError })` still gets formatted. That is an explicit "this is the caller's
 * fault" signal from the procedure, not an escaped internal parse.)
 *
 * Everything else is scrubbed unless the procedure authored the message.
 * Dropping the ZodError from `data.zodError` alone does not keep it off the
 * wire — the same dump rides out on `message`, whose text a stack then repeats.
 * So a message we did not write is replaced with `DEFAULT_MESSAGE_BY_CODE[code]`
 * and the real error goes to the server log via `logTRPCError`.
 *
 * That scrub covers every code, not just `INTERNAL_SERVER_ERROR` (SPO-131). The
 * mechanism was never 500-specific: a `CONFLICT` built from a unique violation
 * inherits the constraint name and the conflicting values just as readily. What
 * *is* code-specific is the replacement sentence — see `DEFAULT_MESSAGE_BY_CODE`
 * for why a 4xx must not be answered with the 500's copy.
 */
export function formatTRPCError<TShape extends ErrorShapeLike>({
  shape,
  error,
}: {
  shape: TShape;
  error: TRPCError;
}) {
  // tRPC withholds `data.stack` only when NODE_ENV is exactly "production", so
  // on staging — and anywhere else NODE_ENV is not that string — every error
  // body carries a trace. It goes on all of them, in every branch below.
  //
  // A trace is never publishable, whoever wrote the sentence in front of it. It
  // repeats the message a V8 stack opens with `${name}: ${message}`, so it
  // re-publishes whatever the scrub just removed — and it names our absolute
  // paths and call structure besides, which no creator can act on. tRPC's own
  // unknown-procedure `NOT_FOUND` is the case that makes the point: authored by
  // the library, so no message-based rule reaches it, and it ships a full trace
  // through node_modules. `NODE_ENV === "production"` was the only thing
  // standing in front of all of that, and it is the wrong guard to rely on.
  const { stack: _stack, ...data } = shape.data;

  if (isInputValidationFailure(error)) {
    const zodError = (error.cause as ZodError).flatten() as FlattenedZodError;

    return {
      ...shape,
      message: summarizeZodError(zodError),
      data: { ...data, zodError },
    };
  }

  if (isQuotaExceededFailure(error)) {
    return {
      ...shape,
      message: error.cause.message,
      data: {
        ...data,
        zodError: null,
        usedBytes: error.cause.usedBytes,
        capBytes: error.cause.capBytes,
        planTier: error.cause.planTier,
      },
    };
  }

  return {
    ...shape,
    message: isAuthoredMessage(error) ? shape.message : DEFAULT_MESSAGE_BY_CODE[error.code],
    data: { ...data, zodError: null },
  };
}

/**
 * tRPC `onError` handler, wired at the fetch adapter in app.ts.
 *
 * The other half of the scrub: the real message and cause have to land
 * somewhere, and now that is here rather than the client's network tab. So this
 * has to widen exactly in step with `formatTRPCError` — scrubbing a code
 * without logging it would delete the only copy of the failure, which is the
 * blinding this handler exists to prevent.
 *
 * Two things qualify. A server fault is an incident whatever it says, so it is
 * logged even when the sentence on the wire is one we wrote — and that means
 * the whole 5xx family, not the one code whose name says "internal". Anything
 * else qualifies only once the formatter actually *withholds* something: a
 * message inherited from a cause. Input validation is the exception, since its
 * inherited message is expanded onto the wire rather than withheld, and is the
 * creator's own form data besides.
 *
 * Everything else stays silent. A lapsed session, or a procedure answering with
 * a sentence it wrote itself, is a handled outcome, not an incident; logging
 * every plan-gate rejection would bury the failures that matter.
 */
export function logTRPCError({ error, path }: { error: TRPCError; path?: string }): void {
  const withheldFromClient = isInheritedFromCause(error) && !isInputValidationFailure(error);
  if (!isServerFault(error.code) && !withheldFromClient) return;

  console.error(`[trpc] ${path ?? "<no path>"} failed:`, error.message);
  if (error.cause) console.error("[trpc] cause:", error.cause);
}
