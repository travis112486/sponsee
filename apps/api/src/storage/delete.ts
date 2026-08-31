import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { buildS3Client } from "./client.js";
import { getStorageConfig } from "./config.js";
import { StorageNotConfiguredError } from "./errors.js";

/**
 * The one place an object should be removed from the bucket. Feature slices
 * that let a creator delete their own evidence/contract row (e.g. a future
 * `proof.delete`-style mutation, once that router stores a storage key) must
 * call this in the same request, after the row delete succeeds — mirroring
 * how `proof.delete` already writes an activity event alongside its row
 * delete today.
 *
 * That covers app-initiated deletes. It does *not* cover a `deals` row being
 * hard-deleted, which cascades `proofs`/`contracts` at the DB level with no
 * application hook firing at all — `runStorageOrphanSweep` in `sweep.ts` is
 * the backstop for that path.
 */
export async function deleteObject(key: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = getStorageConfig(env);
  if (!config) throw new StorageNotConfiguredError();

  const client = buildS3Client(config);
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}
