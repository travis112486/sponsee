import { describe, expect, it } from "vitest";
import { getStorageConfig } from "./config.js";
import { createDownloadUrl, createUploadUrl } from "./presign.js";
import { StorageNotConfiguredError, UnsupportedMimeTypeError, FileTooLargeError, InvalidSizeError } from "./errors.js";
import { buildObjectKey, extensionFromKey, keyBelongsToDeal, sanitizeFilename } from "./keys.js";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  assertWithinSizeCap,
  extensionForMimeType,
  isAllowedMimeType,
  isImageOrPdf,
  mimeTypeForExtension,
} from "./mime.js";

const FAKE_ENV = {
  STORAGE_ENDPOINT: "http://localhost:9000",
  STORAGE_BUCKET: "sponsee-test",
  STORAGE_REGION: "auto",
  STORAGE_ACCESS_KEY_ID: "test-access-key",
  STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
};

const CREATOR_ID = "11111111-1111-1111-1111-111111111111";
const DEAL_ID = "22222222-2222-2222-2222-222222222222";

describe("getStorageConfig", () => {
  it("returns null when any required var is missing", () => {
    expect(getStorageConfig({})).toBeNull();
    expect(getStorageConfig({ ...FAKE_ENV, STORAGE_BUCKET: undefined })).toBeNull();
  });

  it("returns a config object when every var is present", () => {
    expect(getStorageConfig(FAKE_ENV)).toEqual({
      endpoint: FAKE_ENV.STORAGE_ENDPOINT,
      bucket: FAKE_ENV.STORAGE_BUCKET,
      region: FAKE_ENV.STORAGE_REGION,
      accessKeyId: FAKE_ENV.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: FAKE_ENV.STORAGE_SECRET_ACCESS_KEY,
    });
  });
});

describe("key generation", () => {
  it("builds a key under creators/{creatorId}/deals/{dealId}/{scope}/{uuid}.{ext}", () => {
    const key = buildObjectKey({ creatorId: CREATOR_ID, dealId: DEAL_ID, scope: "proofs", extension: "png" });
    expect(key).toMatch(
      /^creators\/11111111-1111-1111-1111-111111111111\/deals\/22222222-2222-2222-2222-222222222222\/proofs\/[0-9a-f-]{36}\.png$/
    );
  });

  it("generates a fresh uuid on every call", () => {
    const a = buildObjectKey({ creatorId: CREATOR_ID, dealId: DEAL_ID, scope: "proofs", extension: "png" });
    const b = buildObjectKey({ creatorId: CREATOR_ID, dealId: DEAL_ID, scope: "proofs", extension: "png" });
    expect(a).not.toEqual(b);
  });

  it("keyBelongsToDeal accepts the matching creator/deal pair", () => {
    const key = buildObjectKey({ creatorId: CREATOR_ID, dealId: DEAL_ID, scope: "contracts", extension: "pdf" });
    expect(keyBelongsToDeal(key, { creatorId: CREATOR_ID, dealId: DEAL_ID })).toBe(true);
  });

  it("keyBelongsToDeal rejects a mismatched creator or deal", () => {
    const key = buildObjectKey({ creatorId: CREATOR_ID, dealId: DEAL_ID, scope: "contracts", extension: "pdf" });
    expect(keyBelongsToDeal(key, { creatorId: "other-creator", dealId: DEAL_ID })).toBe(false);
    expect(keyBelongsToDeal(key, { creatorId: CREATOR_ID, dealId: "other-deal" })).toBe(false);
  });

  it("keyBelongsToDeal rejects a malformed key", () => {
    expect(keyBelongsToDeal("not-a-storage-key", { creatorId: CREATOR_ID, dealId: DEAL_ID })).toBe(false);
  });

  it("extensionFromKey reads the extension off the key", () => {
    expect(extensionFromKey("creators/a/deals/b/proofs/uuid.png")).toBe("png");
    expect(extensionFromKey("creators/a/deals/b/proofs/uuid")).toBeNull();
  });

  it("sanitizeFilename strips path components and disallowed characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    // Everything up to and including the last path separator is dropped first
    // (it's a path component, not part of the filename), then whatever
    // remains is stripped to the safe charset.
    expect(sanitizeFilename('evil";<script>.png')).toBe("evilscript.png");
    expect(sanitizeFilename("  spaced name.pdf  ")).toBe("spaced name.pdf");
  });

  it("sanitizeFilename never returns an empty string", () => {
    expect(sanitizeFilename("../../")).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
  });
});

