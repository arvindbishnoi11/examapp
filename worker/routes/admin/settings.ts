// =============================================================================
// Admin: platform settings (typed, validated, audited)
// =============================================================================

import type { Router } from '../../lib/router';
import { badRequest, forbidden, json, readJson, Validator } from '../../lib/http';
import { requireAuth, requirePermission } from '../../services/session';
import { writeAudit } from '../../lib/audit';
import { invalidateAsync } from '../../lib/cache';
import { fcmHealth } from '../../services/fcm';
import { youtubeConfigured } from '../../services/youtube';
import { sheetsConfigured } from '../../services/google-sheets';

// Keys that only a super admin may change.
const SUPER_ADMIN_ONLY = new Set([
  'site.maintenance_mode',
  'features.registration_open',
  'features.push_notifications',
  'storage.test_paper_provider',
  'storage.max_pdf_mb',
  'sheets.spreadsheet_id',
  'sheets.sync_enabled',
  'sheets.sync_interval_minutes',
  'youtube.metadata_enabled',
  'cache.catalogue_ttl_seconds',
]);

const READONLY_KEYS = new Set<string>();

type SettingRow = {
  key: string;
  value: string | null;
  value_type: string;
  category: string;
  label: string | null;
  description: string | null;
  is_public: number;
  updated_at: string;
};

export function registerAdminSettingsRoutes(router: Router): void {
  router.get('/api/admin/settings', async (ctx) => {
    const auth = await requirePermission(ctx, 'settings.view');
    const rows = await ctx.env.DB.prepare(
      'SELECT key, value, value_type, category, label, description, is_public, updated_at FROM platform_settings ORDER BY category, key',
    ).all<SettingRow>();

    const grouped: Record<string, SettingRow[]> = {};
    for (const row of rows.results ?? []) {
      (grouped[row.category] ??= []).push(row);
    }

    return json({
      settings: rows.results ?? [],
      grouped,
      canManage: auth.isSuperAdmin || auth.permissions.has('settings.manage'),
      isSuperAdmin: auth.isSuperAdmin,
      health: {
        sheets: sheetsConfigured(ctx.env),
        youtube: youtubeConfigured(ctx.env),
        fcm: await fcmHealth(ctx.env),
        environment: ctx.env.APP_ENV ?? 'development',
      },
    });
  });

  router.put('/api/admin/settings', async (ctx) => {
    const auth = await requireAuth(ctx);
    await requirePermission(ctx, 'settings.manage');

    const body = await readJson(ctx.request, { maxBytes: 128 * 1024 });
    const v = new Validator(body);
    const updates = v.array('updates', { maxItems: 100 });
    v.throwIfInvalid();
    if (!updates?.length) throw badRequest('No settings were supplied.');

    const statements: D1PreparedStatement[] = [];
    const changed: { key: string; value: string }[] = [];

    for (const raw of updates) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as { key?: unknown; value?: unknown };
      const key = String(item.key ?? '').trim();
      if (!key) continue;
      if (READONLY_KEYS.has(key)) throw badRequest(`"${key}" is read-only.`);
      if (SUPER_ADMIN_ONLY.has(key) && !auth.isSuperAdmin) {
        throw forbidden(`Only the Super Admin can change "${key}".`);
      }

      const existing = await ctx.env.DB.prepare('SELECT key, value, value_type FROM platform_settings WHERE key = ?1')
        .bind(key)
        .first<{ key: string; value: string; value_type: string }>();
      if (!existing) throw badRequest(`Unknown setting "${key}".`);

      let value = item.value === null || item.value === undefined ? '' : String(item.value);
      if (existing.value_type === 'boolean' && !['true', 'false'].includes(value)) {
        throw badRequest(`"${key}" must be true or false.`);
      }
      if (existing.value_type === 'number' && !Number.isFinite(Number(value))) {
        throw badRequest(`"${key}" must be a number.`);
      }
      if (existing.value_type === 'json') {
        try {
          JSON.parse(value);
        } catch {
          throw badRequest(`"${key}" must be valid JSON.`);
        }
      }
      if (key === 'site.support_email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw badRequest('Support email must be a valid email address.');
      }
      if (key === 'storage.max_pdf_mb') value = String(Math.min(80, Math.max(1, Number(value))));
      if (key === 'exam.grace_seconds') value = String(Math.min(300, Math.max(0, Number(value))));
      if (key === 'cache.catalogue_ttl_seconds') value = String(Math.min(3600, Math.max(0, Number(value))));

      statements.push(
        ctx.env.DB.prepare('UPDATE platform_settings SET value = ?2, updated_by = ?3 WHERE key = ?1').bind(key, value, auth.user.id),
      );
      changed.push({ key, value });
    }

    if (!statements.length) throw badRequest('No valid settings were supplied.');
    await ctx.env.DB.batch(statements);
    invalidateAsync(ctx);

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'settings.update',
      entityType: 'platform_settings',
      after: Object.fromEntries(changed.map((c) => [c.key, c.value])),
    });
    return json({ ok: true, updated: changed.length });
  });

  // ---- Storage / integration self-check ---------------------------------
  router.get('/api/admin/settings/integrations', async (ctx) => {
    await requirePermission(ctx, 'settings.view');
    return json({
      googleSheets: {
        configured: sheetsConfigured(ctx.env),
        requiredSecret: 'GOOGLE_SERVICE_ACCOUNT_JSON',
        serviceAccount:
          'examcrack@long-disk-710-g2.iam.gserviceaccount.com (verify in Google Cloud console)',
        instructions: 'Share the spreadsheet with the service-account email as an Editor, and enable the Google Sheets API.',
      },
      youtube: {
        configured: youtubeConfigured(ctx.env),
        requiredSecret: 'YOUTUBE_API_KEY',
      },
      firebaseMessaging: { ...(await fcmHealth(ctx.env)), requiredSecret: 'FIREBASE_SERVICE_ACCOUNT_JSON' },
      cloudflare: {
        d1: true,
        r2: Boolean(ctx.env.MEDIA),
        assets: true,
      },
    });
  });
}
