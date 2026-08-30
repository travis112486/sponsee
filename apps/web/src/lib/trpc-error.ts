import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * Shape the API's tRPC `errorFormatter` puts on `error.data.zodError`
 * (apps/api/src/error-formatter.ts). Structural on purpose: the panels' error
 * arguments are `TRPCClientErrorLike<AppRouter>`, but nothing here needs the
 * router types, and keeping it structural makes these helpers testable with a
 * plain object.
 */
export type ServerZodError = {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
};

export type ServerErrorLike = {
  message?: string;
  data?: { zodError?: ServerZodError | null } | null;
};

export function serverZodError(err: ServerErrorLike): ServerZodError | null {
  return err?.data?.zodError ?? null;
}

/** The message to show when there is no better place to put it than a toast. */
export function serverErrorMessage(err: ServerErrorLike, fallback: string): string {
  return err?.message || fallback;
}

export type AppliedFieldErrors = {
  /** How many form fields got an inline error. */
  applied: number;
  /**
   * True when the server complained about something the form cannot show
   * inline — a form-level error, or a field this form does not render. The
   * caller still owes the user a toast in that case, or the complaint vanishes.
   */
  unmapped: boolean;
};

/**
 * Map a server-side validation failure onto react-hook-form fields.
 *
 * Client and server schemas are hand-copied, so they drift (SPO-110). When the
 * server rejects something the client schema let through, this puts the message
 * under the offending input instead of in an unattributed toast.
 */
export function applyServerFieldErrors<TFieldValues extends FieldValues>(
  err: ServerErrorLike,
  setError: UseFormSetError<TFieldValues>,
  fields: readonly Path<TFieldValues>[]
): AppliedFieldErrors {
  const zodError = serverZodError(err);
  if (!zodError) return { applied: 0, unmapped: true };

  let applied = 0;
  const mappable = new Set<string>(fields as readonly string[]);
  let unmapped = zodError.formErrors.length > 0;

  for (const [field, messages] of Object.entries(zodError.fieldErrors)) {
    if (!messages || messages.length === 0) continue;
    if (!mappable.has(field)) {
      unmapped = true;
      continue;
    }
    setError(
      field as Path<TFieldValues>,
      { type: "server", message: messages.join(", ") },
      // Focus the first offending input; later ones would steal it back.
      { shouldFocus: applied === 0 }
    );
    applied += 1;
  }

  return { applied, unmapped };
}
