// SPO-374 budget guard: unavatar's anonymous free tier is 25 requests/day per
// IP (confirmed live via `x-rate-limit-limit`), and a 404 costs the same 1
// token as a hit. This is a soft, in-process safety valve against a bug or a
// traffic spike burning the whole daily allowance in one deploy — it resets on
// every restart/redeploy and is per-instance, so it is not a substitute for
// watching the vendor dashboard. Real budget enforcement (the "$20/month ->
// founder payment card" trigger) is a monitoring decision, not something this
// counter can guarantee; it only keeps a single runaway instance from
// hammering the free tier into a 429 storm for every creator at once.
//
// The cap is set below unavatar's own 25/day so there is headroom for the
// small number of calls this same process makes for manual verification.
export const UNAVATAR_DAILY_SOFT_CAP = 20;

export class DailyCounter {
  private day: string | null = null;
  private count = 0;

  constructor(private readonly cap: number) {}

  private currentDay(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
  }

  /** True if a call is still within today's soft cap; also records the call. */
  tryConsume(now: number = Date.now()): boolean {
    const today = this.currentDay(now);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    if (this.count >= this.cap) return false;
    this.count += 1;
    return true;
  }

  reset(): void {
    this.day = null;
    this.count = 0;
  }
}

export const unavatarDailyCounter = new DailyCounter(UNAVATAR_DAILY_SOFT_CAP);
