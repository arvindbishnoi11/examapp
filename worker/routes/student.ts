// =============================================================================
// Student-facing dashboard & profile extras
//  GET  /api/student/dashboard    personalised home payload
//  GET  /api/student/progress     study progress summary
//  POST /api/student/goal         update class/exam goal
// =============================================================================

import type { Router } from '../lib/router';
import { badRequest, json, readJson, Validator } from '../lib/http';
import { requireAuth } from '../services/session';
import { isoDaysAgo } from '../lib/util';

export function registerStudentRoutes(router: Router): void {
  router.get('/api/student/dashboard', async (ctx) => {
    const auth = await requireAuth(ctx);
    const now = new Date().toISOString();
    const userId = auth.user.id;

    const [profile, counters, continueWatching, upcoming, recentResults, announcements] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare(
        `SELECT p.full_name AS fullName, p.class_id AS classId, cl.name AS className,
                p.target_exam_type_id AS targetExamTypeId, et.name AS targetExamName,
                p.streak_days AS streakDays, p.study_goal_minutes AS studyGoalMinutes,
                p.onboarding_completed AS onboardingCompleted, p.avatar_url AS avatarUrl
           FROM user_profiles p
           LEFT JOIN classes cl ON cl.id = p.class_id
           LEFT JOIN exam_types et ON et.id = p.target_exam_type_id
          WHERE p.user_id = ?1`,
      ).bind(userId),
      ctx.env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM lecture_progress WHERE user_id = ?1 AND completed = 1) AS lecturesCompleted,
           (SELECT COALESCE(SUM(watched_seconds),0) FROM lecture_progress WHERE user_id = ?1) AS watchedSeconds,
           (SELECT COUNT(*) FROM exam_attempts WHERE user_id = ?1) AS attempts,
           (SELECT COUNT(*) FROM results WHERE user_id = ?1) AS results,
           (SELECT ROUND(AVG(percentage),1) FROM results WHERE user_id = ?1 AND is_published = 1) AS avgPercentage,
           (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?1) AS bookmarks`,
      ).bind(userId),
      ctx.env.DB.prepare(
        `SELECT l.id, l.title, l.thumbnail_url AS thumbnailUrl, l.duration_seconds AS durationSeconds,
                l.youtube_video_id AS youtubeVideoId, lp.percent, lp.last_position AS lastPosition
           FROM lecture_progress lp JOIN lectures l ON l.id = lp.lecture_id
          WHERE lp.user_id = ?1 AND lp.completed = 0 AND l.status = 'published'
          ORDER BY lp.updated_at DESC LIMIT 5`,
      ).bind(userId),
      ctx.env.DB.prepare(
        `SELECT e.id, e.title, e.start_at AS startAt, e.end_at AS endAt, e.duration_minutes AS durationMinutes,
                e.total_questions AS totalQuestions, et.name AS examTypeName
           FROM exams e LEFT JOIN exam_types et ON et.id = e.exam_type_id
          WHERE e.status IN ('published','scheduled') AND (e.end_at IS NULL OR e.end_at > ?1) AND e.start_at IS NOT NULL
          ORDER BY e.start_at ASC LIMIT 5`,
      ).bind(now),
      ctx.env.DB.prepare(
        `SELECT r.id, e.title AS examTitle, r.percentage, r.score, r.max_score AS maxScore, r.computed_at AS computedAt,
                r.is_published AS isPublished
           FROM results r JOIN exams e ON e.id = r.exam_id
          WHERE r.user_id = ?1 ORDER BY r.computed_at DESC LIMIT 5`,
      ).bind(userId),
      ctx.env.DB.prepare(
        `SELECT id, title, body, priority, is_pinned AS isPinned, created_at AS createdAt
           FROM announcements
          WHERE status = 'published' AND (expires_at IS NULL OR expires_at > ?1)
            AND target_audience = 'all'
          ORDER BY is_pinned DESC, created_at DESC LIMIT 3`,
      ).bind(now),
    ]);

    const profileRow = (profile.results?.[0] ?? null) as Record<string, unknown> | null;
    const counterRow = (counters.results?.[0] ?? {}) as Record<string, number>;

    return json({
      profile: profileRow
        ? {
            ...profileRow,
            onboardingCompleted: Boolean(profileRow.onboardingCompleted),
          }
        : null,
      stats: {
        lecturesCompleted: Number(counterRow.lecturesCompleted ?? 0),
        watchedMinutes: Math.round(Number(counterRow.watchedSeconds ?? 0) / 60),
        attempts: Number(counterRow.attempts ?? 0),
        results: Number(counterRow.results ?? 0),
        avgPercentage: counterRow.avgPercentage === null || counterRow.avgPercentage === undefined ? null : Number(counterRow.avgPercentage),
        bookmarks: Number(counterRow.bookmarks ?? 0),
      },
      continueWatching: continueWatching.results ?? [],
      upcomingExams: upcoming.results ?? [],
      recentResults: (recentResults.results ?? []).map((r) => ({
        ...r,
        percentage: Number(r.percentage ?? 0),
        isPublished: Boolean(r.isPublished),
      })),
      announcements: (announcements.results ?? []).map((a) => ({ ...a, isPinned: Boolean(a.isPinned) })),
    });
  });

  router.get('/api/student/progress', async (ctx) => {
    const auth = await requireAuth(ctx);
    const [weekly, subjects, streak] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare(
        `SELECT date(updated_at) AS date, COUNT(*) AS lectures, COALESCE(SUM(watched_seconds),0) AS seconds
           FROM lecture_progress WHERE user_id = ?1 AND updated_at >= ?2
          GROUP BY date(updated_at) ORDER BY date`,
      ).bind(auth.user.id, isoDaysAgo(28)),
      ctx.env.DB.prepare(
        `SELECT s.name AS subject, COUNT(lp.id) AS lectures, SUM(lp.completed) AS completed
           FROM lecture_progress lp
           JOIN lectures l ON l.id = lp.lecture_id
           LEFT JOIN subjects s ON s.id = l.subject_id
          WHERE lp.user_id = ?1 AND s.name IS NOT NULL
          GROUP BY s.name ORDER BY lectures DESC`,
      ).bind(auth.user.id),
      ctx.env.DB.prepare('SELECT streak_days AS streakDays, study_goal_minutes AS studyGoalMinutes, last_active_at AS lastActiveAt FROM user_profiles WHERE user_id = ?1')
        .bind(auth.user.id),
    ]);

    return json({
      weekly: weekly.results ?? [],
      subjects: subjects.results ?? [],
      ...(streak.results?.[0] ?? { streakDays: 0, studyGoalMinutes: 60, lastActiveAt: null }),
    });
  });

  router.post('/api/student/goal', async (ctx) => {
    const auth = await requireAuth(ctx);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const classId = v.string('classId', { max: 64 });
    const targetExamTypeId = v.string('targetExamTypeId', { max: 64 });
    v.throwIfInvalid();

    if (classId) {
      const exists = await ctx.env.DB.prepare('SELECT id FROM classes WHERE id = ?1 AND is_active = 1').bind(classId).first();
      if (!exists) throw badRequest('Unknown class.');
    }
    if (targetExamTypeId) {
      const exists = await ctx.env.DB.prepare('SELECT id FROM exam_types WHERE id = ?1 AND is_active = 1').bind(targetExamTypeId).first();
      if (!exists) throw badRequest('Unknown examination type.');
    }

    await ctx.env.DB.prepare(
      `UPDATE user_profiles SET class_id = COALESCE(?2, class_id), target_exam_type_id = COALESCE(?3, target_exam_type_id)
        WHERE user_id = ?1`,
    )
      .bind(auth.user.id, classId ?? null, targetExamTypeId ?? null)
      .run();

    return json({ ok: true });
  });
}
