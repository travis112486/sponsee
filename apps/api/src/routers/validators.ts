import { z } from "zod";

// Rendered in <a href> and <object data> on the web, so only http(s) links are
// accepted — z.url() alone would let javascript:/data: schemes through.
export const httpUrl = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), { message: "Link must start with http:// or https://" });
