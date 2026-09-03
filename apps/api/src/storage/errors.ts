import type { PlanTier } from "@sponsee/shared";

/**
 * Storage not configured — the required env vars are missing. Callers turn
 * this into `PRECONDITION_FAILED` so the API can boot and merge before the
 * bucket exists (see `config.ts`).
 */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super("File uploads are not configured");
    this.name = "StorageNotConfiguredError";
  }
}

export class UnsupportedMimeTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported file type: ${mimeType}`);
    this.name = "UnsupportedMimeTypeError";
  }
}

export class FileTooLargeError extends Error {
  constructor(sizeBytes: number, maxBytes: number) {
    super(`File is ${sizeBytes} bytes, exceeding the ${maxBytes} byte limit`);
    this.name = "FileTooLargeError";
  }
}

export class InvalidSizeError extends Error {
  constructor() {
    super("File size must be a positive whole number of bytes");
    this.name = "InvalidSizeError";
  }
}

/**
 * Thrown at presign time (SPO-349) when a creator's per-tier storage cap
 * would be exceeded. Carries `usedBytes`/`capBytes`/`planTier` as properties
 * — not just a message — because `error-formatter.ts` republishes them onto
 * the wire so the UI can render a real quota message instead of parsing prose.
 */
export class QuotaExceededError extends Error {
  constructor(
    public readonly usedBytes: number,
    public readonly capBytes: number,
    public readonly planTier: PlanTier
  ) {
    super(
      `This upload would exceed your ${planTier} plan's storage limit (${usedBytes} of ${capBytes} bytes already used).`
    );
    this.name = "QuotaExceededError";
  }
}
