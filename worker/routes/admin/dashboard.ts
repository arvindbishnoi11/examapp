// =============================================================================
// Admin dashboard: aggregate statistics, trends and activity
// =============================================================================

import type { Router } from '../../lib/router';
import { json, parsePage, paginated } from '../../lib/http';
import { requirePermission } from '../../services/session';
import { isoDaysAgo, startOfUtcDayIso } from '../../lib/util';

export function registerAdminDashboardRoutes(router: Router): void {
  router.get('/api/admin/dashboard', async (ctx) => {
    await requirePermission(ctx, 'dashboard.view');
    return json(await buildDashboard(ctx.env));
  });

  // Recent activity feed (paginated, used by the dashboard "View all" link).
  router.get('/api/admin/activity', async (ctx) => {
    await requirePermission(ctx, 'dashboard.view');
    const page = parsePage(ctx.url, { pageSize: 30 });
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM audit_logs').first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT id, action, actor_email AS actorEmail, actor_id AS actorId, entity_type AS entityType,
                entity_id AS entityId, status, created_at AS createdAt
           FROM audit_logs ORDER BY created_at DESC LIMIT ?1 OFFSET ?2`,
      )
        .bind(page.pageSize, page.offset)
        .all(),
    ]);
    return json(paginated(rows.results ?? [], Number(count?.n ?? 0), page));
  });
}

export async function buildDashboard(env: { DB: D1Database }) {
  const sevenDaysAgo = isoDaysAgo(7);
  const thirtyDaysAgo = isoDaysAgo(30);
  const today = startOfUtcDayIso();

  const [
    users,
    content,
    examsAgg,
    attempts,
    registrationsTrend,
    attemptsTrend,
    recentActivity,
    popularLectures,
    mostAttempted,
    performance,
    pendingSyncs,
    testPapers,
  ] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE status IN ('active','suspended')) AS totalStudents,
         (SELECT COUNT(*) FROM user_profiles WHERE last_active_at >= ?1) AS activeStudents,
         (SELECT COUNT(*) FROM users WHERE created_at >= ?2) AS newRegistrations,
         (SELECT COUNT(*) FROM users WHERE created_at >= ?3) AS last30,
         (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended,
         (SELECT COUNT(DISTINCT user_id) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            WHERE ur.is_active = 1 AND r.key != 'student') AS staffCount`,
    ).bind(sevenDaysAgo, sevenDaysAgo, thirtyDaysAgo),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM courses WHERE status = 'published') AS totalCourses,
         (SELECT COUNT(*) FROM courses) AS allCourses,
         (SELECT COUNT(*) FROM lectures WHERE status = 'published') AS totalLectures,
         (SELECT COUNT(*) FROM lectures) AS allLectures,
         (SELECT COUNT(*) FROM subjects) AS totalSubjects,
         (SELECT COUNT(*) FROM chapters) AS totalChapters,
         (SELECT COUNT(*) FROM lecture_series WHERE status = 'published') AS totalSeries`,
    ),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM exams WHERE status IN ('published','scheduled')) AS totalExams,
         (SELECT COUNT(*) FROM exams) AS allExams,
         (SELECT COUNT(*) FROM exams WHERE start_at >= ?1) AS upcomingExams`,
    ).bind(today),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM questions) AS totalQuestions,
         (SELECT COUNT(*) FROM exam_attempts) AS totalAttempts,
         (SELECT COUNT(*) FROM exam_attempts WHERE status = 'in_progress') AS inProgressAttempts,
         (SELECT COUNT(*) FROM results) AS totalResults`,
    ),
    env.DB.prepare(
      `SELECT date(created_at) AS date, COUNT(*) AS count FROM users
        WHERE created_at >= ?1 GROUP BY date(created_at) ORDER BY date ASC`,
    ).bind(thirtyDaysAgo),
    env.DB.prepare(
      `SELECT date(created_at) AS date, COUNT(*) AS count FROM exam_attempts
        WHERE created_at >= ?1 GROUP BY date(created_at) ORDER BY date ASC`,
    ).bind(thirtyDaysAgo),
    env.DB.prepare(
      `SELECT id, action, actor_email AS actorEmail, entity_type AS entityType, created_at AS createdAt, status
         FROM audit_logs ORDER BY created_at DESC LIMIT 12`,
    ),
    env.DB.prepare(
      `SELECT id, title, view_count AS viewCount, thumbnail_url AS thumbnailUrl FROM lectures
        WHERE status = 'published' ORDER BY view_count DESC LIMIT 6`,
    ),
    env.DB.prepare(
      `SELECT e.id, e.title, e.total_questions AS totalQuestions,
              (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id) AS attempts
         FROM exams e ORDER BY attempts DESC LIMIT 6`,
    ),
    env.DB.prepare(
      `SELECT e.title AS examTitle, ROUND(AVG(r.percentage), 1) AS avgScore, ROUND(AVG(r.max_score), 1) AS maxScore,
              COUNT(r.id) AS attempts
         FROM results r JOIN exams e ON e.id = r.exam_id
        GROUP BY e.id HAVING attempts >= 1 ORDER BY attempts DESC LIMIT 6`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sync_logs WHERE status IN ('failed','partial') AND started_at >= ?1`,
    ).bind(sevenDaysAgo),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM test_papers WHERE status = 'published'`),
  ]);

  const usersRow = (users.results?.[0] ?? {}) as Record<string, number>;
  const contentRow = (content.results?.[0] ?? {}) as Record<string, number>;
  const examsRow = (examsAgg.results?.[0] ?? {}) as Record<string, number>;
  const attemptsRow = (attempts.results?.[0] ?? {}) as Record<string, number>;
  const syncRow = (pendingSyncs.results?.[0] ?? {}) as Record<string, number>;
  const papersRow = (testPapers.results?.[0] ?? {}) as Record<string, number>;

  return {
    totalStudents: Number(usersRow.totalStudents ?? 0),
    activeStudents: Number(usersRow.activeStudents ?? 0),
    newRegistrations: Number(usersRow.newRegistrations ?? 0),
    suspendedStudents: Number(usersRow.suspended ?? 0),
    staffCount: Number(usersRow.staffCount ?? 0),
    totalCourses: Number(contentRow.totalCourses ?? 0),
    allCourses: Number(contentRow.allCourses ?? 0),
    totalLectures: Number(contentRow.totalLectures ?? 0),
    allLectures: Number(contentRow.allLectures ?? 0),
    totalSubjects: Number(contentRow.totalSubjects ?? 0),
    totalChapters: Number(contentRow.totalChapters ?? 0),
    totalSeries: Number(contentRow.totalSeries ?? 0),
    totalExams: Number(examsRow.totalExams ?? 0),
    totalQuestions: Number(attemptsRow.totalQuestions ?? 0),
    totalAttempts: Number(attemptsRow.totalAttempts ?? 0),
    inProgressAttempts: Number(attemptsRow.inProgressAttempts ?? 0),
    totalResults: Number(attemptsRow.totalResults ?? 0),
    totalTestPapers: Number(papersRow.n ?? 0),
    pendingSyncs: Number(syncRow.n ?? 0),
    recentActivities: recentActivity.results ?? [],
    popularLectures: popularLectures.results ?? [],
    mostAttemptedExams: mostAttempted.results ?? [],
    performanceOverview: performance.results ?? [],
    registrationsTrend: registrationsTrend.results ?? [],
    attemptsTrend: attemptsTrend.results ?? [],
  };
}
