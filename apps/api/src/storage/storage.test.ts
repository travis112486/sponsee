import { describe, it, expect } from "vitest";
import { MemoryStorageProvider } from "./memory.js";
import { S3StorageProvider } from "./s3.js";
import { createStorageProvider } from "./index.js";
import {
  buildStorageKey,
  extensionFor,
  isAllowedMimeType,
  isOwnedKey,
  assertSizeWithinCap,
  getStorageQuotaBytes,
} from "./limits.js";
import { maxFileUploadBytes, planStorageQuotaBytes } from "@sponsee/shared";

describe("MemoryStorageProvider", () => {
  const provider = new MemoryStorageProvider();

  it("issues a memory presigned PUT carrying the key", async () => {
    const result = await provider.createPresignedUpload({
      key: "creator/proofs/x.png",
      contentType: "image/png",
      sizeBytes: 5,
    });
    expect(result.uploadUrl).toBe("memory://upload/creator/proofs/x.png");
    expect(result.key).toBe("creator/proofs/x.png");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("issues a memory presigned GET", async () => {
    expect(await provider.createPresignedGetUrl("creator/proofs/x.png")).toBe(
      "memory://object/creator/proofs/x.png",
    );
  });
});

describe("S3StorageProvider", () => {
  it("throws without credentials", () => {
    expect(
      () =>
        new S3StorageProvider({
          region: "auto",
          bucket: "",
          accessKeyId: "",
          secretAccessKey: "",
        }),
    ).toThrow("S3StorageProvider requires");
  });

  it("generates presigned PUT/GET URLs locally (no network)", async () => {
    const provider = new S3StorageProvider({
      region: "auto",
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket: "my-bucket",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      forcePathStyle: true,
    });

    const upload = await provider.createPresignedUpload({
      key: "c1/proofs/x.png",
      contentType: "image/png",
      sizeBytes: 5,
    });
    expect(upload.uploadUrl).toContain("my-bucket/c1/proofs/x.png");

    const get = await provider.createPresignedGetUrl("c1/proofs/x.png");
    expect(get).toContain("my-bucket/c1/proofs/x.png");
  });
});

describe("createStorageProvider", () => {
  it("defaults to memory", () => {
    expect(createStorageProvider().name).toBe("memory");
  });

  it("selects memory explicitly", () => {
    expect(createStorageProvider("memory").name).toBe("memory");
  });

  it("refuses to build r2 without credentials", () => {
    expect(() => createStorageProvider("r2")).toThrow();
  });
});

describe("limits", () => {
  it("maps known mime types to extensions", () => {
    expect(extensionFor("image/png")).toBe(".png");
    expect(extensionFor("application/pdf")).toBe(".pdf");
    expect(extensionFor("application/octet-stream")).toBe("");
  });

  it("allowlists per purpose", () => {
    expect(isAllowedMimeType("proof", "image/png")).toBe(true);
    expect(isAllowedMimeType("proof", "video/mp4")).toBe(true);
    expect(isAllowedMimeType("contract", "application/pdf")).toBe(true);
    expect(isAllowedMimeType("contract", "image/png")).toBe(false);
    expect(isAllowedMimeType("proof", "text/html")).toBe(false);
  });

  it("enforces the size cap", () => {
    expect(() => assertSizeWithinCap(0)).toThrow();
    expect(() => assertSizeWithinCap(maxFileUploadBytes + 1)).toThrow();
    expect(() => assertSizeWithinCap(1234)).not.toThrow();
  });

  it("scopes object keys to the creator", () => {
    const key = buildStorageKey({
      creatorId: "c1",
      purpose: "proof",
      dealId: "d1",
      mimeType: "image/png",
    });
    expect(key.startsWith("c1/proofs/d1/")).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
    expect(isOwnedKey(key, "c1")).toBe(true);
    expect(isOwnedKey(key, "c2")).toBe(false);
  });

  it("grants starter quota to unpaid accounts and plan quota to paid", () => {
    expect(getStorageQuotaBytes("pro", null)).toBe(planStorageQuotaBytes.starter);
    expect(getStorageQuotaBytes("pro", "active")).toBe(planStorageQuotaBytes.pro);
  });
});
