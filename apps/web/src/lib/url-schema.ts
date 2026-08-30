import { z } from "zod";

/**
 * Client mirror of the `httpsUrl` refine in `apps/api/src/routers/settings.ts`.
 *
 * SPO-88 tightened the server's creator-supplied URL fields to https-only.
 * The client schemas were left on a bare `z.string().url()`, so `http://` (and
 * `javascript:`) passed inline validation and failed at the server, where the
 * raw ZodError surfaces as a JSON blob in a toast with no field attribution.
 *
 * The predicate composes zod's own `.url()` with the scheme check rather than
 * hand-rolling a URL parse, so the two sides agree on what counts as a URL —
 * including edge cases like `https://` with no host.
 */
const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  });

/**
 * An https-only URL, or the empty string. Settings forms use `""` as the
 * cleared state and map it to `null` in `onSubmit`, so it has to stay valid.
 *
 * This is a single flat refine rather than `httpsUrl.or(z.literal(""))` because
 * a zod union reports the branch failures separately; react-hook-form would
 * render the literal branch's "expected \"\"" instead of the scheme message.
 */
export const httpsUrlOrEmpty = z
  .string()
  .refine(
    (value) => value === "" || httpsUrl.safeParse(value).success,
    "Must be an https:// URL"
  );
