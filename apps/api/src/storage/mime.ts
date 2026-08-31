import { FileTooLargeError, InvalidSizeError, UnsupportedMimeTypeError } from "./errors.js";

/**
 * The only file types the storage module will presign. `text/html` and
 * `image/svg+xml` are deliberately excluded — both execute script when
 * rendered back in a browser, turning a private bucket into a stored-XSS
 * vector the moment a presigned GET is opened in a tab.
 */
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

// 25MB covers deal evidence (screenshots, VOD clips as links, not the video
// itself) and signed contract PDFs with headroom; small enough that the
// presigned ContentLength enforcement below still means something.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function isAllowedMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, mimeType);
}

export function extensionForMimeType(mimeType: string): string {
  const extension = ALLOWED_MIME_TYPES[mimeType];
  if (!extension) throw new UnsupportedMimeTypeError(mimeType);
  return extension;
}

/** Reverse lookup used on the read path, where only the key's extension is known. */
export function mimeTypeForExtension(extension: string): string | null {
  const lower = extension.toLowerCase();
  const entry = Object.entries(ALLOWED_MIME_TYPES).find(([, ext]) => ext === lower);
  return entry ? entry[0] : null;
}

/** Images and PDFs render safely inline; everything else forces a download. */
export function isImageOrPdf(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

export function assertWithinSizeCap(sizeBytes: number): void {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new InvalidSizeError();
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new FileTooLargeError(sizeBytes, MAX_UPLOAD_BYTES);
  }
}
