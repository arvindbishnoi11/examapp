// =============================================================================
// Admin: Google Sheets manager
// =============================================================================

import type { Router } from '../../lib/router';
import { badRequest, json, parsePage, paginated, readJson, Validator } from '../../lib/http';
import { requirePermission } from '../../services/session';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { writeAudit } from '../../lib/audit';
import { inspectSpreadsheet, lastSync, runSync, syncLocked } from '../../services/sheets-sync';
import { sheetsConfigured, sheetsSpreadsheetId } from '../../services/google-sheets';
import { SHEET_SPECS } from '../../services/sheets-schema';
import { invalidateCatalogueCache } from '../../lib/cache';

export function registerAdminSheetsRoutes(router: Router): void {
  // ---- Status ------------------------------------------------------------
  router.get('/api/admin/sheets/status', async (ctx) => {
    await requirePermission(ctx, 'sheets.view');
    const inspection = await inspectSpreadsheet(ctx.env);
    const last = await lastSync(ctx.env);
    const locked = await syncLocked(ctx.env);

    return json({
      configured: inspection.configured && sheetsConfigured(ctx.env),
      spreadsheetId: sheetsSpreadsheetId(ctx.env),
      spreadsheetTitle: inspection.title,
      worksheets: inspection.worksheets,
      lastSync: last,
      schedulerEnabled: true,
      syncInProgress: locked,
      message: inspection.message,
      specs: SHEET_SPECS.map((s) => ({
        entity: s.entity,
        sheets: s.sheets,
        description: s.description,
        requiredColumns: s.columns.filter((c) => c.required).map((c) => c.field),
      })),
    });
  });

  // ---- Mapping preview ---------------------------------------------------
  router.get('/api/admin/sheets/mappings', async (ctx) => {
    await requirePermission(ctx, 'sheets.view');
    const inspection = await inspectSpreadsheet(ctx.env);
    const mapped = new Map(inspection.worksheets.map((w) => [w.title.toLowerCase(), w]));
    return json({
      mappings: SHEET_SPECS.map((spec) => {
        const found = spec.sheets.map((s) => mapped.get(s)).find(Boolean);
        return {
          entity: spec.entity,
          acceptedNames: spec.sheets,
          present: Boolean(found),
          worksheet: found?.title ?? null,
          headerSample: found?.headerSample ?? [],
          requiredColumns: spec.columns.filter((c) => c.required).map((c) => c.field),
        };
      }),
      message: inspection.message ?? null,
    });
  });

  // ---- Preview -----------------------------------------------------------
  router.post('/api/admin/sheets/preview-sync', async (ctx) => {
    const auth = await requirePermission(ctx, 'sheets.sync');
    await enforceRateLimit(ctx.env, RATE_LIMITS.sheets, clientIdentity(ctx.request, auth.user.id));

    const body = await readJson(ctx.request);
    const sheets = Array.isArray(body.sheets) ? body.sheets.map(String).slice(0, 20) : undefined;

    const outcome = await runSync(ctx.env, { mode: 'preview', sheetFilter: sheets, actorId: auth.user.id });
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'sheets.preview',
      entityType: 'sync',
      status: outcome.report.status === 'failed' ? 'failure' : 'success',
      meta: { sheets },
    });
    return json({ report: outcome.report, preview: outcome.preview ?? {} });
  });

  // ---- Run a sync --------------------------------------------------------
  router.post('/api/admin/sheets/sync', async (ctx) => {
    const auth = await requirePermission(ctx, 'sheets.sync');
    await enforceRateLimit(ctx.env, RATE_LIMITS.sheets, clientIdentity(ctx.request, auth.user.id));

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const mode = v.enum('mode', ['full', 'incremental'] as const, { fallback: 'incremental' })!;
    const force = v.boolean('force', false);
    v.throwIfInvalid();

    const sheets = Array.isArray(body.sheets) ? body.sheets.map(String).slice(0, 20) : undefined;
    if (!force && (await syncLocked(ctx.env))) {
      return json(
        {
          error: {
            code: 'sync_in_progress',
            message: 'A synchronisation is already running. Wait for it to finish, or retry with force after 15 minutes.',
          },
        },
        { status: 409 },
      );
    }

    const outcome = await runSync(ctx.env, { mode, sheetFilter: sheets, actorId: auth.user.id });

    // Publishing content through Sheets must be visible immediately.
    if (outcome.report.status !== 'failed') {
      await invalidateCatalogueCache(ctx.env);
    }

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'sheets.sync',
      entityType: 'sync',
      status: outcome.report.status === 'failed' ? 'failure' : 'success',
      meta: {
        mode,
        sheets,
        totals: outcome.report.sheets.reduce(
          (acc, s) => ({
            inserted: acc.inserted + s.inserted,
            updated: acc.updated + s.updated,
            failed: acc.failed + s.failed,
          }),
          { inserted: 0, updated: 0, failed: 0 },
        ),
      },
    });

    return json({ report: outcome.report });
  });

  // ---- Sync history ------------------------------------------------------
  router.get('/api/admin/sheets/logs', async (ctx) => {
    await requirePermission(ctx, 'sheets.view');
    const page = parsePage(ctx.url, { pageSize: 20 });
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM sync_logs').first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT id, mode, status, started_at AS startedAt, finished_at AS finishedAt, duration_ms AS durationMs,
                stats_json AS statsJson, error_message AS errorMessage,
                (SELECT email FROM users WHERE users.id = sync_logs.triggered_by) AS triggeredBy
           FROM sync_logs ORDER BY started_at DESC LIMIT ?1 OFFSET ?2`,
      )
        .bind(page.pageSize, page.offset)
        .all(),
    ]);
    return json(paginated(rows.results ?? [], Number(count?.n ?? 0), page));
  });

  router.get('/api/admin/sheets/logs/:id', async (ctx) => {
    await requirePermission(ctx, 'sheets.view');
    const row = await ctx.env.DB.prepare('SELECT * FROM sync_logs WHERE id = ?1').bind(ctx.params.id).first();
    if (!row) throw badRequest('Sync log not found.');
    return json({ log: row });
  });

  // ---- Manual cache purge -----------------------------------------------
  router.post('/api/admin/sheets/cache/purge', async (ctx) => {
    const auth = await requirePermission(ctx, 'sheets.sync');
    await invalidateCatalogueCache(ctx.env);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'cache.purge', entityType: 'cache' });
    return json({ ok: true });
  });
}
