import { getBoss } from "./boss.js";
import { runChaseTick } from "./chase-tick.js";

const CHASE_CRON = "0/15 * * * *"; // Every 15 minutes
const CHASE_TICK_JOB = "chase-tick";

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

  // Schedule recurring
  await boss.schedule(CHASE_TICK_JOB, CHASE_CRON, {});
}
