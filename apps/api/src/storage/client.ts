import { S3Client } from "@aws-sdk/client-s3";
import type { StorageConfig } from "./config.js";

/**
 * `forcePathStyle: true` so the bucket name stays out of the hostname —
 * required for MinIO and Backblaze B2, and harmless for AWS S3/Cloudflare R2.
 * Without it, only virtual-hosted-style endpoints work and switching provider
 * stops being a config change.
 */
export function buildS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
