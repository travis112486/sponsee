import type { Job } from "pg-boss";
import { getBoss } from "./boss.js";
import { runChaseTick, sendChaseEmail } from "./chase-tick.js";
import { runPlatformSync } from "./platform-sync.js";
import { runStorageOrphanSweep } from "../storage/sweep.js";

type ChaseSendPayload = Parameters<typeof sendChaseEmail>[0];

const CHASE_CRON = "0/15 * * * *"; // Every 15 minutes
const CHASE_TICK_JOB = "chase-tick";
const CHASE_SEND_JOB = "chase-send";
const PLATFORM_SYNC_CRON = "30 6 * * *"; // Daily 06:30 UTC — plenty for a CRM, keeps YouTube quota trivial
const PLATFORM_SYNC_JOB = "platform-sync";
const STORAGE_SWEEP_CRON = "0 4 * * *"; // Daily 04:00 UTC
const STORAGE_SWEEP_JOB = "storage-sweep";

/**
 * Register all recurring jobs with pg-boss.
 * Call once at server startup.
 */
export async function registerJobs(): Promise<void> {
  const boss = await getBoss();

  // pg-boss v10+ requires queues to exist before work()/send(); createQueue is idempotent
  await boss.createQueue(CHASE_TICK_JOB);
  await boss.createQueue(CHASE_SEND_JOB);
  await boss.createQueue(PLATFORM_SYNC_JOB);
  await boss.createQueue(STORAGE_SWEEP_JOB);

  // Register handler
  boss.work(CHASE_TICK_JOB, async () => {
    const created = await runChaseTick();
    if (created > 0) {
      console.log(`[chase-tick] Created ${created} awaiting-review event(s)`);
    }
  });

  // Chase-send handler: durable, retryable email dispatch.
  // pg-boss v12 delivers a *batch* of jobs to a work handler — the callback
  // receives `Job[]`, never a single `Job`. Reading `job.data` off the array
  // silently yields `undefined` and crashes every send (SPO-186). The explicit
  // ReqData generic keeps `job.data` typed, so the compiler rejects any future
  // regression to reading `.data` off the batch itself.
  boss.work<ChaseSendPayload>(CHASE_SEND_JOB, async (jobs: Job<ChaseSendPayload>[]) => {
    for (const job of jobs) {
      try {
        await sendChaseEmail(job.data);
      } catch (err) {
        console.error(`[chase-send] Failed for event ${job.data?.chaseEventId}:`, (err as Error).message);
        throw err; // pg-boss will retry according to retryLimit/retryDelay
      }
    }
  });

  boss.work(PLATFORM_SYNC_JOB, async () => {
    const { synced, errored, skipped } = await runPlatformSync();
    console.log(`[platform-sync] synced=${synced} errored=${errored} skipped=${skipped}`);
  });

  // Reconciles storage objects orphaned by a hard `deals` row deletion — see
  // the doc comment on runStorageOrphanSweep for why this is needed alongside
  // (not instead of) the app-initiated deleteObject call sites. No-ops until
  // storage is configured.
  boss.work(STORAGE_SWEEP_JOB, async () => {
    const { scanned, deleted, skippedUnrecognized, skippedUnconfigured } = await runStorageOrphanSweep();
    if (skippedUnconfigured) return;
    console.log(`[storage-sweep] scanned=${scanned} deleted=${deleted} skippedUnrecognized=${skippedUnrecognized}`);
  });

  // Schedule recurring
  await boss.schedule(CHASE_TICK_JOB, CHASE_CRON, {});
  await boss.schedule(PLATFORM_SYNC_JOB, PLATFORM_SYNC_CRON, {});
  await boss.schedule(STORAGE_SWEEP_JOB, STORAGE_SWEEP_CRON, {});
}
