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
