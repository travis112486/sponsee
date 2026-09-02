import { S3Client } from "@aws-sdk/client-s3";
import type { StorageConfig } from "./config.js";

/**
 * `forcePathStyle: true` so the bucket name stays out of the hostname —
 * required for MinIO and Backblaze B2, and harmless for AWS S3/Cloudflare R2.
 * Without it, only virtual-hosted-style endpoints work and switching provider
 * stops being a config change.
 *
 * `requestChecksumCalculation`/`responseChecksumValidation: "WHEN_REQUIRED"`
 * (SDK default since 3.729 is `WHEN_SUPPORTED`) because a presigned
 * `PutObjectCommand` has no body yet at sign time: the SDK would compute and
 * sign a CRC32 of an *empty* body into the query string, so every real
 * upload's actual checksum disagrees with what was signed. AWS S3 and R2
 * both validate that mismatch and reject the PUT with 400 — MinIO happens
 * not to check it, which is why this only showed up against R2. `WHEN_REQUIRED`
 * drops the checksum params entirely for a presigned request (there's no
 * opt-in trailer), which is the behavior we want for both PUT and GET.
 */
export function buildS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
