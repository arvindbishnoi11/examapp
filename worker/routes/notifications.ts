// =============================================================================
// Student-facing notification endpoints
//  POST /api/notifications/register    register a device FCM token
//  POST /api/notifications/unregister  deactivate a token
//  GET  /api/notifications             in-app notification feed
// =============================================================================

import type { Router } from '../lib/router';
import { badRequest, json, readJson, Validator } from '../lib/http';
import { requireAuth } from '../services/session';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { newId, nowIso } from '../lib/util';

const DEFAULTS = { push: true, email: true, examReminders: true, newContent: true } as const;
type Prefs = Record<keyof typeof DEFAULTS, boolean>;

/** Parses the stored JSON defensively — never throws on corrupt data. */
function safePrefs(raw: string | null | undefined): Prefs {
  try {
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const out = { ...DEFAULTS } as Prefs;
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      if (typeof parsed[key] === 'boolean') out[key] = parsed[key] as boolean;
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export function registerNotificationRoutes(router: Router): void {
  router.post('/api/notifications/register', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const token = v.string('token', { required: true, max: 512 })!;
    const platform = v.enum('platform', ['web', 'android', 'ios'] as const, { fallback: 'web' })!;
    const deviceInfo = v.string('deviceInfo', { max: 300 });
    v.throwIfInvalid();

    // FCM registration tokens are opaque; enforce a sane charset to avoid abuse.
    if (!/^[A-Za-z0-9_\-:.]+$/.test(token) || token.length < 40) {
      throw badRequest('That does not look like a valid device token.');
    }

    await ctx.env.DB.prepare(
      `INSERT INTO notification_tokens (id, user_id, token, platform, device_info, is_active, last_seen_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
       ON CONFLICT(token) DO UPDATE SET
         user_id = excluded.user_id, platform = excluded.platform, device_info = excluded.device_info,
         is_active = 1, last_seen_at = excluded.last_seen_at`,
    )
      .bind(newId(), auth.user.id, token, platform, deviceInfo ?? null, nowIso())
      .run();

    return json({ ok: true });
  });

  router.post('/api/notifications/unregister', async (ctx) => {
    const auth = await requireAuth(ctx);
    const body = await readJson(ctx.request);
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) throw badRequest('token is required.');
    await ctx.env.DB.prepare('UPDATE notification_tokens SET is_active = 0 WHERE token = ?1 AND user_id = ?2')
      .bind(token, auth.user.id)
      .run();
    return json({ ok: true });
  });

  router.get('/api/notifications/preferences', async (ctx) => {
    const auth = await requireAuth(ctx);
    const row = await ctx.env.DB.prepare('SELECT notification_prefs AS prefs FROM user_profiles WHERE user_id = ?1')
      .bind(auth.user.id)
      .first<{ prefs: string }>();
    return json({ preferences: safePrefs(row?.prefs) });
  });

  /**
   * Update the signed-in student's notification preferences. Only the four
   * known switches are persisted — unknown keys are ignored so a malformed
   * payload can never corrupt the JSON column.
   */
  router.put('/api/notifications/preferences', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));

    const body = await readJson(ctx.request);
    const raw = body.preferences;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('preferences must be an object.');

    const current = safePrefs(
      (await ctx.env.DB.prepare('SELECT notification_prefs AS prefs FROM user_profiles WHERE user_id = ?1')
        .bind(auth.user.id)
        .first<{ prefs: string }>())?.prefs,
    );
    const next: Prefs = { ...current };
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === 'boolean') next[key] = value;
    }

    await ctx.env.DB.prepare('UPDATE user_profiles SET notification_prefs = ?2, updated_at = ?3 WHERE user_id = ?1')
      .bind(auth.user.id, JSON.stringify(next), nowIso())
      .run();

    return json({ preferences: next });
  });

  /** In-app feed: announcements addressed to the student + their class goal. */
  router.get('/api/notifications', async (ctx) => {
    const auth = await requireAuth(ctx);
    const now = nowIso();
    const classId = (auth.profile?.classId as string) ?? null;
    const examTypeId = (auth.profile?.targetExamTypeId as string) ?? null;

    const rows = await ctx.env.DB.prepare(
      `SELECT id, title, body, image_url AS imageUrl, link_url AS linkUrl, priority, is_pinned AS isPinned,
              publish_at AS publishAt, created_at AS createdAt
         FROM announcements
        WHERE status = 'published'
          AND (publish_at IS NULL OR publish_at <= ?1)
          AND (expires_at IS NULL OR expires_at > ?1)
          AND (target_audience = 'all'
               OR (target_audience = 'class' AND class_id = ?2)
               OR (target_audience = 'exam_type' AND exam_type_id = ?3))
        ORDER BY is_pinned DESC, COALESCE(publish_at, created_at) DESC LIMIT 50`,
    )
      .bind(now, classId, examTypeId)
      .all<Record<string, unknown>>();

    return json({ items: (rows.results ?? []).map((r) => ({ ...r, isPinned: Boolean(r.isPinned) })) });
  });
}
