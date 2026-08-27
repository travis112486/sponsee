import { getBoss } from "./boss.js";
import { runChaseTick, sendChaseEmail } from "./chase-tick.js";

const CHASE_CRON = "0/15 * * * *"; // Every 15 minutes
const CHASE_TICK_JOB = "chase-tick";
const CHASE_SEND_JOB = "chase-send";

/**
 * Register all recurring jobs with pg-boss.
 * Call once at server startup.
 */
export async function registerJobs(): Promise<void> {
  const boss = await getBoss();

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

  // Schedule recurring
  await boss.schedule(CHASE_TICK_JOB, CHASE_CRON, {});
}
