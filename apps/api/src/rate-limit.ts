// Best-effort in-process rate limiter for unauthenticated public endpoints.
//
// Deliberately not the Better Auth database limiter: that one is keyed to
// Better Auth's own table and prunes rows older than its longest configured
// window (60s), which would silently reset any longer window stored alongside
// it. This one is per instance, so a horizontally scaled deploy multiplies the
// effective allowance by the instance count. It exists to bound accidental
// floods and casual scripted abuse, not to be an authorization control.

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the caller may retry. `0` when allowed. */
  retryAfter: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_BUCKETS = 10_000;

export class SlidingWindowLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  check(key: string, now: number = Date.now()): RateLimitDecision {
    this.prune(now);

    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfter: 0 };
    }

    if (bucket.count >= this.max) {
      return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
    }

    bucket.count += 1;
    return { allowed: true, retryAfter: 0 };
  }

  reset() {
    this.buckets.clear();
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
    // Unbounded key growth is itself the DoS. Evict oldest-inserted first.
    if (this.buckets.size <= MAX_BUCKETS) return;
    const overflow = this.buckets.size - MAX_BUCKETS;
    let removed = 0;
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      if (++removed >= overflow) break;
    }
  }
}
