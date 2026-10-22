import "server-only";

/**
 * In-memory spend guards for a single server process:
 * - a sliding one-minute window per client key, and
 * - a global daily request cap (UTC day).
 *
 * Multi-instance or serverless deployments do not share this memory; use a
 * shared store (e.g. Redis) or the hosting platform's rate limiting there.
 */

export interface RateDecision {
  allowed: boolean;
  retryAfterMs?: number;
  reason?: "per_minute" | "daily_cap";
}

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private day = "";
  private dayCount = 0;

  constructor(
    private readonly perMinute: number,
    private readonly dailyCap: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateDecision {
    const now = this.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.dayCount = 0;
    }
    if (this.dailyCap > 0 && this.dayCount >= this.dailyCap) {
      const tomorrow = Date.parse(`${today}T00:00:00.000Z`) + 86_400_000;
      return { allowed: false, reason: "daily_cap", retryAfterMs: tomorrow - now };
    }

    const windowStart = now - 60_000;
    const hits = (this.windows.get(key) ?? []).filter((t) => t > windowStart);
    if (hits.length >= this.perMinute) {
      this.windows.set(key, hits);
      return { allowed: false, reason: "per_minute", retryAfterMs: hits[0] + 60_000 - now };
    }
    hits.push(now);
    this.windows.set(key, hits);
    this.dayCount++;

    if (this.windows.size > 10_000) this.prune(windowStart);
    return { allowed: true };
  }

  private prune(windowStart: number) {
    for (const [k, hits] of this.windows) {
      if (hits.every((t) => t <= windowStart)) this.windows.delete(k);
    }
  }
}

/**
 * Best-effort client key. `x-forwarded-for` is only trustworthy behind a
 * proxy that sets it; without one, clients can spoof it.
 */
export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64) || "unknown";
  return headers.get("x-real-ip")?.trim().slice(0, 64) || "local";
}
