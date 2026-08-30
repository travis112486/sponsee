import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { runChaseTick, sendChaseEmail } from "./chase-tick.js";
import { chaseRouter } from "../routers/chase.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";
import { spawn, type ChildProcess, execSync } from "child_process";
import { createServer } from "net";
import { existsSync } from "fs";
import { join } from "path";

// ── Mock pg-boss (no DATABASE_URL in test env) ───────────────────────────────

const mockBossSend = vi.fn(() => Promise.resolve());
vi.mock("./boss.js", () => ({
  getBoss: vi.fn(() => Promise.resolve({ send: mockBossSend })),
  stopBoss: vi.fn(() => Promise.resolve()),
}));

// Lets a test hold a mocked boss.send() call open so it can force a genuine
// interleaving window between two overlapping approve() calls, instead of
// awaiting each call to completion before starting the next.
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── Mailpit lifecycle helpers (real instance for acceptance test) ─────────────

async function getFreePort(): Promise<number> {
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

async function waitForMailpit(apiUrl: string, timeoutMs = 5000): Promise<void> {
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
async function waitForMailpitMatches<T extends { To?: Array<{ Address: string }> }>(
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

function findMailpitBinary(): string {
  const candidates = [
    process.env.MAILPIT_BINARY,
    "/opt/homebrew/bin/mailpit",
    "/usr/local/bin/mailpit",
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  try {
    const found = execSync("command -v mailpit", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    if (found) return found;
  } catch {
    // fall through
  }
  throw new Error(
    "mailpit binary not found. Install Mailpit (https://mailpit.axllent.org/) or set MAILPIT_BINARY env var."
  );
}

function startMailpit(smtpPort: number, httpPort: number): ChildProcess {
  const binary = findMailpitBinary();
  const dbPath = process.env.PAPERCLIP_RUN_SCRATCH_DIR
    ? join(process.env.PAPERCLIP_RUN_SCRATCH_DIR, "mailpit-integration-test.db")
    : "/tmp/mailpit-integration-test.db";
  return spawn(binary, [
    "-s", `127.0.0.1:${smtpPort}`,
    "-l", `127.0.0.1:${httpPort}`,
    "-d", dbPath,
    "-q",
  ], { stdio: "ignore" });
}

async function stopMailpit(proc: ChildProcess): Promise<void> {
  if (!proc.killed) {
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (!proc.killed) proc.kill("SIGKILL");
  }
}

// ── Schema SQL (shared with every other PGlite suite via test-utils/schema-sql.ts) ──

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockCtx(creatorId: string) {
  return {
    session: { user: { id: `user-${creatorId}`, email: "creator@example.com", name: "Test Creator" } },
    creatorId,
    db,
  };
}

async function cleanTables() {
  await db.delete(schema.activityEvents);
  await db.delete(schema.chaseEvents);
  await db.delete(schema.invoiceChaseState);
  await db.delete(schema.chaseTemplates);
  await db.delete(schema.invoices);
  await db.delete(schema.contracts);
  await db.delete(schema.proofs);
  await db.delete(schema.deliverables);
  await db.delete(schema.deals);
  await db.delete(schema.contacts);
  await db.delete(schema.brands);
  await db.delete(schema.creatorPlatforms);
  await db.delete(schema.memberships);
  await db.delete(schema.creators);
}

async function seedFullFlow() {
  const [creator] = await db.insert(schema.creators).values({ displayName: "Streamer One" }).returning();

  const [brand] = await db
    .insert(schema.brands)
    .values({ creatorId: creator.id, name: "Acme Brand" })
    .returning();

  const [contact] = await db
    .insert(schema.contacts)
    .values({ brandId: brand.id, name: "Brand Contact", email: "brand@example.com" })
    .returning();

  const [deal] = await db
    .insert(schema.deals)
    .values({ creatorId: creator.id, brandId: brand.id, title: "Sponsorship Deal", primaryContactId: contact.id })
    .returning();

  // Invoice 3 days past due
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const [invoice] = await db
    .insert(schema.invoices)
    .values({
      creatorId: creator.id,
      dealId: deal.id,
      contactId: contact.id,
      number: 1,
      amountCents: 50000,
      currency: "USD",
      terms: "net_30",
      status: "open",
      title: "Invoice #0001",
      dueAt: threeDaysAgo,
      issuedAt: new Date(Date.now() - 33 * 24 * 60 * 60 * 1000),
    })
    .returning();

  // Template step 1: due date + 1 day (so it's already past due)
  await db.insert(schema.chaseTemplates).values({
    creatorId: creator.id,
    step: 1,
    name: "Friendly reminder",
    offsetDays: 1,
    subject: "Payment reminder for {invoice_id}",
    body: "Hi {brand_contact}, please pay {amount} for {deal_title}.",
    enabled: true,
  });

  // Template step 2
  await db.insert(schema.chaseTemplates).values({
    creatorId: creator.id,
    step: 2,
    name: "Second notice",
    offsetDays: 5,
    subject: "Second notice: {invoice_id}",
    body: "Hi {brand_contact}, this is a follow-up.",
    enabled: true,
  });

  // Armed chase state with nextActionAt in the past (so runChaseTick picks it up)
  await db.insert(schema.invoiceChaseState).values({
    invoiceId: invoice.id,
    mode: "armed",
    nextStep: 1,
    nextActionAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  return { creator, brand, contact, deal, invoice };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
});

beforeEach(async () => {
  await cleanTables();
  // mockClear() leaves queued mockImplementationOnce() entries behind, so a test
  // that throws before consuming one would poison the next test. Reset fully and
  // restore the default "enqueue succeeds" behaviour.
  mockBossSend.mockReset();
  mockBossSend.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Integration tests ────────────────────────────────────────────────────────

describe("chase integration: past-due invoice -> review -> send -> timeline", () => {
  it("runChaseTick creates awaiting_review event for a past-due invoice", async () => {
    const { invoice } = await seedFullFlow();

    const created = await runChaseTick();
    expect(created).toBe(1);

    const events = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("awaiting_review");
    expect(events[0].step).toBe(1);
    expect(events[0].toEmail).toBe("brand@example.com");
    expect(events[0].subjectSnapshot).toContain("INV-0001");
    expect(events[0].bodySnapshot).toContain("please pay $500");
  });

  it("runChaseTick does not treat null nextActionAt as due", async () => {
    const { invoice } = await seedFullFlow();

    // Set nextActionAt to null (unarmed)
    await db
      .update(schema.invoiceChaseState)
      .set({ nextActionAt: null })
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));

    const created = await runChaseTick();
    expect(created).toBe(0);

    const events = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));
    expect(events).toHaveLength(0);
  });

  it("approve claims awaiting_review -> approved and enqueues pg-boss job", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    const result = await caller.approve({ chaseEventId: event.id });

    expect(result.success).toBe(true);
    expect(result.queued).toBe(true);

    // Event is now approved
    const [updated] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(updated.status).toBe("approved");

    // pg-boss job was enqueued with singletonKey
    expect(mockBossSend).toHaveBeenCalledTimes(1);
    const jobName = mockBossSend.mock.calls[0][0];
    const jobArgs = mockBossSend.mock.calls[0][1];
    const jobOpts = mockBossSend.mock.calls[0][2];
    expect(jobName).toBe("chase-send");
    expect(jobArgs.chaseEventId).toBe(event.id);
    expect(jobArgs.invoiceId).toBe(invoice.id);
    expect(jobOpts.singletonKey).toBeDefined();
    expect(jobOpts.retryLimit).toBe(3);

    // Activity event recorded
    const activities = await db
      .select()
      .from(schema.activityEvents)
      .where(
        and(
          eq(schema.activityEvents.entityId, invoice.id),
          eq(schema.activityEvents.kind, "chase_sent")
        )
      )
      .orderBy(desc(schema.activityEvents.createdAt));

    expect(activities.length).toBeGreaterThanOrEqual(1);
    expect(activities[0].payload).toMatchObject({ action: "approve", status: "approved" });
  });

  it("repeated approve is idempotent: second approve returns alreadyQueued, one job only", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    const first = await caller.approve({ chaseEventId: event.id });
    expect(first).toMatchObject({ success: true, queued: true });

    // Second approve on an already-approved event must succeed idempotently,
    // not surface a spurious error to a double-click.
    const second = await caller.approve({ chaseEventId: event.id });
    expect(second).toEqual({ success: true, queued: true, alreadyQueued: true });

    // Exactly one chase-send job was enqueued (no double-send).
    expect(mockBossSend).toHaveBeenCalledTimes(1);

    const [after] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));
    expect(after.status).toBe("approved");
    // The first approve recorded durable proof of its enqueue; that — not the
    // approved status — is what makes the second approve safe to short-circuit.
    expect(after.enqueuedAt).not.toBeNull();
  });

  // The tests above only ever await one approve() call before starting the
  // next, so they never exercise real overlap between two in-flight requests.
  // These use a deferred boss.send() to hold request A open inside its enqueue
  // call while request B runs concurrently against the same event.
  //
  // The invariant under test (SPO-68): a request must never report the send as
  // queued on behalf of an overlapping request whose enqueue has not resolved.
  // `status = approved` is claimed before boss.send() resolves and is reverted
  // if it fails, so only `enqueued_at` proves a durable job exists.

  // Tracks settlement without swallowing the result, so a test can assert that
  // request B is still pending while request A holds the enqueue open.
  function track<T>(promise: Promise<T>) {
    const state = { settled: false, value: undefined as T | undefined, error: undefined as unknown };
    const tracked = promise.then(
      (value) => {
        state.settled = true;
        state.value = value;
        return value;
      },
      (error) => {
        state.settled = true;
        state.error = error;
        throw error;
      }
    );
    // Keep a terminal handler so a rejection asserted later is never reported
    // as an unhandled rejection in the meantime.
    tracked.catch(() => {});
    return { state, promise: tracked };
  }

  async function waitForClaim(eventId: string) {
    await vi.waitFor(async () => {
      const [current] = await db
        .select()
        .from(schema.chaseEvents)
        .where(eq(schema.chaseEvents.id, eventId));
      expect(current.status).toBe("approved");
    });
  }

  it("concurrent approve: overlapping request cannot report queued until the enqueue is durable", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const deferred = createDeferred<void>();
    mockBossSend.mockImplementationOnce(() => deferred.promise);

    const caller = chaseRouter.createCaller(mockCtx(creator.id));

    // Request A: claims the event (awaiting_review -> approved), then blocks
    // inside boss.send() until we resolve the deferred below.
    const requestA = caller.approve({ chaseEventId: event.id });

    // Wait for A's atomic claim to land WITHOUT waiting for A's enqueue to
    // finish — this is the overlap window request B runs in.
    await waitForClaim(event.id);

    const [midflight] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(midflight.status).toBe("approved");
    expect(midflight.enqueuedAt).toBeNull();

    // Request B overlaps A. It must not answer "queued" off the approved status
    // alone: A's enqueue can still fail. B stays open until A settles.
    const requestB = track(caller.approve({ chaseEventId: event.id }));

    await new Promise((r) => setTimeout(r, 200));
    expect(requestB.state.settled).toBe(false);

    // Only request A ever attempted to enqueue — exactly one durable job.
    expect(mockBossSend).toHaveBeenCalledTimes(1);

    // Let A's enqueue succeed; B may now truthfully report alreadyQueued.
    deferred.resolve();
    await expect(requestA).resolves.toEqual({ success: true, queued: true });
    await expect(requestB.promise).resolves.toEqual({ success: true, queued: true, alreadyQueued: true });

    expect(mockBossSend).toHaveBeenCalledTimes(1);

    const [after] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(after.status).toBe("approved");
    expect(after.enqueuedAt).not.toBeNull();
  });

  it("concurrent approve: enqueue failure never leaves an overlapping request reporting a phantom queue", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // A's enqueue is held open, then fails. B's takeover attempt fails too, so
    // no durable job exists for this event at any point in the interleaving.
    const deferred = createDeferred<void>();
    mockBossSend.mockImplementationOnce(() => deferred.promise);
    mockBossSend.mockImplementationOnce(() => Promise.reject(new Error("pg-boss unavailable")));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));

    const requestA = track(caller.approve({ chaseEventId: event.id }));
    await waitForClaim(event.id);

    const requestB = track(caller.approve({ chaseEventId: event.id }));
    await new Promise((r) => setTimeout(r, 200));
    expect(requestB.state.settled).toBe(false);

    // A's enqueue now fails and reverts the event.
    deferred.reject(new Error("pg-boss send failed"));
    await expect(requestA.promise).rejects.toThrow("Failed to queue chase email");

    // B must surface the failure rather than a stale "alreadyQueued": there is
    // no durable job to be already-queued against.
    await expect(requestB.promise).rejects.toThrow("Failed to queue chase email");

    const [after] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(after.status).toBe("awaiting_review");
    expect(after.enqueuedAt).toBeNull();
    expect(after.sendJobId).toBeNull();

    expect(mockBossSend).toHaveBeenCalledTimes(2);
  });

  it("concurrent approve: overlapping request takes over and queues after the winner's enqueue fails", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const deferred = createDeferred<void>();
    mockBossSend.mockImplementationOnce(() => deferred.promise);

    const caller = chaseRouter.createCaller(mockCtx(creator.id));

    const requestA = track(caller.approve({ chaseEventId: event.id }));
    await waitForClaim(event.id);

    const requestB = track(caller.approve({ chaseEventId: event.id }));
    await new Promise((r) => setTimeout(r, 200));
    expect(requestB.state.settled).toBe(false);

    deferred.reject(new Error("pg-boss send failed"));
    await expect(requestA.promise).rejects.toThrow("Failed to queue chase email");

    // B waited on A instead of trusting the approved status, so once A hands the
    // event back B claims it and performs its own enqueue — and reports queued
    // only because that enqueue actually succeeded.
    await expect(requestB.promise).resolves.toEqual({ success: true, queued: true });

    expect(mockBossSend).toHaveBeenCalledTimes(2);

    const [after] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(after.status).toBe("approved");
    expect(after.enqueuedAt).not.toBeNull();
  });

  it("approve after a worker already picked the job up reports alreadyQueued", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // The chase-send worker claims the job and moves the event to sending
    // before the creator clicks approve a second time.
    await db
      .update(schema.chaseEvents)
      .set({ status: "sending" })
      .where(eq(schema.chaseEvents.id, event.id));

    await expect(caller.approve({ chaseEventId: event.id })).resolves.toEqual({
      success: true,
      queued: true,
      alreadyQueued: true,
    });
    expect(mockBossSend).toHaveBeenCalledTimes(1);
  });

  it("sendChaseEmail sends via provider and records sent status + timeline", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve to move to approved state
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Use PostmarkProvider so fetch stub works
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    // Stub fetch so PostmarkProvider doesn't hit real network
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-sent-1" }) }))
    );

    // Simulate pg-boss worker calling sendChaseEmail
    const result = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    // Restore env
    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    expect(result.providerMessageId).toBeDefined();

    // Event is now sent
    const [updated] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(updated.status).toBe("sent");
    expect(updated.providerMessageId).toBe(result.providerMessageId);
    expect(updated.sentAt).not.toBeNull();

    // Timeline activity event
    const activities = await db
      .select()
      .from(schema.activityEvents)
      .where(
        and(
          eq(schema.activityEvents.entityId, invoice.id),
          eq(schema.activityEvents.kind, "chase_sent"),
          eq(schema.activityEvents.actor, "system")
        )
      )
      .orderBy(desc(schema.activityEvents.createdAt));

    const sentActivity = activities.find((a) => (a.payload as any).status === "sent");
    expect(sentActivity).toBeDefined();
    expect((sentActivity!.payload as any).providerMessageId).toBe(result.providerMessageId);
  });

  it("sendChaseEmail fails -> records failed status, then retry succeeds", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Use PostmarkProvider so fetch stub works
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    // Stub fetch to simulate Postmark failure
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 422, text: () => Promise.resolve("SMTP down") }))
    );

    // First send should fail and record failed status
    await expect(
      sendChaseEmail({
        chaseEventId: event.id,
        invoiceId: invoice.id,
        step: 1,
        toEmail: "brand@example.com",
        fromEmail: "chase@sponsee.app",
        replyToEmail: "creator@example.com",
        subject: event.subjectSnapshot || "Reminder",
        body: event.bodySnapshot || "Please pay",
        idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
      })
    ).rejects.toThrow("SMTP down");

    const [afterFail] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(afterFail.status).toBe("failed");

    // Now make fetch succeed (simulating pg-boss retry)
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "retry-msg-123" }) }))
    );

    const result = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    expect(result.providerMessageId).toBe("retry-msg-123");

    const [afterRetry] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(afterRetry.status).toBe("sent");
  });

  it("sendChaseEmail exclusive claim prevents concurrent workers from double-sending", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    let fetchCallCount = 0;
    let releaseFirstFetch: (() => void) | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCallCount++;
        return new Promise((resolve) => {
          if (fetchCallCount === 1) {
            releaseFirstFetch = () =>
              resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-exclusive-1" }) });
          } else {
            resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-exclusive-2" }) });
          }
        });
      })
    );

    const args = {
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    };

    // Start worker A and let it claim the event before worker B starts.
    const workerA = sendChaseEmail(args);
    await new Promise((r) => setTimeout(r, 20)); // PGlite claim is near-instant

    // Worker B races while worker A is still inside provider.send()
    const workerB = sendChaseEmail(args);
    workerB.catch(() => {}); // swallow early rejection so Vitest doesn't flag it as unhandled

    // Give worker B time to hit the exclusive claim and fail
    await new Promise((r) => setTimeout(r, 20));

    // Now release worker A
    if (releaseFirstFetch) releaseFirstFetch();

    const [resultA, resultB] = await Promise.allSettled([workerA, workerB]);

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    // Exactly one provider call — the second worker lost the race at the DB claim
    expect(fetchCallCount).toBe(1);

    const successes = (resultA.status === "fulfilled" ? [resultA] : []).concat(
      resultB.status === "fulfilled" ? [resultB] : []
    ) as PromiseFulfilledResult<{ providerMessageId: string }>[];
    const failures = (resultA.status === "rejected" ? [resultA] : []).concat(
      resultB.status === "rejected" ? [resultB] : []
    );

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(successes[0].value.providerMessageId).toBe("msg-exclusive-1");
  });

  it("sendChaseEmail Resend idempotency: Idempotency-Key header is sent and retry returns same ID", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "test-resend-key";

    const capturedHeaders: Record<string, string>[] = [];
    let fetchCallCount = 0;
    const resendIdempotencyMap = new Map<string, string>();

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        fetchCallCount++;
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers) capturedHeaders.push(headers);
        const idemKey = headers?.["Idempotency-Key"] ?? `call-${fetchCallCount}`;
        if (!resendIdempotencyMap.has(idemKey)) {
          resendIdempotencyMap.set(idemKey, `msg-resend-${fetchCallCount}`);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: resendIdempotencyMap.get(idemKey) }),
        });
      })
    );

    const args = {
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    };

    // First send
    const result1 = await sendChaseEmail(args);

    // Assert Idempotency-Key header was present on the actual outbound request
    expect(capturedHeaders.length).toBeGreaterThanOrEqual(1);
    expect(capturedHeaders[0]["Idempotency-Key"]).toBe(args.idempotencyKey);

    // Simulate provider-accepted-before-DB-persist gap:
    // provider returned an ID but the combined UPDATE never committed.
    // sendChaseEmail catch block marks failed; runChaseTick rescue will retry.
    await db
      .update(schema.chaseEvents)
      .set({ status: "failed", providerMessageId: null, sentAt: null })
      .where(eq(schema.chaseEvents.id, event.id));

    // Retry
    const result2 = await sendChaseEmail(args);

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    // Provider was called twice (no DB-level dedupe) but Resend's Idempotency-Key
    // guarantees the same provider-side message ID.
    expect(fetchCallCount).toBe(2);
    expect(result1.providerMessageId).toBe(result2.providerMessageId);

    const [final] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(final.status).toBe("sent");
    expect(final.providerMessageId).toBe(result1.providerMessageId);
  });

  it("runChaseTick schedules next action from template offsetDays, not hard-coded +1 day", async () => {
    const { invoice } = await seedFullFlow();
    await runChaseTick();

    const [state] = await db
      .select()
      .from(schema.invoiceChaseState)
      .where(eq(schema.invoiceChaseState.invoiceId, invoice.id));

    expect(state.nextStep).toBe(2);
    expect(state.nextActionAt).not.toBeNull();

    // Template step 2 has offsetDays: 5, so nextActionAt should be
    // dueAt + 5 days (not dueAt + 1 day)
    const expectedNext = new Date(invoice.dueAt!.getTime() + 5 * 24 * 60 * 60 * 1000);
    const actualNext = new Date(state.nextActionAt!);

    // Allow 1-second tolerance for test execution time
    expect(Math.abs(actualNext.getTime() - expectedNext.getTime())).toBeLessThan(1000);
  });

  it("events timeline returns chase events in reverse chronological order", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve and send
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Use PostmarkProvider so fetch stub works
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-tl" }) }))
    );

    await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    // Query timeline via router
    const timeline = await caller.events({ invoiceId: invoice.id });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].status).toBe("sent");
    expect(timeline[0].providerMessageId).toBe("msg-tl");
  });

  it("approve reverts to awaiting_review when boss.send fails", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    mockBossSend.mockRejectedValueOnce(new Error("pg-boss unavailable"));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await expect(caller.approve({ chaseEventId: event.id })).rejects.toSatisfy(
      (err: any) => err.code === "INTERNAL_SERVER_ERROR"
    );

    // Status must be reverted so creator can retry
    const [reverted] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(reverted.status).toBe("awaiting_review");
  });

  it("editAndSend reverts to awaiting_review when boss.send fails", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    mockBossSend.mockRejectedValueOnce(new Error("pg-boss unavailable"));

    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await expect(
      caller.editAndSend({ chaseEventId: event.id, subject: "Edited", body: "Edited body" })
    ).rejects.toSatisfy((err: any) => err.code === "INTERNAL_SERVER_ERROR");

    // Status reverted; snapshots are preserved because the atomic update won
    const [reverted] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(reverted.status).toBe("awaiting_review");
  });

  it("editAndSend atomic update prevents losing request from overwriting snapshots", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // First request wins the claim
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.editAndSend({ chaseEventId: event.id, subject: "Winner", body: "Winner body" });

    // Second request should fail because status is no longer awaiting_review
    await expect(
      caller.editAndSend({ chaseEventId: event.id, subject: "Loser", body: "Loser body" })
    ).rejects.toSatisfy((err: any) => err.code === "BAD_REQUEST");

    // Snapshots must retain the winner's values
    const [final] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(final.subjectSnapshot).toBe("Winner");
    expect(final.bodySnapshot).toBe("Winner body");
  });

  it("runChaseTick rescues stranded approved events by enqueueing them", async () => {
    const { invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Manually strand the event: set approved with an old updatedAt
    await db
      .update(schema.chaseEvents)
      .set({
        status: "approved",
        updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      })
      .where(eq(schema.chaseEvents.id, event.id));

    // runChaseTick should rescue the stranded event
    const created = await runChaseTick();
    // The rescue doesn't count toward created, so it should be 0
    expect(created).toBe(0);

    // A pg-boss job should have been enqueued for the stranded event
    expect(mockBossSend).toHaveBeenCalledTimes(1);
    const jobName = mockBossSend.mock.calls[0][0];
    const jobArgs = mockBossSend.mock.calls[0][1];
    expect(jobName).toBe("chase-send");
    expect(jobArgs.chaseEventId).toBe(event.id);
    expect(jobArgs.invoiceId).toBe(invoice.id);
  });

  it("runChaseTick rescues stranded sending events -> failed + job -> sent without duplicate", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve so a job would normally be queued
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Simulate a dead worker: event is in "sending" with an old updatedAt and no providerMessageId
    await db
      .update(schema.chaseEvents)
      .set({
        status: "sending",
        providerMessageId: null,
        sentAt: null,
        updatedAt: new Date(Date.now() - 35 * 60 * 1000), // 35 minutes ago
      })
      .where(eq(schema.chaseEvents.id, event.id));

    mockBossSend.mockClear();

    // runChaseTick should mark failed AND enqueue a retry job
    const created = await runChaseTick();
    expect(created).toBe(0); // rescue does not count as created

    const [afterRescue] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(afterRescue.status).toBe("failed");

    // A pg-boss job should have been enqueued
    expect(mockBossSend).toHaveBeenCalledTimes(1);
    const jobArgs = mockBossSend.mock.calls[0][1];
    expect(jobArgs.chaseEventId).toBe(event.id);

    // Now simulate the retry worker succeeding (Postmark path)
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    let fetchCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCallCount++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-rescue-1" }) });
      })
    );

    const result = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    // Exactly one provider call — no duplicate
    expect(fetchCallCount).toBe(1);
    expect(result.providerMessageId).toBe("msg-rescue-1");

    const [final] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(final.status).toBe("sent");
    expect(final.providerMessageId).toBe("msg-rescue-1");
  });

  it("sendChaseEmail delivery truth: retry promotes sending+providerMessageId to sent without resending", async () => {
    const { creator, invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // Approve
    const caller = chaseRouter.createCaller(mockCtx(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Use PostmarkProvider so fetch stub works
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-dt-1" }) }))
    );

    // First send succeeds
    const result1 = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });
    expect(result1.providerMessageId).toBe("msg-dt-1");

    // Simulate a failed status update: the providerMessageId is recorded but status is still "sending"
    await db
      .update(schema.chaseEvents)
      .set({ status: "sending", sentAt: null })
      .where(eq(schema.chaseEvents.id, event.id));

    // Reset fetch mock to verify no second network call
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "msg-dt-2" }) }))
    );

    // Retry should promote to sent without calling provider.send() again
    const result2 = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: "brand@example.com",
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    // Must return the original providerMessageId
    expect(result2.providerMessageId).toBe("msg-dt-1");

    // No second fetch call (no double-send)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);

    // Status is now sent
    const [final] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(final.status).toBe("sent");
    expect(final.providerMessageId).toBe("msg-dt-1");
  });

  it("Mailpit acceptance: end-to-end invoice -> review -> approve -> real inbox -> timeline", async () => {
    const smtpPort = await getFreePort();
    const httpPort = await getFreePort();
    const apiUrl = `http://127.0.0.1:${httpPort}`;

    const prevSmtpHost = process.env.MAILPIT_SMTP_HOST;
    const prevSmtpPort = process.env.MAILPIT_SMTP_PORT;
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.MAILPIT_SMTP_HOST = "127.0.0.1";
    process.env.MAILPIT_SMTP_PORT = String(smtpPort);
    delete process.env.EMAIL_PROVIDER; // force MailpitProvider

    const mailpit = startMailpit(smtpPort, httpPort);
    try {
      await waitForMailpit(apiUrl, 5000);

      const { creator, invoice } = await seedFullFlow();
      await runChaseTick();

      const [event] = await db
        .select()
        .from(schema.chaseEvents)
        .where(eq(schema.chaseEvents.invoiceId, invoice.id));

      const caller = chaseRouter.createCaller(mockCtx(creator.id));
      const approveResult = await caller.approve({ chaseEventId: event.id });
      expect(approveResult.queued).toBe(true);

      // sendChaseEmail uses the real MailpitProvider because EMAIL_PROVIDER is unset
      const result = await sendChaseEmail({
        chaseEventId: event.id,
        invoiceId: invoice.id,
        step: 1,
        toEmail: "brand@example.com",
        fromEmail: "chase@sponsee.app",
        replyToEmail: "creator@example.com",
        subject: event.subjectSnapshot || "Reminder",
        body: event.bodySnapshot || "Please pay",
        idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
      });

      expect(result.providerMessageId).toBeTruthy();

      // Verify message landed in the real Mailpit inbox. SMTP acceptance
      // (above) does not imply the HTTP API can already see it — poll.
      const matches = await waitForMailpitMatches<{ Subject: string; To: Array<{ Address: string }> }>(
        apiUrl,
        (m) => m.To?.some((t) => t.Address === "brand@example.com") ?? false
      );
      expect(matches[0].Subject).toContain("INV-0001");

      // Timeline shows sent event
      const timeline = await caller.events({ invoiceId: invoice.id });
      expect(timeline).toHaveLength(1);
      expect(timeline[0].status).toBe("sent");
      expect(timeline[0].providerMessageId).toBe(result.providerMessageId);
    } finally {
      await stopMailpit(mailpit);
      if (prevSmtpHost !== undefined) process.env.MAILPIT_SMTP_HOST = prevSmtpHost;
      else delete process.env.MAILPIT_SMTP_HOST;
      if (prevSmtpPort !== undefined) process.env.MAILPIT_SMTP_PORT = prevSmtpPort;
      else delete process.env.MAILPIT_SMTP_PORT;
      if (prevProvider !== undefined) process.env.EMAIL_PROVIDER = prevProvider;
      else delete process.env.EMAIL_PROVIDER;
    }
  });

  it("fresh database: chase_events has updated_at and it is auto-populated", async () => {
    const { invoice } = await seedFullFlow();
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    expect(event).toBeDefined();
    expect(event.updatedAt).not.toBeNull();
    expect(new Date(event.updatedAt!).getTime()).toBeGreaterThan(0);
  });
});

