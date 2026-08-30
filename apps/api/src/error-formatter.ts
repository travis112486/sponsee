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
 * tRPC root `errorFormatter`. Applies to every router, so it deliberately does
 * nothing at all unless the error's cause is a ZodError.
 */
export function formatTRPCError<TShape extends ErrorShapeLike>({
  shape,
  error,
}: {
  shape: TShape;
  error: TRPCError;
}) {
  const zodError: FlattenedZodError | null =
    error.cause instanceof ZodError ? (error.cause.flatten() as FlattenedZodError) : null;

  return {
    ...shape,
    message: zodError ? summarizeZodError(zodError) : shape.message,
    data: {
      ...shape.data,
      zodError,
    },
  };
}
