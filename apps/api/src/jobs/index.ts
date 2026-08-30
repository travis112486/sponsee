import { getBoss } from "./boss.js";
import { runChaseTick, sendChaseEmail } from "./chase-tick.js";
import { runPlatformSync } from "./platform-sync.js";

const CHASE_CRON = "0/15 * * * *"; // Every 15 minutes
const CHASE_TICK_JOB = "chase-tick";
const CHASE_SEND_JOB = "chase-send";
const PLATFORM_SYNC_CRON = "30 6 * * *"; // Daily 06:30 UTC — plenty for a CRM, keeps YouTube quota trivial
const PLATFORM_SYNC_JOB = "platform-sync";

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

  // Register handler
  boss.work(CHASE_TICK_JOB, async () => {
    const created = await runChaseTick();
    if (created > 0) {
      console.log(`[chase-tick] Created ${created} awaiting-review event(s)`);
    }
  });

  // Chase-send handler: durable, retryable email dispatch
  boss.work(CHASE_SEND_JOB, async (job: any) => {
    try {
      await sendChaseEmail(job.data as Parameters<typeof sendChaseEmail>[0]);
    } catch (err) {
      console.error(`[chase-send] Failed for event ${job.data?.chaseEventId}:`, (err as Error).message);
      throw err; // pg-boss will retry according to retryLimit/retryDelay
    }
  });

  boss.work(PLATFORM_SYNC_JOB, async () => {
    const { synced, errored, skipped } = await runPlatformSync();
    console.log(`[platform-sync] synced=${synced} errored=${errored} skipped=${skipped}`);
  });

  // Schedule recurring
  await boss.schedule(CHASE_TICK_JOB, CHASE_CRON, {});
  await boss.schedule(PLATFORM_SYNC_JOB, PLATFORM_SYNC_CRON, {});
}
