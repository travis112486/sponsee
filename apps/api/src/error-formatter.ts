import type { TRPCError } from "@trpc/server";
import { ZodError } from "zod";

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
 * Did a procedure deliberately phrase this message, or did it fall out of
 * whatever was thrown?
 *
 * Stricter than {@link isInheritedFromCause} by one case: no message and no
 * cause at all, where tRPC falls back to the code string itself. On a 500 that
 * fallback reads "INTERNAL_SERVER_ERROR", which is not a sentence we chose to
 * show anyone. On the other codes it is the load-bearing default for the bare
 * guards (`TRPCError({ code: "UNAUTHORIZED" })`), so only 500s use this test.
 */
function isAuthoredMessage(error: TRPCError): boolean {
  if (isInheritedFromCause(error)) return false;
  return error.message !== error.code;
}

/**
 * tRPC root `errorFormatter`. Applies to every router, and sorts errors into
 * three: expand a validation failure, strip an internal one, pass the rest
 * through.
 *
 * The phase matters as much as the cause. A ZodError raised while parsing the
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
 * Internal failures get the opposite treatment: `INTERNAL_SERVER_ERROR` bodies
 * are stripped down rather than dressed up, because dropping the ZodError from
 * `data.zodError` alone does not keep it off the wire — the same dump rides out
 * on `message` and `data.stack`. Only a message the procedure *authored* is
 * published; everything else becomes `INTERNAL_ERROR_MESSAGE`, and the real
 * error goes to the server log via `logTRPCError`.
 *
 * The pass-through branch is not a free pass either. A message inherited from a
 * `cause` is a library's text whatever code carries it, so the same scrub runs
 * on every code. The difference is only in what counts as inherited: a 500 also
 * loses tRPC's bare code fallback, while the other codes keep theirs — an
 * unauthenticated request answers "UNAUTHORIZED", not a sentence blaming us.
 */
export function formatTRPCError<TShape extends ErrorShapeLike>({
  shape,
  error,
}: {
  shape: TShape;
  error: TRPCError;
}) {
  const zodError: FlattenedZodError | null = isInputValidationFailure(error)
    ? ((error.cause as ZodError).flatten() as FlattenedZodError)
    : null;

  if (zodError) {
    return {
      ...shape,
      message: summarizeZodError(zodError),
      data: { ...shape.data, zodError },
    };
  }

  const isInternal = error.code === "INTERNAL_SERVER_ERROR";
  const publishMessage = isInternal ? isAuthoredMessage(error) : !isInheritedFromCause(error);

  // tRPC withholds `data.stack` only when NODE_ENV is exactly "production", so
  // on staging — and anywhere else NODE_ENV is not that string — it ships the
  // same text `message` was just scrubbed of (a V8 stack opens with `${name}:
  // ${message}`), plus our file paths. If the message is not fit to publish,
  // neither is the trace it came from; and a 500's trace never is.
  const dropStack = isInternal || !publishMessage;
  const { stack: _stack, ...dataWithoutStack } = shape.data;

  return {
    ...shape,
    message: publishMessage ? shape.message : INTERNAL_ERROR_MESSAGE,
    data: { ...(dropStack ? dataWithoutStack : shape.data), zodError: null },
  };
}

/**
 * tRPC `onError` handler, wired at the fetch adapter in app.ts.
 *
 * This is the other half of scrubbing the body: the real message, cause and
 * trace have to land somewhere, and now that is here rather than the client's
 * network tab. So it logs exactly what the formatter withholds — every 500, plus
 * any other code whose message was inherited from a cause, which is the one
 * non-500 case that gets scrubbed and would otherwise vanish entirely.
 *
 * Silent for the rest — a creator mistyping a URL or hitting an auth guard is
 * not an incident, and logging those would bury the ones that are.
 */
export function logTRPCError({ error, path }: { error: TRPCError; path?: string }): void {
  if (error.code !== "INTERNAL_SERVER_ERROR") {
    if (!isInheritedFromCause(error) || isInputValidationFailure(error)) return;
  }

  console.error(`[trpc] ${path ?? "<no path>"} failed:`, error.message);
  if (error.cause) console.error("[trpc] cause:", error.cause);
}
