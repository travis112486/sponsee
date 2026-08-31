export interface StorageConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const REQUIRED_KEYS = [
  "STORAGE_ENDPOINT",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
] as const;

/**
 * Reads storage config from env. Returns `null` — never throws — when any
 * required var is missing, so the API boots fine before a bucket exists.
 * Every entry point that actually needs a bucket (presign, delete, sweep)
 * turns that `null` into a `StorageNotConfiguredError` at call time instead,
 * which the storage router maps to `PRECONDITION_FAILED`. This is what lets
 * this module merge before the vendor decision (SPO-155) lands — R2, S3, B2,
 * and MinIO are all just these five vars.
 */
export function getStorageConfig(env: Record<string, string | undefined> = process.env): StorageConfig | null {
  const values = REQUIRED_KEYS.map((key) => env[key]);
  if (values.some((value) => !value)) return null;

  const [endpoint, bucket, region, accessKeyId, secretAccessKey] = values as string[];
  return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}
