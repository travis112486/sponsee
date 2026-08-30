export interface UploadedObject {
  key: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * PUT file bytes to a presigned upload URL issued by the API.
 *
 * The dev/test `memory` storage provider returns a `memory://` URL that a real
 * browser cannot PUT to; that scheme is treated as an already-succeeded upload
 * so the confirm flow works end-to-end without a live R2/S3 bucket.
 */
export async function putToPresignedUrl(
  file: File,
  uploadUrl: string,
  key: string,
): Promise<UploadedObject> {
  if (!uploadUrl.startsWith("memory://")) {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) {
      throw new Error(`Upload failed (${res.status})`);
    }
  }
  return { key, mimeType: file.type, sizeBytes: file.size };
}
