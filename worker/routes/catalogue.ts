// =============================================================================
// Public catalogue: classes, exam types, courses, subjects, chapters, search
// =============================================================================
// All routes here are anonymous-safe and cacheable. Nothing personal is read.
// Course visibility rules:
//   * courses.status = 'published' only
//   * course must be public, or the caller must supply a valid session
// =============================================================================

import type { RouteCtx } from '../env';
import type { Router } from '../lib/router';
import { json, notFound, parsePage, paginated } from '../lib/http';
import { cachedJson } from '../lib/cache';
import { optionalAuth } from '../services/session';

const COURSE_SELECT = `
  SELECT c.id, c.name, c.slug, c.description, c.short_description AS shortDescription,
         c.cover_image_url AS coverImageUrl, c.thumbnail_url AS thumbnailUrl,
         c.class_id AS classId, c.exam_type_id AS examTypeId, c.tags,
         c.is_free AS isFree, c.is_featured AS isFeatured, c.status, c.difficulty,
         c.sort_order AS sortOrder, c.created_at AS createdAt,
         cl.name AS className, et.name AS examTypeName,
         (SELECT COUNT(*) FROM subjects s WHERE s.course_id = c.id AND s.is_active = 1) AS subjectCount,
         (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id AND l.status = 'published') AS lectureCount,
         (SELECT COUNT(*) FROM exams e WHERE e.course_id = c.id AND e.status IN ('published','scheduled')) AS examCount
    FROM courses c
    LEFT JOIN classes cl ON cl.id = c.class_id
    LEFT JOIN exam_types et ON et.id = c.exam_type_id
`;

