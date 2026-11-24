// =============================================================================
// Admin: audit logs
// =============================================================================

import type { Router } from '../../lib/router';
import { json, parsePage, paginated } from '../../lib/http';
import { likePattern, toCsv } from '../../lib/util';
import { requirePermission } from '../../services/session';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';

export function registerAdminAuditRoutes(router: Router): void {
  router.get('/api/admin/audit-logs', async (ctx) => {
    await requirePermission(ctx, 'audit.view');
    const page = parsePage(ctx.url, { pageSize: 40, maxPageSize: 200 });
    const action = (ctx.url.searchParams.get('action') ?? '').trim();
    const actor = (ctx.url.searchParams.get('actor') ?? '').trim();
    const status = ctx.url.searchParams.get('status');
    const entityType = ctx.url.searchParams.get('entityType');

    const where: string[] = [];
    const binds: unknown[] = [];
    if (action) {
      binds.push(`${action}%`);
      where.push(`action LIKE ?${binds.length}`);
    }
    if (actor) {
      binds.push(likePattern(actor));
      where.push(`(actor_email LIKE ?${binds.length} OR actor_id = ?${binds.length})`);
    }
    if (status && ['success', 'failure', 'denied'].includes(status)) {
      binds.push(status);
      where.push(`status = ?${binds.length}`);
    }
    if (entityType) {
      binds.push(entityType);
      where.push(`entity_type = ?${binds.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [count, rows, actions] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${whereSql}`).bind(...binds).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT id, actor_id AS actorId, actor_email AS actorEmail, action, entity_type AS entityType,
                entity_id AS entityId, status, before_json AS beforeJson, after_json AS afterJson, meta_json AS metaJson,
                ip_hash AS ipHash, created_at AS createdAt
           FROM audit_logs ${whereSql} ORDER BY created_at DESC
          LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all(),
      ctx.env.DB.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC LIMIT 200').all<{ action: string }>(),
    ]);

    return json({
      ...paginated(rows.results ?? [], Number(count?.n ?? 0), page),
      actions: (actions.results ?? []).map((a) => a.action),
    });
  });

  router.get('/api/admin/audit-logs/export', async (ctx) => {
    const auth = await requirePermission(ctx, 'audit.view');
    await enforceRateLimit(ctx.env, RATE_LIMITS.audit, clientIdentity(ctx.request, auth.user.id));
    const rows = await ctx.env.DB.prepare(
      `SELECT created_at, actor_email, action, entity_type, entity_id, status, meta_json
         FROM audit_logs ORDER BY created_at DESC LIMIT 10000`,
    ).all<Record<string, unknown>>();
    return new Response(toCsv(rows.results ?? []), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="prepsetu-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
