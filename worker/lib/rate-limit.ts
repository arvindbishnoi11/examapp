// =============================================================================
// Rate limiting — fixed-window counters in D1.
// =============================================================================
// Keys are salted hashes of (bucket + identity), never raw IP addresses, so the
// table cannot be turned into a browsing-history database if it leaks.
// Expired rows are pruned opportunistically during each write.
// =============================================================================

import type { Env } from '../env';
import { sha256Hex } from './util';
import { tooManyRequests } from './http';

export type RateLimitRule = {
  /** Logical bucket name, e.g. "auth.me". */
  name: string;
  limit: number;
  windowSeconds: number;
};

export const RATE_LIMITS = {
  authVerify: { name: 'auth.verify', limit: 30, windowSeconds: 60 },
  authMe: { name: 'auth.me', limit: 120, windowSeconds: 60 },
  read: { name: 'read', limit: 240, windowSeconds: 60 },
  write: { name: 'write', limit: 60, windowSeconds: 60 },
  examAnswer: { name: 'exam.answer', limit: 600, windowSeconds: 60 },
  examStart: { name: 'exam.start', limit: 20, windowSeconds: 300 },
  examSubmit: { name: 'exam.submit', limit: 20, windowSeconds: 300 },
  youtube: { name: 'youtube.metadata', limit: 20, windowSeconds: 60 },
  sheets: { name: 'sheets.sync', limit: 6, windowSeconds: 300 },
  notifications: { name: 'notifications.send', limit: 10, windowSeconds: 300 },
  upload: { name: 'upload', limit: 30, windowSeconds: 300 },
  audit: { name: 'audit', limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export async function rateLimitKey(env: Env, bucket: string, identity: string): Promise<string> {
  const salt = env.IP_HASH_SECRET || env.ADMIN_SESSION_SECRET || 'prepsetu-default-salt';
  return sha256Hex(`${salt}:${bucket}:${identity}`);
}

export function clientIdentity(request: Request, userId?: string): string {
  if (userId) return `u:${userId}`;
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  return `i:${ip}`;
}

/**
 * Consume one unit from a bucket. Throws HttpError 429 when the limit is hit.
 * Fails *open* on storage errors: a D1 hiccup must not lock students out of an
 * exam in progress — the API remains protected by authentication and quotas.
 */
export async function enforceRateLimit(env: Env, rule: RateLimitRule, identity: string): Promise<void> {
  const key = await rateLimitKey(env, rule.name, identity);
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const expiresAt = windowStart + windowMs;

  try {
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits (key, window_start, count, expires_at)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = ?2 THEN rate_limits.count + 1 ELSE 1 END,
         window_start = ?2,
         expires_at = ?3
       RETURNING count, expires_at`,
    )
      .bind(key, windowStart, expiresAt)
      .first<{ count: number; expires_at: number }>();

    // Opportunistic pruning (cheap, indexed).
    if (Math.random() < 0.05) {
      await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?1').bind(now).run();
    }

    if (row && row.count > rule.limit) {
      const retryAfter = Math.max(1, Math.ceil((row.expires_at - now) / 1000));
      throw tooManyRequests('Too many requests. Please slow down and try again shortly.', retryAfter);
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    console.error('rate_limit_storage_error', (err as Error)?.message);
  }
}
