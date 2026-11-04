import { HttpError } from "./api";

/**
 * Fixed-window in-memory limiter for auth endpoints. Per-instance only —
 * swap for Redis (e.g. @upstash/ratelimit) once you run more than one web replica.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: Request, scope: string, max: number, windowSec: number) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return;
  }
  if (++b.count > max) throw new HttpError(429, "Too many attempts, try again shortly");
}
