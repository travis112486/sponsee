import { z } from "zod";

// Rendered in <a href> and <object data> on the web, so only http(s) links are
// accepted — z.url() alone would let javascript:/data: schemes through.
export const httpUrl = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), { message: "Link must start with http:// or https://" });

// Creator-supplied URL we store and may later render as an `href`/`src`. The
// settings surface (avatarUrl, paypalLink) is deliberately https-only, so this
// is stricter than `httpUrl`. Kept as a real `new URL()` parse rather than a
// hand-mirrored scheme regex — mirroring a parser's rule is how we shipped a
// site-wide sign-in DoS (SPO-88).
export const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an https:// URL");
