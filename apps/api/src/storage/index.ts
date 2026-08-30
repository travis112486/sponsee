import { MemoryStorageProvider } from "./memory.js";
import { S3StorageProvider } from "./s3.js";
import type { StorageProvider } from "./types.js";

export * from "./types.js";
export { MemoryStorageProvider, S3StorageProvider };

/**
 * Factory: returns the configured StorageProvider based on environment.
 * Defaults to memory in dev/test so no real bucket is ever contacted without
 * explicit configuration (the same guarantee the email factory gives Mailpit).
 *
 *   STORAGE_PROVIDER=memory (default) | r2 | s3
 */
export function createStorageProvider(name?: string): StorageProvider {
  const env = name || process.env.STORAGE_PROVIDER || "memory";

  switch (env) {
    case "r2":
      return new S3StorageProvider({
        endpoint: process.env.R2_ACCOUNT_ID
          ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
          : undefined,
        region: "auto",
        bucket: process.env.R2_BUCKET_NAME || "",
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
        forcePathStyle: true,
      });
    case "s3":
      return new S3StorageProvider({
        endpoint: process.env.S3_ENDPOINT || undefined,
        region: process.env.S3_REGION || "us-east-1",
        bucket: process.env.S3_BUCKET_NAME || "",
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        forcePathStyle: Boolean(process.env.S3_ENDPOINT),
      });
    case "memory":
    default:
      return new MemoryStorageProvider();
  }
}