/**
 * SPO-64 — DeepSeek validation of the chase-email delivery-truth path.
 *
 * Four claims are exercised against the CURRENT implementation:
 *   1. An overdue invoice enters awaiting-review (no message sent yet).
 *   2. Approval then a real send lands EXACTLY ONE provider message.
 *   3. Provider failure marks the event failed with NO providerMessageId /
 *      sentAt (never synthetic success) and stays visible in the dead-letter view.
 *   4. A repeated approval is idempotent (single message, no double-send, no
 *      error on the identical request).
 *
 * Mailpit (local capture at localhost:8025 / SMTP 1025) is the "real provider".
 * Test 2 requires Mailpit to be reachable and fails explicitly if it is not —
 * it never skips, so CI green cannot be faked by an absent dependency.
 */
describe("SPO-64 delivery-truth audit (against Mailpit + current implementation)", () => {
  // Seed a single past-due open invoice with a UNIQUE recipient so an
  // "exactly one" assertion is unambiguous even next to other Mailpit traffic.
  async function seedIsolatedFlow(recipientEmail = `audit-${Date.now()}@example.com`) {
    const [creator] = await db
      .insert(schema.creators)
      .values({ displayName: "Audit Streamer" })
      .returning();

    const [brand] = await db
      .insert(schema.brands)
      .values({ creatorId: creator.id, name: "Audit Brand" })
      .returning();

    const [contact] = await db
      .insert(schema.contacts)
      .values({ brandId: brand.id, name: "Audit Contact", email: recipientEmail })
      .returning();

    const [deal] = await db
      .insert(schema.deals)
      .values({ creatorId: creator.id, brandId: brand.id, title: "Audit Deal", primaryContactId: contact.id })
      .returning();

    const due = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        creatorId: creator.id,
        dealId: deal.id,
        contactId: contact.id,
        number: 1,
        amountCents: 50000,
        currency: "USD",
        terms: "net_30",
        status: "open",
        title: "Invoice #0001",
        dueAt: due,
        issuedAt: new Date(Date.now() - 33 * 24 * 60 * 60 * 1000),
      })
      .returning();

    await db.insert(schema.chaseTemplates).values({
      creatorId: creator.id,
      step: 1,
      name: "Friendly reminder",
      offsetDays: 1,
      subject: "Payment reminder for {invoice_id}",
      body: "Hi {brand_contact}, please pay {amount} for {deal_title}.",
      enabled: true,
    });

    await db.insert(schema.invoiceChaseState).values({
      invoiceId: invoice.id,
      mode: "armed",
      nextStep: 1,
      nextActionAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    return { creator, contact, deal, invoice };
  }

  // Break the suite's terse helper closure: re-derive the router ctx.
  const ctxFor = mockCtx;

  it("1. overdue invoice enters awaiting-review (nothing sent yet)", async () => {
    const recipient = `audit-1-${Date.now()}@example.com`;
    const { invoice } = await seedIsolatedFlow(recipient);

    const created = await runChaseTick();
    expect(created).toBe(1);

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    expect(event.status).toBe("awaiting_review");
    expect(event.step).toBe(1);
    expect(event.toEmail).toBe(recipient);
    // No provider message id exists while it is only awaiting review.
    expect(event.providerMessageId).toBeNull();
    expect(event.sentAt).toBeNull();
  });

  it("2. approve + real send lands EXACTLY ONE provider message (Mailpit)", async () => {
    const recipient = `audit-2-${Date.now()}@example.com`;
    const { creator, invoice } = await seedIsolatedFlow(recipient);
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    // This test's entire purpose is asserting against a real Mailpit inbox —
    // a silent skip here would let CI go green without ever exercising the
    // acceptance path. Fail explicitly instead if Mailpit is unreachable.
    try {
      const probe = await fetch("http://localhost:8025/api/v1/messages");
      if (!probe.ok) {
        throw new Error(`Mailpit health check returned HTTP ${probe.status}`);
      }
    } catch (err) {
      throw new Error(
        `Mailpit is required for this acceptance test but is not reachable at ` +
          `http://localhost:8025/api/v1/messages: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Isolate the inbox so "exactly one" counts only this send.
    await fetch("http://localhost:8025/api/v1/messages", { method: "DELETE" });

    // Approve (real provider = Mailpit by default; EMAIL_PROVIDER unset here).
    const caller = chaseRouter.createCaller(ctxFor(creator.id));
    const approveResult = await caller.approve({ chaseEventId: event.id });
    expect(approveResult.success).toBe(true);
    expect(approveResult.queued).toBe(true);

    const result = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: recipient,
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });

    expect(result.providerMessageId).toBeTruthy();

    const [sent] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(sent.status).toBe("sent");
    expect(sent.providerMessageId).toBe(result.providerMessageId);
    expect(sent.sentAt).not.toBeNull();

    // Exactly ONE real message landed in Mailpit for this unique recipient.
    // SMTP acceptance does not imply the HTTP API can see it yet — poll.
    const matches = await waitForMailpitMatches<{ Subject: string; To: Array<{ Address: string }> }>(
      "http://localhost:8025",
      (m) => m.To?.some((t) => t.Address === recipient) ?? false
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].Subject).toContain("INV-0001");
  });

  it("3. provider failure -> failed with no synthetic success, stays retryable & visible", async () => {
    const recipient = `audit-3-${Date.now()}@example.com`;
    const { creator, invoice } = await seedIsolatedFlow(recipient);
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const caller = chaseRouter.createCaller(ctxFor(creator.id));
    await caller.approve({ chaseEventId: event.id });

    // Point at Postmark and simulate a hard provider outage (non-2xx).
    const prevProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "test-token";
    let failing = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        if (failing) {
          return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve("provider outage") });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ MessageID: "retry-ok-1" }) });
      })
    );

    // First send fails.
    await expect(
      sendChaseEmail({
        chaseEventId: event.id,
        invoiceId: invoice.id,
        step: 1,
        toEmail: recipient,
        fromEmail: "chase@sponsee.app",
        replyToEmail: "creator@example.com",
        subject: event.subjectSnapshot || "Reminder",
        body: event.bodySnapshot || "Please pay",
        idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
      })
    ).rejects.toThrow("provider outage");

    // Never synthetic success: failed, no message id, no sent timestamp.
    const [failed] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(failed.status).toBe("failed");
    expect(failed.providerMessageId).toBeNull();
    expect(failed.sentAt).toBeNull();

    // Visibly retryable: the failed event is surfaced by the dead-letter view.
    const deadLetters = await caller.failedEvents();
    expect(deadLetters.some((e) => e.id === event.id)).toBe(true);

    // Retrying succeeds, proving the failure was not a dead end and
    // that idempotent re-send is possible after a recorded failure.
    failing = false;
    const retry = await sendChaseEmail({
      chaseEventId: event.id,
      invoiceId: invoice.id,
      step: 1,
      toEmail: recipient,
      fromEmail: "chase@sponsee.app",
      replyToEmail: "creator@example.com",
      subject: event.subjectSnapshot || "Reminder",
      body: event.bodySnapshot || "Please pay",
      idempotencyKey: event.idempotencyKey || `invoice:${invoice.id}:step:1`,
    });
    if (prevProvider) process.env.EMAIL_PROVIDER = prevProvider;
    else delete process.env.EMAIL_PROVIDER;

    expect(retry.providerMessageId).toBe("retry-ok-1");

    const [afterRetry] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.id, event.id));
    expect(afterRetry.status).toBe("sent");
    expect(afterRetry.providerMessageId).toBe("retry-ok-1");
  });

  it("4. repeated approval is idempotent — second approve succeeds, no second send", async () => {
    const recipient = `audit-4-${Date.now()}@example.com`;
    const { creator, invoice } = await seedIsolatedFlow(recipient);
    await runChaseTick();

    const [event] = await db
      .select()
      .from(schema.chaseEvents)
      .where(eq(schema.chaseEvents.invoiceId, invoice.id));

    const caller = chaseRouter.createCaller(ctxFor(creator.id));
    const first = await caller.approve({ chaseEventId: event.id });
    expect(first.success).toBe(true);
    expect(first.queued).toBe(true);

    // An identical repeated approval must be idempotent: success, no error,
    // and the flag telling the caller the enqueue already happened.
    const second = await caller.approve({ chaseEventId: event.id });
    expect(second).toMatchObject({ success: true, queued: true, alreadyQueued: true });

    // The identical approval must not have produced a second message: confirm
    // only ONE send-chase job was ever enqueued (singletonKey dedupes).
    const chaseSendJobs = mockBossSend.mock.calls.filter((c) => c[0] === "chase-send");
    expect(chaseSendJobs).toHaveLength(1);
  });
});
