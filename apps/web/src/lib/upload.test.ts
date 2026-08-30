import { describe, it, expect, vi, afterEach } from "vitest";
import { putToPresignedUrl } from "./upload";

describe("putToPresignedUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips the PUT for memory:// URLs and returns metadata", async () => {
    const file = new File(["hello"], "a.png", { type: "image/png" });
    const result = await putToPresignedUrl(file, "memory://upload/key", "key");
    expect(result).toEqual({ key: "key", mimeType: "image/png", sizeBytes: 5 });
  });

  it("PUTs the file to a real presigned URL", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["hello"], "a.png", { type: "image/png" });
    const result = await putToPresignedUrl(file, "https://bucket/key", "key");

    expect(result.key).toBe("key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://bucket/key");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PUT" });
  });

  it("throws on a failed PUT", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 403 })));
    const file = new File(["hello"], "a.png", { type: "image/png" });
    await expect(putToPresignedUrl(file, "https://bucket/key", "key")).rejects.toThrow(
      "Upload failed (403)",
    );
  });
});
