import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignedUpload, StorageProvider } from "./types.js";

export interface S3StorageConfig {
  /** Custom endpoint. R2: `https://<account_id>.r2.cloudflarestorage.com`. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing is required for R2's S3-compat endpoint. */
  forcePathStyle?: boolean;
}

/**
 * S3-compatible adapter — serves both Cloudflare R2 (recommended) and AWS S3.
 * Presigning is a local SigV4 computation, so `createPresignedGetUrl` is safe
 * to call on the read path without a network round-trip.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    if (!config.accessKeyId || !config.secretAccessKey || !config.bucket) {
      throw new Error(
        "S3StorageProvider requires accessKeyId, secretAccessKey, and bucket",
      );
    }
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region || "auto",
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createPresignedUpload(params: {
    key: string;
    contentType: string;
    sizeBytes: number;
    ttlSeconds?: number;
  }): Promise<PresignedUpload> {
    const ttl = params.ttlSeconds ?? 900;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.sizeBytes,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: ttl });
    return { uploadUrl, key: params.key, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async createPresignedGetUrl(key: string, ttlSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }
}
