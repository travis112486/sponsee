import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { buildS3Client } from "./client.js";
import { getStorageConfig } from "./config.js";
import { StorageNotConfiguredError } from "./errors.js";
import { buildObjectKey, extensionFromKey, sanitizeFilename, type StorageScope } from "./keys.js";
import { assertWithinSizeCap, extensionForMimeType, isImageOrPdf, mimeTypeForExtension } from "./mime.js";

// Short enough that a leaked URL (browser history, a proxy log) is worthless
// within minutes; long enough for a normal upload/download to complete.
const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export interface CreateUploadUrlParams {
  creatorId: string;
  dealId: string;
  scope: StorageScope;
  mimeType: string;
  sizeBytes: number;
  filename: string;
  env?: Record<string, string | undefined>;
}

export interface PresignedUpload {
  url: string;
  key: string;
  method: "PUT";
  expiresAt: Date;
  /** The client's PUT must send exactly these headers — they're part of what was signed. */
  requiredHeaders: { "Content-Type": string; "Content-Length": string };
  /** Sanitized, for display only — never part of the key. */
  filename: string;
}

/**
 * Presigns a PUT for a brand-new object. Validates the MIME allowlist and
 * size cap *before* signing (so a rejected request never reaches the bucket).
 * `ContentLength` is genuinely wire-enforced — verified against a real S3
 * server in storage.e2e.test.ts, MinIO rejects a PUT whose actual body size
 * disagrees with the signed length — so the size cap sticks rather than being
 * advisory. `ContentType`, despite being passed into the signed command, is
 * *not* part of the default signature (`@aws-sdk/s3-request-presigner` only
 * signs `content-length`/`host`; also verified in that same suite), so a
 * client can swap it on the actual PUT. That's still safe: `createDownloadUrl`
 * below never trusts whatever Content-Type ends up stored — it always derives
 * the response type from the key's own extension, decided server-side before
 * the PUT ever happened.
 */
export async function createUploadUrl(params: CreateUploadUrlParams): Promise<PresignedUpload> {
  const config = getStorageConfig(params.env);
  if (!config) throw new StorageNotConfiguredError();

  const extension = extensionForMimeType(params.mimeType);
  assertWithinSizeCap(params.sizeBytes);

  const key = buildObjectKey({
    creatorId: params.creatorId,
    dealId: params.dealId,
    scope: params.scope,
    extension,
  });

  const client = buildS3Client(config);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: params.mimeType,
    ContentLength: params.sizeBytes,
  });
  const url = await getSignedUrl(client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });

  return {
    url,
    key,
    method: "PUT",
    expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
    requiredHeaders: {
      "Content-Type": params.mimeType,
      "Content-Length": String(params.sizeBytes),
    },
    filename: sanitizeFilename(params.filename),
  };
}

export interface CreateDownloadUrlParams {
  key: string;
  /** Optional display name (a future schema slice may store the original filename); falls back to the key's own name. */
  filename?: string;
  env?: Record<string, string | undefined>;
}

export interface PresignedDownload {
  url: string;
  expiresAt: Date;
}

/**
 * Presigns a GET. `ResponseContentType` is always forced from our own
 * allowlist derived from the key's extension — never left to the browser to
 * sniff — and `ResponseContentDisposition` forces a download for anything
 * that isn't an image or PDF, so an uploaded file can't be opened inline as
 * if it were HTML even if a future bug let something unexpected through.
 *
 * `X-Content-Type-Options: nosniff` is *not* set here: S3's presigned-GET
 * response overrides are limited to `response-content-type`,
 * `response-content-disposition`, `-encoding`, `-language`, `-cache-control`
 * and `-expires` — there is no override for arbitrary headers on a plain
 * S3/R2/MinIO/B2 GET. If nosniff enforcement becomes a hard requirement, it
 * needs a CDN/reverse-proxy layer in front of the bucket (a response-headers
 * policy on CloudFront, a Cloudflare Transform Rule, etc.) — an infra choice
 * independent of which vendor SPO-155 lands on, not something this module can
 * do on its own.
 */
export async function createDownloadUrl(params: CreateDownloadUrlParams): Promise<PresignedDownload> {
  const config = getStorageConfig(params.env);
  if (!config) throw new StorageNotConfiguredError();

  const extension = extensionFromKey(params.key);
  const mimeType = extension ? mimeTypeForExtension(extension) : null;
  const disposition = mimeType && isImageOrPdf(mimeType) ? "inline" : "attachment";
  const displayName = sanitizeFilename(params.filename ?? params.key.split("/").pop() ?? "file");

  const client = buildS3Client(config);
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    ResponseContentType: mimeType ?? "application/octet-stream",
    ResponseContentDisposition: `${disposition}; filename="${displayName}"`,
  });
  const url = await getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });

  return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
}
