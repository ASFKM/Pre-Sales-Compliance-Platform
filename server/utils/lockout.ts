import { redis } from "../../src/redis";

// Phase 2 (auth hardening): 5 failed attempts locks out for 15 minutes, scoped to account+IP
// combined (not account alone - locking someone out by deliberately failing their password from
// a different IP would be a denial-of-service vector) and auto-releases, no admin action needed.
// Password and MFA-code failures use separate counters - a leaked password and a broken
// authenticator app are different risks and shouldn't penalize each other's failure budget.
const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;

export type LockoutKind = "pwd" | "mfa";

function attemptsKey(kind: LockoutKind, email: string, ip: string): string {
  return `lockout:${kind}:${email.toLowerCase().trim()}:${ip}`;
}

export async function isLockedOut(kind: LockoutKind, email: string, ip: string): Promise<boolean> {
  const count = await redis.get(attemptsKey(kind, email, ip));
  return Number(count || 0) >= MAX_ATTEMPTS;
}

export async function recordFailedAttempt(kind: LockoutKind, email: string, ip: string): Promise<void> {
  const key = attemptsKey(kind, email, ip);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, LOCKOUT_WINDOW_SECONDS);
  }
}

export async function clearFailedAttempts(kind: LockoutKind, email: string, ip: string): Promise<void> {
  await redis.del(attemptsKey(kind, email, ip));
}
