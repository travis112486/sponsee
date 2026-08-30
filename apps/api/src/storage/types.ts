/**
 * StorageProvider interface — abstraction over object storage (Cloudflare R2 /
 * AWS S3). Modeled on the EmailProvider switch in apps/api/src/email/ so the
 * proof + contract upload flows stay provider-agnostic.
 *
 * Uploads are presigned PUTs issued by the API and performed direct-from-browser
 * so file bytes never traverse the Hono server. Reads are short-lived presigned
 * GETs so evidence and contract PDFs stay private per-tenant.
 */

export interface PresignedUpload {
  /** URL the browser PUTs the file bytes to. */
  uploadUrl: string;
  /** Object key (path) the file will live at once the PUT completes. */
  key: string;
  /** When the presigned PUT stops accepting uploads. */
  expiresAt: Date;
}

export interface StorageProvider {
  readonly name: string;

  /** Issue a presigned PUT for a direct-from-browser upload. */
  createPresignedUpload(params: {
    key: string;
    contentType: string;
    sizeBytes: number;
    ttlSeconds?: number;
  }): Promise<PresignedUpload>;

  /** Issue a short-lived presigned GET for a private object. */
  createPresignedGetUrl(key: string, ttlSeconds?: number): Promise<string>;
}
