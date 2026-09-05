import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { serve, type ServerType } from "@hono/node-server";
import app from "../app.js";
import { getFreePort } from "./mailpit.js";

// Hosted-web harness for the invoice-delivery acceptance proof (SPO-367 gate,
// step 4). The acceptance test must fetch the *exact* hosted invoice URL that
// `invoice.send` embeds in the plain-text email — origin and path — and prove
// the production `/i/:token` route renders the live publicView response. That
// needs the real web app served at the `WEB_URL` origin, with its same-origin
// `/api/trpc` calls proxied to a real in-process Hono API server, and a browser
// to execute the SPA. This helper stands up the API + vite dev server and hands
// back their origins; the caller owns WEB_URL, the Playwright navigation, and
// calling `close()`.

export interface HostedWeb {
  /** The `WEB_URL` origin the browser navigates to (vite dev server). */
  webOrigin: string;
  /** The API origin the vite `/api` proxy forwards to. */
  apiOrigin: string;
  close: () => Promise<void>;
}

function resolveViteBin(): string {
  const candidates = [
    join(process.cwd(), "apps/web/node_modules/.bin/vite"),
    join(process.cwd(), "node_modules/.bin/vite"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    "vite binary not found. Install workspace dependencies (pnpm install) so apps/web/node_modules/.bin/vite exists."
  );
}

function resolveWebDir(): string {
  const cwd = process.cwd();
  const candidates = [join(cwd, "apps/web"), join(cwd, "..", "web"), cwd];
  for (const c of candidates) {
    if (existsSync(join(c, "package.json")) && existsSync(join(c, "src"))) return c;
  }
  throw new Error("could not locate apps/web directory");
}

function startVite(webPort: number, apiOrigin: string): ChildProcess {
  const bin = resolveViteBin();
  const webDir = resolveWebDir();
  return spawn(
    bin,
    ["--config", "vite.acceptance.config.ts", "--logLevel", "warn"],
    {
      cwd: webDir,
      env: {
        ...process.env,
        SPONSEE_ACCEPT_WEB_PORT: String(webPort),
        SPONSEE_ACCEPT_API_ORIGIN: apiOrigin,
      },
      stdio: "ignore",
    }
  );
}

async function waitForHttp(origin: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(origin);
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`vite dev server did not become ready at ${origin} (${lastErr})`);
}

function stopVite(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.killed || proc.exitCode !== null) return resolve();
    proc.once("exit", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
      resolve();
    }, 1500).unref();
  });
}

function closeApi(server: ServerType): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 1000).unref();
  });
}

export async function startHostedWeb(): Promise<HostedWeb> {
  const apiPort = await getFreePort();
  const webPort = await getFreePort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;

  const apiServer = await new Promise<ServerType>((resolve, reject) => {
    try {
      const s = serve(
        { fetch: app.fetch, port: apiPort, hostname: "127.0.0.1" },
        () => resolve(s)
      );
    } catch (e) {
      reject(e);
    }
  });

  const vite = startVite(webPort, apiOrigin);
  await waitForHttp(webOrigin);

  let closed = false;
  return {
    webOrigin,
    apiOrigin,
    close: async () => {
      if (closed) return;
      closed = true;
      await stopVite(vite);
      await closeApi(apiServer);
    },
  };
}