function normaliseCourse(row: Record<string, unknown>) {
  return {
    ...row,
    isFree: Boolean(row.isFree),
    isFeatured: Boolean(row.isFeatured),
    tags: row.tags ? String(row.tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
    subjectCount: Number(row.subjectCount ?? 0),
    lectureCount: Number(row.lectureCount ?? 0),
    examCount: Number(row.examCount ?? 0),
  };
}

export function registerCatalogueRoutes(router: Router): void {
  // ---- Taxonomy ------------------------------------------------------------
  router.get('/api/classes', async (ctx) =>
    cachedJson(
      ctx,
      async () => {
        const rows = await ctx.env.DB.prepare(
          `SELECT id, name, slug, level, description, color, icon, sort_order AS sortOrder
             FROM classes WHERE is_active = 1 ORDER BY level ASC, sort_order ASC`,
        ).all();
        return { items: rows.results ?? [] };
      },
      { ttlSeconds: 300, vary: { v: 2 } },
    ),
  );

  router.get('/api/exam-types', async (ctx) =>
    cachedJson(
      ctx,
      async () => {
        const rows = await ctx.env.DB.prepare(
          `SELECT id, name, slug, short_name AS shortName, description, color, icon, sort_order AS sortOrder
             FROM exam_types WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`,
        ).all();
        return { items: rows.results ?? [] };
      },
      { ttlSeconds: 300, vary: { v: 2 } },
    ),
  );

  // ---- Courses -------------------------------------------------------------
  router.get('/api/courses', async (ctx) => {
    const auth = await optionalAuth(ctx);
    const page = parsePage(ctx.url, { pageSize: 24, maxPageSize: 60 });
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const classId = ctx.url.searchParams.get('classId');
    const examTypeId = ctx.url.searchParams.get('examTypeId');
    const featured = ctx.url.searchParams.get('featured') === 'true';
    const free = ctx.url.searchParams.get('free') === 'true';

    const where: string[] = ["c.status = 'published'"];
    const binds: unknown[] = [];
    if (!auth) where.push("c.visibility = 'public'");
    if (classId) {
      binds.push(classId);
      where.push(`c.class_id = ?${binds.length}`);
    }
    if (examTypeId) {
      binds.push(examTypeId);
      where.push(`c.exam_type_id = ?${binds.length}`);
    }
    if (featured) where.push('c.is_featured = 1');
    if (free) where.push('c.is_free = 1');
    if (q) {
      binds.push(`%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
      where.push(`(c.name LIKE ?${binds.length} ESCAPE '\\' OR c.description LIKE ?${binds.length} ESCAPE '\\' OR c.tags LIKE ?${binds.length} ESCAPE '\\')`);
    }

    const producer = async () => {
      const whereSql = where.join(' AND ');
      const [countRow, rows] = await Promise.all([
        ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM courses c WHERE ${whereSql}`).bind(...binds).first<{ n: number }>(),
        ctx.env.DB.prepare(
          `${COURSE_SELECT} WHERE ${whereSql} ORDER BY c.is_featured DESC, c.sort_order ASC, c.created_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
        )
          .bind(...binds, page.pageSize, page.offset)
          .all<Record<string, unknown>>(),
      ]);
      return paginated((rows.results ?? []).map(normaliseCourse), Number(countRow?.n ?? 0), page);
    };

    if (auth || q) return json(await producer());
    return cachedJson(ctx, producer, { ttlSeconds: 60, vary: { classId, examTypeId, featured, free, page: page.page, size: page.pageSize } });
  });

  router.get('/api/courses/:id', async (ctx) => {
    const auth = await optionalAuth(ctx);
    const idParam = ctx.params.id;

    const producer = async () => {
      const course =
        (await ctx.env.DB.prepare(`${COURSE_SELECT} WHERE c.id = ?1 AND c.status = 'published'`).bind(idParam).first<Record<string, unknown>>()) ??
        (await ctx.env.DB.prepare(`${COURSE_SELECT} WHERE c.slug = ?1 AND c.status = 'published'`).bind(idParam).first<Record<string, unknown>>());
      if (!course) throw notFound('Course not found.');

      const courseId = String(course.id);
      const [subjects, series, exams, announcements] = await ctx.env.DB.batch([
        ctx.env.DB.prepare(
          `SELECT s.id, s.name, s.slug, s.color, s.icon, s.sort_order AS sortOrder,
                  (SELECT COUNT(*) FROM chapters ch WHERE ch.subject_id = s.id AND ch.is_active = 1) AS chapterCount,
                  (SELECT COUNT(*) FROM lectures l WHERE l.subject_id = s.id AND l.status = 'published') AS lectureCount
             FROM subjects s WHERE s.course_id = ?1 AND s.is_active = 1 ORDER BY s.sort_order ASC, s.name ASC`,
        ).bind(courseId),
        ctx.env.DB.prepare(
          `SELECT ls.id, ls.title, ls.description, ls.thumbnail_url AS thumbnailUrl, ls.lecture_count AS lectureCount,
                  ls.total_minutes AS totalMinutes, ls.is_free AS isFree, ch.name AS chapterName
             FROM lecture_series ls LEFT JOIN chapters ch ON ch.id = ls.chapter_id
            WHERE ls.course_id = ?1 AND ls.status = 'published' ORDER BY ls.sort_order ASC LIMIT 30`,
        ).bind(courseId),
        ctx.env.DB.prepare(
          `SELECT e.id, e.title, e.description, e.exam_kind AS examKind, e.duration_minutes AS durationMinutes,
                  e.total_marks AS totalMarks, e.total_questions AS totalQuestions, e.status, e.start_at AS startAt,
                  e.end_at AS endAt, e.is_free AS isFree, et.name AS examTypeName
             FROM exams e LEFT JOIN exam_types et ON et.id = e.exam_type_id
            WHERE e.course_id = ?1 AND e.status IN ('published','scheduled')
            ORDER BY e.created_at DESC LIMIT 20`,
        ).bind(courseId),
        ctx.env.DB.prepare(
          `SELECT id, title, body, image_url AS imageUrl, priority, is_pinned AS isPinned, publish_at AS publishAt, created_at AS createdAt
             FROM announcements
            WHERE status = 'published' AND (expires_at IS NULL OR expires_at > ?1)
              AND (target_audience = 'all' OR course_id = ?2)
            ORDER BY is_pinned DESC, COALESCE(publish_at, created_at) DESC LIMIT 5`,
        ).bind(new Date().toISOString(), courseId),
      ]);

      return {
        course: normaliseCourse(course),
        subjects: subjects.results ?? [],
        lectureSeries: (series.results ?? []).map((r) => ({ ...(r as Record<string, unknown>), isFree: Boolean((r as { isFree: number }).isFree) })),
        exams: (exams.results ?? []).map((r) => ({ ...(r as Record<string, unknown>), isFree: Boolean((r as { isFree: number }).isFree) })),
        announcements: (announcements.results ?? []).map((r) => ({ ...(r as Record<string, unknown>), isPinned: Boolean((r as { isPinned: number }).isPinned) })),
      };
    };

    if (auth) return json(await producer());
    return cachedJson(ctx, producer, { ttlSeconds: 120, vary: { id: idParam } });
  });

  // ---- Subjects & chapters -------------------------------------------------
  router.get('/api/courses/:id/subjects', async (ctx) =>
    cachedJson(
      ctx,
      async () => {
        const rows = await ctx.env.DB.prepare(
          `SELECT s.id, s.course_id AS courseId, s.name, s.slug, s.description, s.color, s.icon,
                  s.sort_order AS sortOrder,
                  (SELECT COUNT(*) FROM chapters ch WHERE ch.subject_id = s.id AND ch.is_active = 1) AS chapterCount
             FROM subjects s WHERE s.course_id = ?1 AND s.is_active = 1 ORDER BY s.sort_order ASC, s.name ASC`,
        )
          .bind(ctx.params.id)
          .all();
        return { items: rows.results ?? [] };
      },
      { ttlSeconds: 180, vary: { course: ctx.params.id } },
    ),
  );

  router.get('/api/subjects', async (ctx) =>
    cachedJson(
      ctx,
      async () => {
        const courseId = ctx.url.searchParams.get('courseId');
        const rows = courseId
          ? await ctx.env.DB.prepare(
              `SELECT id, course_id AS courseId, name, slug, color, icon FROM subjects WHERE course_id = ?1 AND is_active = 1 ORDER BY sort_order ASC`,
            )
              .bind(courseId)
              .all()
          : await ctx.env.DB.prepare(
              `SELECT id, course_id AS courseId, name, slug, color, icon FROM subjects WHERE is_active = 1 ORDER BY sort_order ASC LIMIT 500`,
            ).all();
        return { items: rows.results ?? [] };
      },
      { ttlSeconds: 180, vary: { course: ctx.url.searchParams.get('courseId') } },
    ),
  );

  router.get('/api/chapters', async (ctx) =>
    cachedJson(
      ctx,
      async () => {
        const subjectId = ctx.url.searchParams.get('subjectId');
        const courseId = ctx.url.searchParams.get('courseId');
        if (!subjectId && !courseId) return { items: [] };

        const where = subjectId ? 'subject_id = ?1' : 'course_id = ?1';
        const rows = await ctx.env.DB.prepare(
          `SELECT id, subject_id AS subjectId, course_id AS courseId, name, slug, sort_order AS sortOrder,
                  (SELECT COUNT(*) FROM lectures l WHERE l.chapter_id = chapters.id AND l.status = 'published') AS lectureCount,
                  (SELECT COUNT(*) FROM exams e WHERE e.chapter_id = chapters.id AND e.status = 'published') AS examCount
             FROM chapters WHERE ${where} AND is_active = 1 ORDER BY sort_order ASC, name ASC`,
        )
          .bind(subjectId ?? courseId)
          .all();
        return { items: rows.results ?? [] };
      },
      { ttlSeconds: 180, vary: { subject: ctx.url.searchParams.get('subjectId'), course: ctx.url.searchParams.get('courseId') } },
    ),
  );

  // ---- Global search (courses, lectures, exams) ----------------------------
  router.get('/api/search', async (ctx) => {
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return json({ courses: [], lectures: [], exams: [], papers: [] });
    const pattern = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

    const [courses, lectures, exams, papers] = await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `${COURSE_SELECT} WHERE c.status = 'published' AND c.visibility = 'public'
           AND (c.name LIKE ?1 ESCAPE '\\' OR c.tags LIKE ?1 ESCAPE '\\')
         ORDER BY c.is_featured DESC LIMIT 6`,
      ).bind(pattern),
      ctx.env.DB.prepare(
        `SELECT l.id, l.title, l.thumbnail_url AS thumbnailUrl, l.duration_seconds AS durationSeconds, l.youtube_video_id AS youtubeVideoId,
                c.name AS courseName, s.name AS subjectName
           FROM lectures l LEFT JOIN courses c ON c.id = l.course_id LEFT JOIN subjects s ON s.id = l.subject_id
          WHERE l.status = 'published' AND (l.title LIKE ?1 ESCAPE '\\' OR l.description LIKE ?1 ESCAPE '\\')
          ORDER BY l.view_count DESC LIMIT 8`,
      ).bind(pattern),
      ctx.env.DB.prepare(
        `SELECT e.id, e.title, e.exam_kind AS examKind, e.duration_minutes AS durationMinutes, e.total_questions AS totalQuestions
           FROM exams e WHERE e.status IN ('published','scheduled') AND e.title LIKE ?1 ESCAPE '\\' LIMIT 6`,
      ).bind(pattern),
      ctx.env.DB.prepare(
        `SELECT id, title, year FROM test_papers WHERE status = 'published' AND visibility = 'public' AND title LIKE ?1 ESCAPE '\\' LIMIT 5`,
      ).bind(pattern),
    ]);

    return json({
      courses: (courses.results ?? []).map((r) => normaliseCourse(r as Record<string, unknown>)),
      lectures: lectures.results ?? [],
      exams: exams.results ?? [],
      papers: papers.results ?? [],
      query: q,
    });
  });

  // ---- Announcements feed --------------------------------------------------
  router.get('/api/announcements', async (ctx) => {
    const auth = await optionalAuth(ctx);
    const now = new Date().toISOString();
    const page = parsePage(ctx.url, { pageSize: 20 });

    const producer = async () => {
      let classId: string | null = null;
      let examTypeId: string | null = null;
      if (auth?.profile) {
        classId = (auth.profile.classId as string) ?? null;
        examTypeId = (auth.profile.targetExamTypeId as string) ?? null;
      }

      const rows = await ctx.env.DB.prepare(
        `SELECT a.id, a.title, a.body, a.image_url AS imageUrl, a.link_url AS linkUrl, a.priority,
                a.is_pinned AS isPinned, a.publish_at AS publishAt, a.expires_at AS expiresAt, a.created_at AS createdAt,
                a.target_audience AS targetAudience
           FROM announcements a
          WHERE a.status = 'published'
            AND (a.publish_at IS NULL OR a.publish_at <= ?1)
            AND (a.expires_at IS NULL OR a.expires_at > ?1)
            AND (a.target_audience = 'all'
                 OR (a.target_audience = 'class' AND a.class_id = ?2)
                 OR (a.target_audience = 'exam_type' AND a.exam_type_id = ?3)
                 OR (a.target_audience = 'course'))
          ORDER BY a.is_pinned DESC, COALESCE(a.publish_at, a.created_at) DESC
          LIMIT ?4 OFFSET ?5`,
      )
        .bind(now, classId, examTypeId, page.pageSize, page.offset)
        .all<Record<string, unknown>>();

      return {
        items: (rows.results ?? []).map((r) => ({ ...r, isPinned: Boolean(r.isPinned) })),
        page: page.page,
      };
    };

    if (auth) return json(await producer());
    return cachedJson(ctx, producer, { ttlSeconds: 60 });
  });

  // ---- Home feed (single round-trip for the student home screen) -----------
  router.get('/api/home', async (ctx) => {
    const auth = await optionalAuth(ctx);
    const now = new Date().toISOString();

    const [classes, examTypes, featured, latestLectures, upcoming, popularExams, announcements, series] = await ctx.env.DB.batch([
      ctx.env.DB.prepare(`SELECT id, name, slug, level, color FROM classes WHERE is_active = 1 ORDER BY level ASC, sort_order ASC`),
      ctx.env.DB.prepare(`SELECT id, name, slug, short_name AS shortName, color FROM exam_types WHERE is_active = 1 ORDER BY sort_order ASC`),
      ctx.env.DB.prepare(
        `${COURSE_SELECT} WHERE c.status = 'published' AND c.visibility = 'public' AND c.is_featured = 1
         ORDER BY c.sort_order ASC LIMIT 8`,
      ),
      ctx.env.DB.prepare(
        `SELECT l.id, l.title, l.youtube_video_id AS youtubeVideoId, l.thumbnail_url AS thumbnailUrl,
                l.duration_seconds AS durationSeconds, l.chapter_id AS chapterId, c.name AS courseName
           FROM lectures l LEFT JOIN courses c ON c.id = l.course_id
          WHERE l.status = 'published' ORDER BY l.created_at DESC LIMIT 8`,
      ),
      ctx.env.DB.prepare(
        `SELECT e.id, e.title, e.exam_kind AS examKind, e.start_at AS startAt, e.end_at AS endAt,
                e.duration_minutes AS durationMinutes, e.total_questions AS totalQuestions, et.name AS examTypeName
           FROM exams e LEFT JOIN exam_types et ON et.id = e.exam_type_id
          WHERE e.status IN ('published','scheduled') AND (e.end_at IS NULL OR e.end_at > ?1)
          ORDER BY COALESCE(e.start_at, e.created_at) ASC LIMIT 6`,
      ).bind(now),
      ctx.env.DB.prepare(
        `SELECT e.id, e.title, e.exam_kind AS examKind, e.duration_minutes AS durationMinutes,
                e.total_questions AS totalQuestions, e.total_marks AS totalMarks,
                (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id) AS attemptCount
           FROM exams e WHERE e.status = 'published'
          ORDER BY attemptCount DESC LIMIT 6`,
      ),
      ctx.env.DB.prepare(
        `SELECT id, title, body, priority, is_pinned AS isPinned, publish_at AS publishAt, created_at AS createdAt, image_url AS imageUrl
           FROM announcements
          WHERE status = 'published' AND (publish_at IS NULL OR publish_at <= ?1)
            AND (expires_at IS NULL OR expires_at > ?1) AND target_audience = 'all'
          ORDER BY is_pinned DESC, COALESCE(publish_at, created_at) DESC LIMIT 4`,
      ).bind(now),
      ctx.env.DB.prepare(
        `SELECT id, title, thumbnail_url AS thumbnailUrl, lecture_count AS lectureCount, total_minutes AS totalMinutes
           FROM lecture_series WHERE status = 'published' ORDER BY created_at DESC LIMIT 6`,
      ),
    ]);

    let continueLearning: unknown[] = [];
    let stats: Record<string, unknown> | null = null;

    if (auth) {
      const [progress, counters] = await ctx.env.DB.batch([
        ctx.env.DB.prepare(
          `SELECT lp.lecture_id AS lectureId, lp.percent, lp.last_position AS lastPosition, lp.updated_at AS updatedAt,
                  l.title, l.thumbnail_url AS thumbnailUrl, l.duration_seconds AS durationSeconds, l.youtube_video_id AS youtubeVideoId
             FROM lecture_progress lp JOIN lectures l ON l.id = lp.lecture_id
            WHERE lp.user_id = ?1 AND lp.completed = 0 AND l.status = 'published'
            ORDER BY lp.updated_at DESC LIMIT 6`,
        ).bind(auth.user.id),
        ctx.env.DB.prepare(
          `SELECT
             (SELECT COUNT(*) FROM lecture_progress WHERE user_id = ?1 AND completed = 1) AS lecturesCompleted,
             (SELECT COUNT(*) FROM exam_attempts WHERE user_id = ?1 AND status IN ('submitted','auto_submitted','evaluated')) AS examsTaken,
             (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?1) AS bookmarks`,
        ).bind(auth.user.id),
      ]);
      continueLearning = progress.results ?? [];
      stats = (counters.results?.[0] as Record<string, unknown>) ?? null;
    }

    return json({
      classes: classes.results ?? [],
      examTypes: examTypes.results ?? [],
      featuredCourses: (featured.results ?? []).map((r) => normaliseCourse(r as Record<string, unknown>)),
      latestLectures: latestLectures.results ?? [],
      upcomingExams: upcoming.results ?? [],
      popularExams: popularExams.results ?? [],
      announcements: (announcements.results ?? []).map((r) => ({ ...(r as Record<string, unknown>), isPinned: Boolean((r as { isPinned: number }).isPinned) })),
      latestSeries: series.results ?? [],
      continueLearning,
      stats,
      signedIn: Boolean(auth),
      serverTime: now,
    });
  });
}
