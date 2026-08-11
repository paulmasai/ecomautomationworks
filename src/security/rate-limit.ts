const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function consumeAdminRequest(userId: string, now = Date.now()): boolean {
  const existing = buckets.get(userId);
  if (existing === undefined || existing.resetAt <= now) {
    buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (existing.count >= MAX_REQUESTS) return false;
  existing.count += 1;

  if (buckets.size > 1_000) {
    for (const [key, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(key);
    }
  }

  return true;
}
