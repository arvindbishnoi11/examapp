// =============================================================================
// Admin API routes (all permission-checked server-side)
// =============================================================================

import type { Router } from '../../lib/router';
import { registerAdminDashboardRoutes } from './dashboard';
import { registerAdminStudentRoutes } from './students';
import { registerAdminAdminRoutes } from './admins';
import { registerAdminCourseRoutes } from './courses';
import { registerAdminLectureRoutes } from './lectures';
import { registerAdminExamRoutes } from './exams';
import { registerAdminQuestionRoutes } from './questions';
import { registerAdminPaperRoutes } from './papers';
import { registerAdminNotificationRoutes } from './notifications';
import { registerAdminSheetsRoutes } from './sheets';
import { registerAdminSettingsRoutes } from './settings';
import { registerAdminAnalyticsRoutes } from './analytics';
import { registerAdminAuditRoutes } from './audit';
import { registerAdminYouTubeRoutes } from './youtube';
import { PERMISSIONS } from '../../../shared/permissions';
import { json } from '../../lib/http';
import { requireAuth, sessionPayload } from '../../services/session';

export function registerAdminRoutes(router: Router): void {
  registerAdminDashboardRoutes(router);
  registerAdminStudentRoutes(router);
  registerAdminAdminRoutes(router);
  registerAdminCourseRoutes(router);
  registerAdminLectureRoutes(router);
  registerAdminExamRoutes(router);
  registerAdminQuestionRoutes(router);
  registerAdminPaperRoutes(router);
  registerAdminNotificationRoutes(router);
  registerAdminSheetsRoutes(router);
  registerAdminSettingsRoutes(router);
  registerAdminAnalyticsRoutes(router);
  registerAdminAuditRoutes(router);
  registerAdminYouTubeRoutes(router);

  // Permission catalogue + role definitions for the admin UI (no secrets).
  router.get('/api/admin/meta/permissions', async (ctx) => {
    const auth = await requireAuth(ctx);
    return json({
      permissions: PERMISSIONS,
      roles: await ctx.env.DB.prepare(
        `SELECT r.id, r.key, r.name, r.description, r.level, r.is_system AS isSystem,
                (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id AND ur.is_active = 1) AS memberCount
           FROM roles r ORDER BY r.level DESC`,
      ).all().then((rows) => (rows.results ?? []).map((r) => ({ ...r, isSystem: Boolean(r.isSystem) }))),
      rolePermissions: await ctx.env.DB.prepare('SELECT role_id AS roleId, permission_key AS permissionKey FROM role_permissions')
        .all()
        .then((r) => r.results ?? []),
      me: sessionPayload(auth),
    });
  });

  // Lightweight connectivity / configuration probe for the admin dashboard.
  router.get('/api/admin/system/status', async (ctx) => {
    const auth = await requireAuth(ctx);
    if (!auth.isStaff) {
      return json({ error: { code: 'forbidden', message: 'Staff access required.' } }, { status: 403 });
    }
    const settings = await ctx.env.DB.prepare('SELECT key, value FROM platform_settings WHERE category IN (?,?,?)')
      .bind('sync', 'storage', 'content')
      .all<{ key: string; value: string }>();

    return json({
      sheetsConfigured: Boolean(ctx.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()),
      youtubeConfigured: Boolean(ctx.env.YOUTUBE_API_KEY?.trim()),
      firebaseAdminConfigured: Boolean(ctx.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()),
      superAdminEmail: ctx.env.SUPER_ADMIN_EMAIL ?? null,
      environment: ctx.env.APP_ENV ?? 'development',
      settings: Object.fromEntries((settings.results ?? []).map((s) => [s.key, s.value])),
      time: new Date().toISOString(),
    });
  });
}
