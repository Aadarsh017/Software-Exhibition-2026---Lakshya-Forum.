// A small burst limiter kept in the memory of one function instance. It is best-effort: separate
// instances do not share it, so the daily quota in the database remains the real limit. It stops a
// loop or a double-click storm that hits the same warm instance.
export type RateLimiter = (key: string) => { ok: true } | { ok: false; retryAfterSeconds: number };

export function createRateLimiter(perMinute: number, now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, number[]>();
  return (key) => {
    const at = now();
    const recent = (hits.get(key) ?? []).filter((time) => at - time < 60_000);
    if (recent.length >= perMinute) {
      hits.set(key, recent);
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((60_000 - (at - recent[0])) / 1000)) };
    }
    recent.push(at);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [id, times] of hits) if (!times.some((time) => at - time < 60_000)) hits.delete(id);
    }
    return { ok: true };
  };
}
