// =============================================================================
// Admin: analytics & reports
// =============================================================================

import type { Router } from '../../lib/router';
import { json } from '../../lib/http';
import { requirePermission } from '../../services/session';
import { isoDaysAgo, startOfUtcDayIso } from '../../lib/util';

export function registerAdminAnalyticsRoutes(router: Router): void {
  router.get('/api/admin/analytics/overview', async (ctx) => {
    await requirePermission(ctx, 'analytics.view');
    const days = Math.min(180, Math.max(7, Number(ctx.url.searchParams.get('days') ?? 30) || 30));
    const since = isoDaysAgo(days);

    const [signups, attempts, engagement, subjectPerformance, lectureViews, completion] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare(
        `SELECT date(created_at) AS date, COUNT(*) AS signups FROM users WHERE created_at >= ?1 GROUP BY date(created_at) ORDER BY date`,
      ).bind(since),
      ctx.env.DB.prepare(
        `SELECT date(created_at) AS date, COUNT(*) AS attempts,
                ROUND(AVG(percentage), 1) AS avgPercentage
           FROM exam_attempts WHERE created_at >= ?1 GROUP BY date(created_at) ORDER BY date`,
      ).bind(since),
      ctx.env.DB.prepare(
        `SELECT
           (SELECT COUNT(DISTINCT user_id) FROM lecture_progress WHERE updated_at >= ?1) AS activeLearners,
           (SELECT COUNT(*) FROM lecture_progress WHERE updated_at >= ?1) AS lectureSessions,
           (SELECT COUNT(*) FROM exam_attempts WHERE created_at >= ?1) AS attemptCount,
           (SELECT COUNT(DISTINCT user_id) FROM exam_attempts WHERE created_at >= ?1) AS testTakers,
           (SELECT ROUND(AVG(percentage),1) FROM results WHERE computed_at >= ?1) AS avgScore`,
      ).bind(since),
      ctx.env.DB.prepare(
        `SELECT s.name AS subject, COUNT(a.id) AS attempts, ROUND(AVG(r.percentage),1) AS avgPercentage,
                ROUND(AVG(r.accuracy),1) AS avgAccuracy
           FROM results r
           JOIN exam_attempts a ON a.id = r.attempt_id
           JOIN exams e ON e.id = r.exam_id
           LEFT JOIN subjects s ON s.id = e.subject_id
          WHERE r.computed_at >= ?1 AND s.name IS NOT NULL
          GROUP BY s.name ORDER BY attempts DESC LIMIT 12`,
      ).bind(since),
      ctx.env.DB.prepare(
        `SELECT l.id, l.title, l.view_count AS views,
                (SELECT COUNT(*) FROM lecture_progress lp WHERE lp.lecture_id = l.id AND lp.updated_at >= ?1) AS recentViewers
           FROM lectures l WHERE l.status = 'published' ORDER BY l.view_count DESC LIMIT 10`,
      ).bind(since),
      ctx.env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM lecture_progress) AS totalProgress,
           (SELECT COUNT(*) FROM lecture_progress WHERE completed = 1) AS completedProgress`,
      ),
    ]);

    const completionRow = (completion.results?.[0] ?? {}) as Record<string, number>;
    const totalProgress = Number(completionRow.totalProgress ?? 0);
    const completedProgress = Number(completionRow.completedProgress ?? 0);

    return json({
      rangeDays: days,
      signupsTrend: signups.results ?? [],
      attemptsTrend: attempts.results ?? [],
      engagement: engagement.results?.[0] ?? {},
      subjectPerformance: subjectPerformance.results ?? [],
      topLectures: lectureViews.results ?? [],
      lectureCompletionRate: totalProgress ? Math.round((completedProgress / totalProgress) * 1000) / 10 : 0,
      generatedAt: new Date().toISOString(),
    });
  });

  router.get('/api/admin/analytics/exam/:id', async (ctx) => {
    await requirePermission(ctx, 'analytics.view');
    const examId = ctx.params.id;
    const [summary, distribution, hardest, easiest] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS attempts, COUNT(DISTINCT user_id) AS students,
                ROUND(AVG(percentage),1) AS avgPercentage, ROUND(MIN(percentage),1) AS minPercentage,
                ROUND(MAX(percentage),1) AS maxPercentage
           FROM results WHERE exam_id = ?1`,
      ).bind(examId),
      ctx.env.DB.prepare(
        `SELECT CASE
             WHEN percentage >= 90 THEN '90-100'
             WHEN percentage >= 75 THEN '75-89'
             WHEN percentage >= 60 THEN '60-74'
             WHEN percentage >= 40 THEN '40-59'
             WHEN percentage >= 20 THEN '20-39'
             ELSE '0-19' END AS bucket,
           COUNT(*) AS count
         FROM results WHERE exam_id = ?1 GROUP BY bucket`,
      ).bind(examId),
      ctx.env.DB.prepare(
        `SELECT q.id, substr(q.question_text, 1, 120) AS question,
                SUM(CASE WHEN aa.evaluation = 'wrong' THEN 1 ELSE 0 END) AS wrong,
                COUNT(aa.id) AS exposure
           FROM attempt_answers aa
           JOIN exam_attempts a ON a.id = aa.attempt_id
           JOIN questions q ON q.id = aa.question_id
          WHERE a.exam_id = ?1 GROUP BY q.id ORDER BY (CAST(wrong AS REAL) / MAX(exposure,1)) DESC LIMIT 8`,
      ).bind(examId),
      ctx.env.DB.prepare(
        `SELECT q.id, substr(q.question_text, 1, 120) AS question,
                SUM(CASE WHEN aa.evaluation = 'correct' THEN 1 ELSE 0 END) AS correct,
                COUNT(aa.id) AS exposure
           FROM attempt_answers aa
           JOIN exam_attempts a ON a.id = aa.attempt_id
           JOIN questions q ON q.id = aa.question_id
          WHERE a.exam_id = ?1 GROUP BY q.id ORDER BY (CAST(correct AS REAL) / MAX(exposure,1)) DESC LIMIT 8`,
      ).bind(examId),
    ]);

    return json({
      summary: summary.results?.[0] ?? {},
      distribution: distribution.results ?? [],
      hardestQuestions: hardest.results ?? [],
      easiestQuestions: easiest.results ?? [],
    });
  });

  router.get('/api/admin/analytics/students/active', async (ctx) => {
    await requirePermission(ctx, 'analytics.view');
    const days = Math.min(90, Math.max(1, Number(ctx.url.searchParams.get('days') ?? 7) || 7));
    const rows = await ctx.env.DB.prepare(
      `SELECT date(last_active_at) AS date, COUNT(*) AS activeStudents
         FROM user_profiles WHERE last_active_at >= ?1 GROUP BY date(last_active_at) ORDER BY date`,
    )
      .bind(isoDaysAgo(days))
      .all();
    return json({ rangeDays: days, trend: rows.results ?? [], today: startOfUtcDayIso() });
  });
}