describe("MIME allowlist", () => {
  it("accepts every image type plus PDF", () => {
    for (const mimeType of Object.keys(ALLOWED_MIME_TYPES)) {
      expect(isAllowedMimeType(mimeType)).toBe(true);
      expect(() => extensionForMimeType(mimeType)).not.toThrow();
    }
  });

  it("rejects text/html — a stored-XSS vector if served back", () => {
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(() => extensionForMimeType("text/html")).toThrow(UnsupportedMimeTypeError);
  });

  it("rejects image/svg+xml — scriptable despite the image/* prefix", () => {
    expect(isAllowedMimeType("image/svg+xml")).toBe(false);
    expect(() => extensionForMimeType("image/svg+xml")).toThrow(UnsupportedMimeTypeError);
  });

  it("rejects an arbitrary unknown type", () => {
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
    expect(() => extensionForMimeType("application/x-msdownload")).toThrow(UnsupportedMimeTypeError);
  });

  it("mimeTypeForExtension reverses extensionForMimeType for every allowed type", () => {
    for (const [mimeType, extension] of Object.entries(ALLOWED_MIME_TYPES)) {
      expect(mimeTypeForExtension(extension)).toBe(mimeType);
    }
    expect(mimeTypeForExtension("exe")).toBeNull();
  });

  it("isImageOrPdf is true only for images and PDF", () => {
    expect(isImageOrPdf("image/png")).toBe(true);
    expect(isImageOrPdf("application/pdf")).toBe(true);
    expect(isImageOrPdf("text/plain")).toBe(false);
  });
});

describe("size cap", () => {
  it("accepts a size at or under the cap", () => {
    expect(() => assertWithinSizeCap(1)).not.toThrow();
    expect(() => assertWithinSizeCap(MAX_UPLOAD_BYTES)).not.toThrow();
  });

  it("rejects a size over the cap", () => {
    expect(() => assertWithinSizeCap(MAX_UPLOAD_BYTES + 1)).toThrow(FileTooLargeError);
  });

  it("rejects zero, negative, and non-integer sizes", () => {
    expect(() => assertWithinSizeCap(0)).toThrow(InvalidSizeError);
    expect(() => assertWithinSizeCap(-1)).toThrow(InvalidSizeError);
    expect(() => assertWithinSizeCap(1.5)).toThrow(InvalidSizeError);
  });
});

describe("createUploadUrl", () => {
  it("throws StorageNotConfiguredError when storage env vars are unset", async () => {
    await expect(
      createUploadUrl({
        creatorId: CREATOR_ID,
        dealId: DEAL_ID,
        scope: "proofs",
        mimeType: "image/png",
        sizeBytes: 1024,
        filename: "screenshot.png",
        env: {},
      })
    ).rejects.toThrow(StorageNotConfiguredError);
  });

  it("rejects a disallowed MIME type before signing", async () => {
    await expect(
      createUploadUrl({
        creatorId: CREATOR_ID,
        dealId: DEAL_ID,
        scope: "proofs",
        mimeType: "text/html",
        sizeBytes: 1024,
        filename: "evil.html",
        env: FAKE_ENV,
      })
    ).rejects.toThrow(UnsupportedMimeTypeError);
  });

  it("rejects an oversized file before signing", async () => {
    await expect(
      createUploadUrl({
        creatorId: CREATOR_ID,
        dealId: DEAL_ID,
        scope: "proofs",
        mimeType: "image/png",
        sizeBytes: MAX_UPLOAD_BYTES + 1,
        filename: "huge.png",
        env: FAKE_ENV,
      })
    ).rejects.toThrow(FileTooLargeError);
  });

  it("presigns a PUT with the key, signed headers, and sanitized filename", async () => {
    const upload = await createUploadUrl({
      creatorId: CREATOR_ID,
      dealId: DEAL_ID,
      scope: "proofs",
      mimeType: "image/png",
      sizeBytes: 2048,
      filename: "../evil/My Screenshot.png",
      env: FAKE_ENV,
    });

    expect(upload.method).toBe("PUT");
    expect(upload.key).toMatch(/^creators\/.+\/deals\/.+\/proofs\/.+\.png$/);
    expect(upload.filename).toBe("My Screenshot.png");
    expect(upload.requiredHeaders).toEqual({ "Content-Type": "image/png", "Content-Length": "2048" });

    const url = new URL(upload.url);
    expect(url.origin).toBe(FAKE_ENV.STORAGE_ENDPOINT);
    expect(url.pathname).toContain(upload.key);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });
});

describe("createDownloadUrl", () => {
  it("throws StorageNotConfiguredError when storage env vars are unset", async () => {
    await expect(createDownloadUrl({ key: "creators/a/deals/b/proofs/uuid.png", env: {} })).rejects.toThrow(
      StorageNotConfiguredError
    );
  });

  it("forces inline disposition for an image key", async () => {
    const download = await createDownloadUrl({ key: "creators/a/deals/b/proofs/uuid.png", env: FAKE_ENV });
    const url = new URL(download.url);
    expect(url.searchParams.get("response-content-type")).toBe("image/png");
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^inline;/);
  });

  it("forces inline disposition for a PDF key", async () => {
    const download = await createDownloadUrl({ key: "creators/a/deals/b/contracts/uuid.pdf", env: FAKE_ENV });
    const url = new URL(download.url);
    expect(url.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^inline;/);
  });

  it("falls back to attachment + octet-stream for an unrecognized extension", async () => {
    const download = await createDownloadUrl({ key: "creators/a/deals/b/proofs/uuid.bin", env: FAKE_ENV });
    const url = new URL(download.url);
    expect(url.searchParams.get("response-content-type")).toBe("application/octet-stream");
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^attachment;/);
  });
});
