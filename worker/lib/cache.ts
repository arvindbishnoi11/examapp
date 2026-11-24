// =============================================================================
// Edge caching for *public* catalogue responses
// =============================================================================
// Only anonymous, non-personal GET responses may be cached. Anything touching a
// student session (results, attempts, progress, bookmarks) must never pass
// through here.
// =============================================================================

import { json } from './http';
import type { RouteCtx } from '../env';
import { sha256Hex } from './util';

export type CacheOptions = {
  ttlSeconds?: number;
  /** Extra cache key material (filters, pagination) — must not contain PII. */
  vary?: Record<string, string | number | boolean | undefined | null>;
  tags?: string[];
};

export async function cachedJson(ctx: RouteCtx, producer: () => Promise<unknown>, options: CacheOptions = {}): Promise<Response> {
  const ttl = Math.max(0, Math.min(options.ttlSeconds ?? Number(ctx.env.DEFAULT_CACHE_TTL ?? 60), 3600));
  if (ttl === 0) return json(await producer());

  const keyMaterial = JSON.stringify({ path: ctx.url.pathname, query: Object.fromEntries(ctx.url.searchParams), vary: options.vary ?? null });
  const key = `catalogue:${(await sha256Hex(keyMaterial)).slice(0, 40)}`;
  const now = Date.now();

  try {
    const row = await ctx.env.DB.prepare('SELECT payload, expires_at FROM api_cache WHERE key = ?1')
      .bind(key)
      .first<{ payload: string; expires_at: number }>();
    if (row && row.expires_at > now) {
      return json(JSON.parse(row.payload), {
        headers: {
          'cache-control': `public, max-age=${ttl}, stale-while-revalidate=30`,
          'x-cache': 'HIT',
        },
      });
    }
  } catch {
    /* fall through to producer */
  }

  const data = await producer();
  const body = JSON.stringify(data);

  ctx.ctx.waitUntil(
    (async () => {
      try {
        await ctx.env.DB.prepare(
          `INSERT INTO api_cache (key, payload, expires_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(key) DO UPDATE SET payload = ?2, expires_at = ?3`,
        )
          .bind(key, body, Date.now() + ttl * 1000)
          .run();
        if (Math.random() < 0.03) {
          await ctx.env.DB.prepare('DELETE FROM api_cache WHERE expires_at < ?1').bind(Date.now()).run();
        }
      } catch {
        /* best effort */
      }
    })(),
  );

  return json(data, {
    headers: {
      'cache-control': `public, max-age=${ttl}, stale-while-revalidate=30`,
      'x-cache': 'MISS',
    },
  });
}

/**
 * Invalidates catalogue caches after a publish/unpublish/update.
 * Coarse on purpose: correctness beats micro-optimisation, and writes are rare
 * compared with reads.
 */
export async function invalidateCatalogueCache(env: { DB: D1Database }, prefixes: string[] = []): Promise<void> {
  try {
    await env.DB.prepare('DELETE FROM api_cache WHERE key LIKE ?1').bind('catalogue:%').run();
    for (const prefix of prefixes) {
      await env.DB.prepare('DELETE FROM api_cache WHERE key LIKE ?1').bind(`${prefix}%`).run();
    }
  } catch (err) {
    console.error('cache_invalidation_failed', (err as Error)?.message);
  }
}

export function invalidateAsync(ctx: RouteCtx, prefixes: string[] = []): void {
  ctx.ctx.waitUntil(invalidateCatalogueCache(ctx.env, prefixes));
}
