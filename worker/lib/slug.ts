// =============================================================================
// Slug helpers that guarantee uniqueness against a table column.
// =============================================================================

import { slugify } from './util';

/** Adds a short random suffix so concurrent creates cannot collide. */
export function uniqueSlug(base: string): string {
  const core = slugify(base, 60);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${core}-${suffix}`;
}

/** Builds a slug that is unique for the given table+column. */
export async function ensureUniqueSlug(
  db: { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } } },
  table: string,
  column: string,
  base: string,
): Promise<string> {
  const core = slugify(base, 60);
  let candidate = core;
  for (let attempt = 0; attempt < 25; attempt++) {
    const row = await db.prepare(`SELECT 1 AS n FROM ${table} WHERE ${column} = ?1 LIMIT 1`).bind(candidate).first<{ n: number }>();
    if (!row) return candidate;
    candidate = `${core}-${attempt + 2}`;
  }
  return uniqueSlug(base);
}
