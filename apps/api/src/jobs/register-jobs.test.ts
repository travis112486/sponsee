import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerJobs } from "./index.js";

// pg-boss v12 delivers a *batch* of jobs to a work handler (`Job[]`), not a
// single `Job`. The chase-send worker must iterate the array; reading `.data`
// off the array silently yields `undefined` and crashes every real send. This
// test pins that contract so the regression that surfaced in prod (SPO-186)
// cannot come back.
const mocks = vi.hoisted(() => ({
  boss: {
    createQueue: vi.fn(),
    work: vi.fn(),
    schedule: vi.fn(),
  },
  sendChaseEmail: vi.fn(),
  runChaseTick: vi.fn(),
  runPlatformSync: vi.fn(),
  runStorageOrphanSweep: vi.fn(),
}));

vi.mock("./boss.js", () => ({
  getBoss: vi.fn(() => Promise.resolve(mocks.boss)),
  stopBoss: vi.fn(() => Promise.resolve()),
}));
vi.mock("./chase-tick.js", () => ({
  runChaseTick: mocks.runChaseTick,
  sendChaseEmail: mocks.sendChaseEmail,
}));
vi.mock("./platform-sync.js", () => ({ runPlatformSync: mocks.runPlatformSync }));
vi.mock("../storage/sweep.js", () => ({ runStorageOrphanSweep: mocks.runStorageOrphanSweep }));

type WorkCall = [name: string, handler: (jobs: Array<{ data: unknown }>) => Promise<unknown>];

function getChaseSendHandler(): WorkCall[1] {
  const calls = mocks.boss.work.mock.calls as WorkCall[];
  const match = calls.find(([name]) => name === "chase-send");
  if (!match) throw new Error("chase-send worker was not registered");
  return match[1];
}

const payload = {
  chaseEventId: "evt-1",
  invoiceId: "inv-1",
  step: 1,
  toEmail: "brand@example.com",
  fromEmail: "chase@sponsee.app",
  replyToEmail: "creator@example.com",
  subject: "subject",
  body: "body",
  idempotencyKey: "k-1",
};

describe("registerJobs chase-send worker (pg-boss v12 batch contract)", () => {
  beforeEach(async () => {
    mocks.boss.work.mockClear();
    mocks.sendChaseEmail.mockReset();
    await registerJobs();
  });

  it("passes job.data (not the batch array) to sendChaseEmail", async () => {
    mocks.sendChaseEmail.mockResolvedValue({ providerMessageId: "mid" });
    await getChaseSendHandler()([{ data: payload }]);
    expect(mocks.sendChaseEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendChaseEmail).toHaveBeenCalledWith(payload);
  });

  it("processes every job in a multi-job batch", async () => {
    mocks.sendChaseEmail.mockResolvedValue({ providerMessageId: "mid" });
    const second = { ...payload, chaseEventId: "evt-2", idempotencyKey: "k-2" };
    await getChaseSendHandler()([{ data: payload }, { data: second }]);
    expect(mocks.sendChaseEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendChaseEmail).toHaveBeenNthCalledWith(1, payload);
    expect(mocks.sendChaseEmail).toHaveBeenNthCalledWith(2, second);
  });

  it("rethrows a failed send so pg-boss retries", async () => {
    mocks.sendChaseEmail.mockRejectedValue(new Error("provider down"));
    await expect(getChaseSendHandler()([{ data: payload }])).rejects.toThrow("provider down");
  });
});
