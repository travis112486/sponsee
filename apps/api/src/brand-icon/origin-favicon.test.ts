import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchFromPinnedAddress, fetchOriginFavicon } from "./origin-favicon.js";
import { UnsafeHostError } from "./ssrf-guard.js";

// These exercise the byte-handling rules (size cap, zero-byte trap, non-image
// content-type trap) against a real local HTTP server on 127.0.0.1 — reached
// via `fetchFromPinnedAddress` directly, bypassing DNS resolution and the SSRF
// guard entirely (127.0.0.1 would otherwise be rejected, which is the point).

type Handler = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void;

let server: Server;
let port: number;
let handler: Handler = (_req, res) => res.end();

beforeAll(async () => {
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function fetchLocal(opts: { timeoutMs?: number; maxBytes?: number } = {}) {
  return fetchFromPinnedAddress(
    "test.local",
    { address: "127.0.0.1", family: 4 },
    { timeoutMs: opts.timeoutMs ?? 2000, maxBytes: opts.maxBytes ?? 1024, port, tls: false }
  );
}

describe("fetchFromPinnedAddress", () => {
  it("returns a hit for a 200 image response", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "image/x-icon" });
      res.end(Buffer.from([1, 2, 3, 4]));
    };
    const result = await fetchLocal();
    expect(result.outcome).toBe("hit");
    expect(result.contentType).toBe("image/x-icon");
    expect(result.body?.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
  });

  it("treats a zero-byte 200 body as a miss (the raycon.com trap)", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "image/x-icon" });
      res.end();
    };
    const result = await fetchLocal();
    expect(result.outcome).toBe("miss");
  });

  it("treats a non-2xx status as a miss", async () => {
    handler = (_req, res) => {
      res.writeHead(404);
      res.end();
    };
    const result = await fetchLocal();
    expect(result.outcome).toBe("miss");
  });

  it("treats a 200 with an HTML error page (non-image content-type) as a miss", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not found</html>");
    };
    const result = await fetchLocal();
    expect(result.outcome).toBe("miss");
  });

  it("treats a redirect as a miss rather than following it", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/favicon.ico" });
      res.end();
    };
    const result = await fetchLocal();
    expect(result.outcome).toBe("miss");
  });

  it("aborts and misses when the response exceeds the byte cap", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.alloc(2048, 1));
    };
    const result = await fetchLocal({ maxBytes: 1024 });
    expect(result.outcome).toBe("miss");
  });

  it("defaults to image/x-icon when the server omits Content-Type", async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.end(Buffer.from([1, 2, 3]));
    };
    const result = await fetchLocal();
    expect(result.outcome).toBe("hit");
    expect(result.contentType).toBe("image/x-icon");
  });

  it("misses on a hard timeout", async () => {
    handler = (_req, res) => {
      // Never respond.
      void res;
    };
    const result = await fetchLocal({ timeoutMs: 100 });
    expect(result.outcome).toBe("miss");
  });
});

describe("fetchOriginFavicon", () => {
  it("misses without making a request when the SSRF guard rejects the domain", async () => {
    let called = false;
    handler = (_req, res) => {
      called = true;
      res.end();
    };
    const result = await fetchOriginFavicon("evil.example", {
      timeoutMs: 1000,
      maxBytes: 1024,
      lookupFn: async () => {
        throw new UnsafeHostError("evil.example");
      },
    });
    expect(result.outcome).toBe("miss");
    expect(called).toBe(false);
  });
});
