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
 * sign a CRC32 of an *empty* body — literally `x-amz-checksum-crc32=AAAAAA==`
 * — into the query string, so every real upload's actual checksum disagrees
 * with what was signed. `WHEN_REQUIRED` drops the checksum params entirely
 * for a presigned request (there's no opt-in trailer), which is the behavior
 * we want for both PUT and GET.
 *
 * SPO-422: nothing on the wire enforces this. SPO-351 claimed R2 and S3 both
 * 400 the mismatch, but that was reasoned from the S3 checksum docs and never
 * measured — PR #113 landed with its live-R2 leg unrun, because SPO-167 was
 * still blocked on Cloudflare credentials. When it finally was measured
 * (2026-09-03, deleting these two lines and running `pnpm verify:live-storage`
 * against `sponsee-uploads` on SDK 3.1121.0, the same version SPO-351 pinned):
 * the params came back in the URL and R2 answered the PUT with **200**, bytes
 * round-tripping intact. Read that as "R2 never rejected this in the shape we
 * generate", not "R2 relaxed enforcement": the SDK is byte-identical to the
 * version SPO-351 pinned, so the request we emit has not changed, and no
 * measurement ever showed a 400. The likely reason is that the SDK puts the
 * checksum in the *query string* while `X-Amz-SignedHeaders` stays
 * `content-length;host`, and `x-amz-checksum-*` is validated as a request
 * header. MinIO doesn't check either. Untested on AWS S3 proper — we don't
 * run there.
 *
 * `WHEN_REQUIRED` still stays: signing a checksum no real upload can match is
 * wrong whether or not R2 currently tolerates it. But the only thing that
 * catches a reintroduction is an assertion on the presigned URL's shape:
 *   - `storage.test.ts` › "presigns a PUT with no checksum query parameters"
 *   - check 1 of `scripts/verify-live-storage.ts` (manual, needs credentials)
 * Neither is redundant with the other, and neither is redundant with the
 * wire. Don't delete one on the theory that something else would catch it.
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
