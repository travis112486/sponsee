import type { PresignedUpload, StorageProvider } from "./types.js";

/**
 * Memory provider — the dev/test default. Never talks to a real bucket, exactly
 * like Mailpit never sends real mail. "Presigned" URLs are `memory://` links
 * that prove the request/confirm plumbing end-to-end without any external
 * credentials; a real upload would PUT to the R2/S3 URL issued by the live
 * adapter instead.
 */
export class MemoryStorageProvider implements StorageProvider {
  readonly name = "memory";

  async createPresignedUpload(params: {
    key: string;
    contentType: string;
    sizeBytes: number;
    ttlSeconds?: number;
  }): Promise<PresignedUpload> {
    const ttl = params.ttlSeconds ?? 900;
    return {
      uploadUrl: `memory://upload/${params.key}`,
      key: params.key,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  async createPresignedGetUrl(key: string, _ttlSeconds?: number): Promise<string> {
    return `memory://object/${key}`;
  }
}
