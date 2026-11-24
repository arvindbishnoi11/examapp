// =============================================================================
// Admin: student directory, profiles, suspension, export
// =============================================================================

import type { Router } from '../../lib/router';
import {
  badRequest,
  conflict,
  forbidden,
  json,
  notFound,
  parsePage,
  paginated,
  readJson,
  Validator,
} from '../../lib/http';
import { requirePermission } from '../../services/session';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { writeAudit } from '../../lib/audit';
import { toCsv, nowIso, isoDaysAgo } from '../../lib/util';

async function assertNotStaffTarget(env: { DB: D1Database }, userId: string): Promise<void> {
  const staff = await env.DB.prepare(
    `SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?1 AND ur.is_active = 1 AND r.key != 'student'`,
  )
    .bind(userId)
    .first<{ key: string }>();
  if (staff) throw forbidden('This account has an administrative role. Manage it from Admin Management.');
}

export function registerAdminStudentRoutes(router: Router): void {
  // ---- List ----------------------------------------------------------------
  router.get('/api/admin/students', async (ctx) => {
    await requirePermission(ctx, 'students.view');
    const page = parsePage(ctx.url, { pageSize: 25, maxPageSize: 100 });
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const status = ctx.url.searchParams.get('status');
    const classId = ctx.url.searchParams.get('classId');
    const examTypeId = ctx.url.searchParams.get('examTypeId');
    const sort = ctx.url.searchParams.get('sort') ?? 'recent';

    const where: string[] = ["u.status != 'deleted'"];
    const binds: unknown[] = [];
    if (q) {
      binds.push(`%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
      where.push(`(u.email LIKE ?${binds.length} ESCAPE '\\' OR u.display_name LIKE ?${binds.length} ESCAPE '\\' OR p.full_name LIKE ?${binds.length} ESCAPE '\\')`);
    }
    if (status && ['active', 'suspended'].includes(status)) {
      binds.push(status);
      where.push(`u.status = ?${binds.length}`);
    }
    if (classId) {
      binds.push(classId);
      where.push(`p.class_id = ?${binds.length}`);
    }
    if (examTypeId) {
      binds.push(examTypeId);
      where.push(`p.target_exam_type_id = ?${binds.length}`);
    }

    const orderBy =
      sort === 'name'
        ? 'COALESCE(p.full_name, u.display_name, u.email) ASC'
        : sort === 'oldest'
          ? 'u.created_at ASC'
          : 'u.created_at DESC';

    const whereSql = where.join(' AND ');
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE ${whereSql}`,
      )
        .bind(...binds)
        .first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT u.id, u.email, u.display_name AS displayName, u.status, u.email_verified AS emailVerified,
                u.created_at AS createdAt, u.last_login_at AS lastLoginAt, u.auth_provider AS authProvider,
                p.full_name AS fullName, p.class_id AS classId, cl.name AS className,
                p.target_exam_type_id AS targetExamTypeId, et.name AS targetExamName,
                p.last_active_at AS lastActiveAt, p.streak_days AS streakDays,
                (SELECT COUNT(*) FROM exam_attempts a WHERE a.user_id = u.id) AS attemptCount,
                (SELECT COUNT(*) FROM lecture_progress lp WHERE lp.user_id = u.id AND lp.completed = 1) AS lecturesCompleted
           FROM users u
           LEFT JOIN user_profiles p ON p.user_id = u.id
           LEFT JOIN classes cl ON cl.id = p.class_id
           LEFT JOIN exam_types et ON et.id = p.target_exam_type_id
          WHERE ${whereSql}
          ORDER BY ${orderBy}
          LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    return json(
      paginated(
        (rows.results ?? []).map((r) => ({
          ...r,
          emailVerified: Boolean(r.emailVerified),
          roles: ['student'],
        })),
        Number(count?.n ?? 0),
        page,
      ),
    );
  });

  // ---- Detail --------------------------------------------------------------
  router.get('/api/admin/students/:id', async (ctx) => {
    await requirePermission(ctx, 'students.view');
    const userId = ctx.params.id;

    const [user, attempts, progress, bookmarks] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare(
        `SELECT u.id, u.email, u.display_name AS displayName, u.photo_url AS photoUrl, u.status,
                u.email_verified AS emailVerified, u.auth_provider AS authProvider, u.created_at AS createdAt,
                u.last_login_at AS lastLoginAt, p.full_name AS fullName, p.city, p.state, p.school, p.bio,
                p.class_id AS classId, cl.name AS className, p.target_exam_type_id AS targetExamTypeId,
                et.name AS targetExamName, p.onboarding_completed AS onboardingCompleted,
                p.study_goal_minutes AS studyGoalMinutes, p.streak_days AS streakDays, p.last_active_at AS lastActiveAt,
                p.notification_prefs AS notificationPrefs
           FROM users u
           LEFT JOIN user_profiles p ON p.user_id = u.id
           LEFT JOIN classes cl ON cl.id = p.class_id
           LEFT JOIN exam_types et ON et.id = p.target_exam_type_id
          WHERE u.id = ?1`,
      ).bind(userId),
      ctx.env.DB.prepare(
        `SELECT a.id AS attemptId, e.title AS examTitle, a.status, a.started_at AS startedAt, a.submitted_at AS submittedAt,
                a.score, a.percentage, r.is_published AS resultPublished
           FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
           LEFT JOIN results r ON r.attempt_id = a.id
          WHERE a.user_id = ?1 ORDER BY a.created_at DESC LIMIT 20`,
      ).bind(userId),
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS total, SUM(completed) AS completed FROM lecture_progress WHERE user_id = ?1`,
      ).bind(userId),
      ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?1').bind(userId),
    ]);

    if (!user.results?.length) throw notFound('Student not found.');
    return json({
      student: user.results[0],
      attempts: attempts.results ?? [],
      progress: progress.results?.[0] ?? { total: 0, completed: 0 },
      bookmarkCount: Number((bookmarks.results?.[0]?.n as number) ?? 0),
    });
  });

  // ---- Edit ----------------------------------------------------------------
  router.patch('/api/admin/students/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'students.edit');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const fullName = v.string('fullName', { max: 120 });
    const city = v.string('city', { max: 80 });
    const state = v.string('state', { max: 80 });
    const school = v.string('school', { max: 160 });
    const classId = v.string('classId', { max: 64 });
    const targetExamTypeId = v.string('targetExamTypeId', { max: 64 });
    const studyGoalMinutes = v.number('studyGoalMinutes', { min: 5, max: 1440, integer: true });
    v.throwIfInvalid();

    const existing = await ctx.env.DB.prepare('SELECT id FROM users WHERE id = ?1').bind(ctx.params.id).first();
    if (!existing) throw notFound('Student not found.');

    await ctx.env.DB.prepare(
      `UPDATE user_profiles SET
         full_name = COALESCE(?2, full_name), city = COALESCE(?3, city), state = COALESCE(?4, state),
         school = COALESCE(?5, school), class_id = COALESCE(?6, class_id),
         target_exam_type_id = COALESCE(?7, target_exam_type_id), study_goal_minutes = COALESCE(?8, study_goal_minutes)
       WHERE user_id = ?1`,
    )
      .bind(ctx.params.id, fullName ?? null, city ?? null, state ?? null, school ?? null, classId ?? null, targetExamTypeId ?? null, studyGoalMinutes ?? null)
      .run();

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'student.update',
      entityType: 'user',
      entityId: ctx.params.id,
      after: { fullName, city, state, school, classId, targetExamTypeId, studyGoalMinutes },
    });
    return json({ ok: true });
  });

  // ---- Suspend / reactivate ------------------------------------------------
  router.post('/api/admin/students/:id/status', async (ctx) => {
    const auth = await requirePermission(ctx, 'students.suspend');
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const status = v.enum('status', ['active', 'suspended'] as const, { required: true });
    const reason = v.string('reason', { max: 300 });
    v.throwIfInvalid();

    if (ctx.params.id === auth.user.id) throw conflict('You cannot change your own account status.');
    await assertNotStaffTarget(ctx.env, ctx.params.id);

    const target = await ctx.env.DB.prepare('SELECT id, status, email FROM users WHERE id = ?1')
      .bind(ctx.params.id)
      .first<{ id: string; status: string; email: string }>();
    if (!target) throw notFound('Student not found.');

    await ctx.env.DB.prepare('UPDATE users SET status = ?2 WHERE id = ?1').bind(target.id, status!).run();
    if (status === 'suspended') {
      await ctx.env.DB.prepare('UPDATE notification_tokens SET is_active = 0 WHERE user_id = ?1').bind(target.id).run();
    }

    await writeAudit(ctx.env, ctx.request, auth, {
      action: status === 'suspended' ? 'student.suspend' : 'student.reactivate',
      entityType: 'user',
      entityId: target.id,
      before: { status: target.status },
      after: { status },
      meta: { reason, email: target.email },
    });
    return json({ ok: true, status });
  });

  // ---- Soft delete ---------------------------------------------------------
  router.delete('/api/admin/students/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'students.delete');
    if (ctx.params.id === auth.user.id) throw conflict('You cannot delete your own account.');
    await assertNotStaffTarget(ctx.env, ctx.params.id);
    const body = await readJson(ctx.request);
    if (body.confirm !== 'DELETE') throw badRequest('Type DELETE in the confirm field to delete this account.');

    const target = await ctx.env.DB.prepare('SELECT id, email FROM users WHERE id = ?1')
      .bind(ctx.params.id)
      .first<{ id: string; email: string }>();
    if (!target) throw notFound('Student not found.');

    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE users SET status = 'deleted', email = 'deleted+' || id || '@prepsetu.invalid', display_name = NULL, photo_url = NULL WHERE id = ?1").bind(target.id),
      ctx.env.DB.prepare('UPDATE user_profiles SET full_name = NULL, city = NULL, state = NULL, school = NULL, bio = NULL, avatar_url = NULL WHERE user_id = ?1').bind(target.id),
      ctx.env.DB.prepare('UPDATE notification_tokens SET is_active = 0 WHERE user_id = ?1').bind(target.id),
    ]);

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'student.delete',
      entityType: 'user',
      entityId: target.id,
      status: 'success',
      meta: { email: target.email },
    });
    return json({ ok: true });
  });

  // ---- Export (CSV) --------------------------------------------------------
  router.get('/api/admin/students/export', async (ctx) => {
    const auth = await requirePermission(ctx, 'students.export');
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));

    const rows = await ctx.env.DB.prepare(
      `SELECT u.id, u.email, COALESCE(p.full_name, u.display_name) AS name, cl.name AS class, et.name AS target_exam,
              u.status, u.email_verified, u.created_at, p.last_active_at,
              (SELECT COUNT(*) FROM exam_attempts a WHERE a.user_id = u.id) AS attempts
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         LEFT JOIN classes cl ON cl.id = p.class_id
         LEFT JOIN exam_types et ON et.id = p.target_exam_type_id
        WHERE u.status != 'deleted' ORDER BY u.created_at DESC LIMIT 5000`,
    ).all<Record<string, unknown>>();

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'students.export',
      entityType: 'user',
      status: 'success',
      meta: { count: rows.results?.length ?? 0 },
    });

    const csv = toCsv(rows.results ?? []);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="prepsetu-students-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });

  // ---- Classes / exam types for filter dropdowns ---------------------------
  router.get('/api/admin/students/filters', async (ctx) => {
    await requirePermission(ctx, 'students.view');
    const [classes, examTypes, activeCount] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare('SELECT id, name, level FROM classes WHERE is_active = 1 ORDER BY level ASC'),
      ctx.env.DB.prepare('SELECT id, name, short_name AS shortName FROM exam_types WHERE is_active = 1 ORDER BY sort_order ASC'),
      ctx.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM user_profiles WHERE last_active_at >= ?1',
      ).bind(isoDaysAgo(7)),
    ]);
    return json({
      classes: classes.results ?? [],
      examTypes: examTypes.results ?? [],
      activeLast7Days: Number((activeCount.results?.[0]?.n as number) ?? 0),
      time: nowIso(),
    });
  });
}
