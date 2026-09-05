import { spawn, execSync, type ChildProcess } from "child_process";
import { createServer } from "net";
import { existsSync } from "fs";
import { join } from "path";

// Shared Mailpit lifecycle helpers for acceptance tests that need a real SMTP
// capture endpoint (chase-integration and the invoice-delivery acceptance gate).
// Mailpit never sends real mail — it is the dev/CI capture relay — so pointing
// the real MailpitProvider at it is the only path that exercises the actual
// nodemailer send without a live provider.

export type MailpitAddress = { Name?: string; Address?: string };

export type MailpitSummary = {
  ID: string;
  MessageID: string;
  From?: MailpitAddress;
  To?: MailpitAddress[];
  ReplyTo?: MailpitAddress[];
  Cc?: MailpitAddress[] | null;
  Bcc?: MailpitAddress[] | null;
  Subject?: string;
  Snippet?: string;
  Tags?: string[];
};

export type MailpitMessage = MailpitSummary & {
  Text?: string;
  HTML?: string;
};

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

export async function waitForMailpit(apiUrl: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${apiUrl}/api/v1/messages`);
      if (res.ok) return;
    } catch {
      // probe failure — keep polling
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mailpit did not become ready in time");
}

// SMTP acceptance does not imply the message is queryable via Mailpit's HTTP
// API yet — persistence is asynchronous. Poll for it instead of reading once;
// throw (never silently pass) if it never shows up within the deadline.
export async function waitForMailpitMatches<T extends { To?: Array<{ Address: string }> }>(
  apiUrl: string,
  filterFn: (m: T) => boolean,
  { timeoutMs = 5000, minCount = 1 }: { timeoutMs?: number; minCount?: number } = {}
): Promise<T[]> {
  const start = Date.now();
  let lastCount = 0;
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${apiUrl}/api/v1/messages?limit=100`);
    if (!res.ok) {
      throw new Error(`Mailpit API returned ${res.status} while polling for messages`);
    }
    const data = (await res.json()) as { messages?: T[] };
    const matches = (data.messages || []).filter(filterFn);
    lastCount = matches.length;
    if (matches.length >= minCount) return matches;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Mailpit did not persist ${minCount} matching message(s) within ${timeoutMs}ms (found ${lastCount})`
  );
}

/** Fetch one message's full body (Text/HTML/ReplyTo) by its summary ID. */
export async function getMailpitMessage(
  apiUrl: string,
  id: string
): Promise<MailpitMessage> {
  const res = await fetch(`${apiUrl}/api/v1/message/${id}`);
  if (!res.ok) {
    throw new Error(`Mailpit message fetch returned ${res.status} for ${id}`);
  }
  return (await res.json()) as MailpitMessage;
}

export function findMailpitBinary(): string {
  const candidates = [
    process.env.MAILPIT_BINARY,
    "/opt/homebrew/bin/mailpit",
    "/usr/local/bin/mailpit",
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  try {
    const found = execSync("command -v mailpit", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    if (found) return found;
  } catch {
    // fall through
  }
  throw new Error(
    "mailpit binary not found. Install Mailpit (https://mailpit.axllent.org/) or set MAILPIT_BINARY env var."
  );
}

export function startMailpit(smtpPort: number, httpPort: number): ChildProcess {
  const binary = findMailpitBinary();
  // Ports in the filename keep concurrent instances from fighting over one
  // database file — a second spawn while the first still holds its lock would
  // otherwise refuse to open the same path.
  const dbPath = process.env.PAPERCLIP_RUN_SCRATCH_DIR
    ? join(process.env.PAPERCLIP_RUN_SCRATCH_DIR, `mailpit-${smtpPort}-${httpPort}.db`)
    : `/tmp/mailpit-${smtpPort}-${httpPort}.db`;
  return spawn(
    binary,
    [
      "-s",
      `127.0.0.1:${smtpPort}`,
      "-l",
      `127.0.0.1:${httpPort}`,
      "-d",
      dbPath,
      "-q",
    ],
    { stdio: "ignore" }
  );
}

export async function stopMailpit(proc: ChildProcess): Promise<void> {
  if (!proc.killed) {
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (!proc.killed) proc.kill("SIGKILL");
  }
}
