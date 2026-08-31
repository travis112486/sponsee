// Client-side file-evidence helpers (SPO-157).
//
// The allowlist and size cap here are a fast-feedback UX pre-check only — they
// mirror `apps/api/src/storage/mime.ts` (ALLOWED_MIME_TYPES / MAX_UPLOAD_BYTES)
// and the server re-validates authoritatively at presign time, so a drift here
// degrades to a slightly later error message rather than an insecure upload.

const ALLOWED_EVIDENCE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export type EvidenceFileError = "too-large" | "unsupported-type";

export function evidenceFileError(file: File): EvidenceFileError | null {
  if (!ALLOWED_EVIDENCE_MIME_TYPES.has(file.type)) {
    return "unsupported-type";
  }
  if (file.size <= 0 || file.size > MAX_EVIDENCE_BYTES) {
    return "too-large";
  }
  return null;
}

export const EVIDENCE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";

export function evidenceFileErrorMessage(kind: EvidenceFileError): string {
  if (kind === "too-large") {
    return `File is too large (max ${MAX_EVIDENCE_BYTES / 1024 / 1024}MB)`;
  }
  return "That file type is not supported. Use a PNG, JPEG, WebP, GIF, or PDF.";
}

/**
 * PUT a blob directly to a presigned URL, reporting upload progress.
 *
 * Uses XMLHttpRequest rather than `fetch` because `fetch` has no upload
 * progress events — the only way to show "per-file progress" against a
 * direct-to-S3 PUT. Content-Type must match what was signed; Content-Length
 * is set by the browser from the body (and equals `sizeBytes` validated before
 * presign, so it matches the signed value too).
 */
export function uploadToPresignedUrl(opts: {
  url: string;
  contentType: string;
  body: Blob;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", opts.url);
    xhr.setRequestHeader("Content-Type", opts.contentType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && opts.onProgress) {
        opts.onProgress(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.send(opts.body);
  });
}
