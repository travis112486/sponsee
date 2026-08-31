import { describe, it, expect, vi, afterEach } from "vitest";
import {
  evidenceFileError,
  evidenceFileErrorMessage,
  uploadToPresignedUrl,
  MAX_EVIDENCE_BYTES,
} from "./evidence-upload";

function fileLike(type: string, size: number): File {
  const file = new File(["x"], "evidence.bin");
  // `size` and `type` are read-only getters derived from content; shadow them
  // so the tests don't have to allocate a 25MB buffer.
  Object.defineProperty(file, "type", { value: type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("evidenceFileError", () => {
  it("accepts every supported image type and PDF", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]) {
      expect(evidenceFileError(fileLike(type, 1024))).toBeNull();
    }
  });

  it("rejects scriptable types (html, svg)", () => {
    expect(evidenceFileError(fileLike("text/html", 1024))).toBe("unsupported-type");
    expect(evidenceFileError(fileLike("image/svg+xml", 1024))).toBe("unsupported-type");
  });

  it("rejects an empty mime type", () => {
    expect(evidenceFileError(fileLike("", 1024))).toBe("unsupported-type");
  });

  it("rejects a file over the size cap", () => {
    expect(evidenceFileError(fileLike("image/png", MAX_EVIDENCE_BYTES + 1))).toBe("too-large");
  });

  it("rejects a zero-byte file", () => {
    expect(evidenceFileError(fileLike("image/png", 0))).toBe("too-large");
  });
});

describe("evidenceFileErrorMessage", () => {
  it("mentions the cap for an oversized file", () => {
    expect(evidenceFileErrorMessage("too-large")).toContain("25MB");
  });

  it("lists the allowed types for an unsupported file", () => {
    const message = evidenceFileErrorMessage("unsupported-type");
    expect(message).toContain("PNG");
    expect(message).toContain("PDF");
  });
});

describe("uploadToPresignedUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeXhr(status: number) {
    const xhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      upload: {} as { onprogress: ((e: unknown) => void) | null },
      onload: null as null | (() => void),
      onerror: null as null | (() => void),
      ontimeout: null as null | (() => void),
      status,
    };
    // A constructor function (not a vi.fn spy) so `new XMLHttpRequest()` works.
    vi.stubGlobal("XMLHttpRequest", function () {
      return xhr;
    });
    return xhr;
  }

  it("PUTs with the signed Content-Type and reports progress", async () => {
    const xhr = makeXhr(200);
    const onProgress = vi.fn();

    const promise = uploadToPresignedUrl({
      url: "https://example.com/put",
      contentType: "image/png",
      body: new Blob(["x"]),
      onProgress,
    });

    expect(xhr.open).toHaveBeenCalledWith("PUT", "https://example.com/put");
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("Content-Type", "image/png");

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    expect(onProgress).toHaveBeenCalledWith(0.5);

    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on a non-2xx response", async () => {
    const xhr = makeXhr(403);

    const promise = uploadToPresignedUrl({
      url: "https://example.com/put",
      contentType: "image/png",
      body: new Blob(["x"]),
    });

    xhr.onload?.();
    await expect(promise).rejects.toThrow("Upload failed (403)");
  });
});
