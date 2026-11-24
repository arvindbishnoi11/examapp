// =============================================================================
// Student-facing lecture routes
// =============================================================================
//  GET  /api/lectures                published lectures (filters + paging)
//  GET  /api/lectures/:id            lecture detail + adjacent lectures
//  GET  /api/lecture-series          published series
//  GET  /api/lecture-series/:id      series detail with its lectures
//  POST /api/lectures/:id/progress   upsert watch progress (authenticated)
//  GET  /api/progress/continue       "continue watching" rail
// =============================================================================

import type { Router } from '../lib/router';
import { json, notFound, parsePage, paginated, readJson } from '../lib/http';
import { cachedJson } from '../lib/cache';
import { optionalAuth, requireAuth } from '../services/session';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { likePattern, newId } from '../lib/util';

function mapLecture(row: Record<string, unknown>) {
  return {
    ...row,
    isFree: Boolean(row.isFree),
    durationSeconds: row.durationSeconds === null || row.durationSeconds === undefined ? null : Number(row.durationSeconds),
    viewCount: Number(row.viewCount ?? 0),
  };
}

export function registerLectureRoutes(router: Router): void {
  // ---- List ---------------------------------------------------------------
  router.get('/api/lectures', async (ctx) => {
    const auth = await optionalAuth(ctx);
    const page = parsePage(ctx.url, { pageSize: 24, maxPageSize: 60 });
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const courseId = ctx.url.searchParams.get('courseId');
    const subjectId = ctx.url.searchParams.get('subjectId');
    const chapterId = ctx.url.searchParams.get('chapterId');
    const seriesId = ctx.url.searchParams.get('seriesId');
    const sort = ctx.url.searchParams.get('sort') ?? 'recent';

    const where: string[] = ["l.status = 'published'"];
    const binds: unknown[] = [];
    const add = (value: unknown, clause: (i: number) => string) => {
      binds.push(value);
      where.push(clause(binds.length));
    };

    if (courseId) add(courseId, (i) => `(l.course_id = ?${i} OR EXISTS (SELECT 1 FROM lecture_courses lc WHERE lc.lecture_id = l.id AND lc.course_id = ?${i}))`);
    if (subjectId) add(subjectId, (i) => `l.subject_id = ?${i}`);
    if (chapterId) add(chapterId, (i) => `l.chapter_id = ?${i}`);
    if (seriesId) add(seriesId, (i) => `l.series_id = ?${i}`);
    if (q) add(likePattern(q), (i) => `(l.title LIKE ?${i} ESCAPE '\\' OR l.description LIKE ?${i} ESCAPE '\\')`);

    const orderBy =
      sort === 'popular' ? 'l.view_count DESC, l.created_at DESC' : sort === 'oldest' ? 'l.created_at ASC' : 'l.created_at DESC';

    const producer = async () => {
      const whereSql = where.join(' AND ');
      const [count, rows] = await Promise.all([
        ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM lectures l WHERE ${whereSql}`).bind(...binds).first<{ n: number }>(),
        ctx.env.DB.prepare(
          `SELECT l.id, l.title, l.description, l.youtube_video_id AS youtubeVideoId, l.thumbnail_url AS thumbnailUrl,
                  l.channel_name AS channelName, l.duration_seconds AS durationSeconds, l.lecture_number AS lectureNumber,
                  l.is_free AS isFree, l.view_count AS viewCount, l.published_at AS publishedAt, l.created_at AS createdAt,
                  l.series_id AS seriesId, l.course_id AS courseId,
                  c.name AS courseName, s.name AS subjectName, ch.name AS chapterName, ls.title AS seriesTitle
             FROM lectures l
             LEFT JOIN courses c ON c.id = l.course_id
             LEFT JOIN subjects s ON s.id = l.subject_id
             LEFT JOIN chapters ch ON ch.id = l.chapter_id
             LEFT JOIN lecture_series ls ON ls.id = l.series_id
             WHERE ${whereSql}
             ORDER BY ${orderBy} LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
        )
          .bind(...binds, page.pageSize, page.offset)
          .all<Record<string, unknown>>(),
      ]);
      return paginated((rows.results ?? []).map(mapLecture), Number(count?.n ?? 0), page);
    };

    if (auth || q) return json(await producer());
    return cachedJson(ctx, producer, {
      ttlSeconds: 60,
      vary: { courseId, subjectId, chapterId, seriesId, sort, page: page.page, size: page.pageSize },
    });
  });

  // ---- Continue watching ---------------------------------------------------
  router.get('/api/progress/continue', async (ctx) => {
    const auth = await requireAuth(ctx);
    const rows = await ctx.env.DB.prepare(
      `SELECT l.id, l.title, l.thumbnail_url AS thumbnailUrl, l.youtube_video_id AS youtubeVideoId,
              l.duration_seconds AS durationSeconds, lp.percent, lp.last_position AS lastPosition, lp.updated_at AS updatedAt
         FROM lecture_progress lp JOIN lectures l ON l.id = lp.lecture_id
        WHERE lp.user_id = ?1 AND lp.completed = 0 AND l.status = 'published'
        ORDER BY lp.updated_at DESC LIMIT 10`,
    )
      .bind(auth.user.id)
      .all();
    return json({ items: rows.results ?? [] });
  });

  // ---- Series --------------------------------------------------------------
  router.get('/api/lecture-series', async (ctx) => {
    const courseId = ctx.url.searchParams.get('courseId');
    const producer = async () => {
      const rows = courseId
        ? await ctx.env.DB.prepare(
            `SELECT ls.id, ls.title, ls.description, ls.thumbnail_url AS thumbnailUrl, ls.course_id AS courseId,
                    ls.lecture_count AS lectureCount, ls.total_minutes AS totalMinutes, ls.is_free AS isFree,
                    c.name AS courseName, ch.name AS chapterName
               FROM lecture_series ls LEFT JOIN courses c ON c.id = ls.course_id LEFT JOIN chapters ch ON ch.id = ls.chapter_id
              WHERE ls.status = 'published' AND ls.course_id = ?1 ORDER BY ls.sort_order ASC LIMIT 100`,
          )
            .bind(courseId)
            .all<Record<string, unknown>>()
        : await ctx.env.DB.prepare(
            `SELECT ls.id, ls.title, ls.description, ls.thumbnail_url AS thumbnailUrl, ls.course_id AS courseId,
                    ls.lecture_count AS lectureCount, ls.total_minutes AS totalMinutes, ls.is_free AS isFree,
                    c.name AS courseName, ch.name AS chapterName
               FROM lecture_series ls LEFT JOIN courses c ON c.id = ls.course_id LEFT JOIN chapters ch ON ch.id = ls.chapter_id
              WHERE ls.status = 'published' ORDER BY ls.sort_order ASC, ls.created_at DESC LIMIT 100`,
          ).all<Record<string, unknown>>();
      return { items: (rows.results ?? []).map((r) => ({ ...r, isFree: Boolean(r.isFree) })) };
    };
    return cachedJson(ctx, producer, { ttlSeconds: 120, vary: { courseId } });
  });

  router.get('/api/lecture-series/:id', async (ctx) => {
    const series = await ctx.env.DB.prepare(
      `SELECT ls.id, ls.title, ls.description, ls.thumbnail_url AS thumbnailUrl, ls.course_id AS courseId,
              ls.chapter_id AS chapterId, ls.lecture_count AS lectureCount, ls.total_minutes AS totalMinutes,
              ls.is_free AS isFree, c.name AS courseName, ch.name AS chapterName
         FROM lecture_series ls LEFT JOIN courses c ON c.id = ls.course_id LEFT JOIN chapters ch ON ch.id = ls.chapter_id
        WHERE ls.id = ?1 AND ls.status = 'published'`,
    )
      .bind(ctx.params.id)
      .first<Record<string, unknown>>();
    if (!series) throw notFound('Lecture series not found.');

    const lectures = await ctx.env.DB.prepare(
      `SELECT id, title, description, youtube_video_id AS youtubeVideoId, thumbnail_url AS thumbnailUrl,
              duration_seconds AS durationSeconds, lecture_number AS lectureNumber, is_free AS isFree, view_count AS viewCount
         FROM lectures WHERE series_id = ?1 AND status = 'published'
        ORDER BY COALESCE(lecture_number, 9999) ASC, sort_order ASC, created_at ASC`,
    )
      .bind(series.id)
      .all<Record<string, unknown>>();

    return json({
      series: { ...series, isFree: Boolean(series.isFree) },
      lectures: (lectures.results ?? []).map(mapLecture),
    });
  });

  // ---- Detail --------------------------------------------------------------
  router.get('/api/lectures/:id', async (ctx) => {
    const auth = await optionalAuth(ctx);
    const lecture = await ctx.env.DB.prepare(
      `SELECT l.id, l.title, l.description, l.youtube_video_id AS youtubeVideoId, l.youtube_url AS youtubeUrl,
              l.thumbnail_url AS thumbnailUrl, l.channel_name AS channelName, l.duration_seconds AS durationSeconds,
              l.lecture_number AS lectureNumber, l.is_free AS isFree, l.visibility, l.view_count AS viewCount,
              l.published_at AS publishedAt, l.created_at AS createdAt, l.language, l.tags,
              l.series_id AS seriesId, l.course_id AS courseId, l.subject_id AS subjectId, l.chapter_id AS chapterId,
              c.name AS courseName, s.name AS subjectName, ch.name AS chapterName, ls.title AS seriesTitle
         FROM lectures l
         LEFT JOIN courses c ON c.id = l.course_id
         LEFT JOIN subjects s ON s.id = l.subject_id
         LEFT JOIN chapters ch ON ch.id = l.chapter_id
         LEFT JOIN lecture_series ls ON ls.id = l.series_id
        WHERE l.id = ?1 AND l.status = 'published'`,
    )
      .bind(ctx.params.id)
      .first<Record<string, unknown>>();
    if (!lecture) throw notFound('Lecture not found.');

    const [siblings, progress, bookmark] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare(
        `SELECT id, title, lecture_number AS lectureNumber FROM lectures
          WHERE series_id = ?1 AND status = 'published' ORDER BY COALESCE(lecture_number, 9999), sort_order, created_at`,
      ).bind(lecture.seriesId ?? ''),
      auth
        ? ctx.env.DB.prepare('SELECT percent, last_position AS lastPosition, completed FROM lecture_progress WHERE user_id = ?1 AND lecture_id = ?2')
            .bind(auth.user.id, lecture.id)
        : ctx.env.DB.prepare('SELECT 0 AS percent, 0 AS lastPosition, 0 AS completed WHERE 0'),
      auth
        ? ctx.env.DB.prepare("SELECT 1 AS n FROM bookmarks WHERE user_id = ?1 AND item_type = 'lecture' AND item_id = ?2")
            .bind(auth.user.id, lecture.id)
        : ctx.env.DB.prepare('SELECT 0 AS n WHERE 0'),
    ]);

    const list = siblings.results ?? [];
    const index = list.findIndex((s) => s.id === lecture.id);

    // Fire-and-forget view counter (deduplicated per isolate is overkill; a
    // simple increment is accurate enough and avoids a write on every render).
    ctx.ctx.waitUntil(
      ctx.env.DB.prepare('UPDATE lectures SET view_count = view_count + 1 WHERE id = ?1').bind(lecture.id).run().catch(() => undefined),
    );

    return json({
      lecture: mapLecture(lecture),
      previous: index > 0 ? list[index - 1] : null,
      next: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
      progress: progress.results?.[0] ?? { percent: 0, lastPosition: 0, completed: 0 },
      bookmarked: Boolean(bookmark.results?.length),
    });
  });

  // ---- Progress upsert -----------------------------------------------------
  router.post('/api/lectures/:id/progress', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));
    const body = await readJson(ctx.request);

    const lecture = await ctx.env.DB.prepare(
      "SELECT id, duration_seconds FROM lectures WHERE id = ?1 AND status = 'published'",
    )
      .bind(ctx.params.id)
      .first<{ id: string; duration_seconds: number | null }>();
    if (!lecture) throw notFound('Lecture not found.');

    const watched = Math.max(0, Math.min(86400, Math.round(Number(body.watchedSeconds ?? body.lastPosition ?? 0) || 0)));
    const duration = Math.max(1, Number(lecture.duration_seconds ?? body.durationSeconds ?? 0) || 1);
    const percent = Math.max(0, Math.min(100, Math.round((watched / duration) * 1000) / 10));
    const completed = percent >= 92 || body.completed === true ? 1 : 0;

    await ctx.env.DB.prepare(
      `INSERT INTO lecture_progress (id, user_id, lecture_id, watched_seconds, duration_seconds, percent, last_position, completed, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(user_id, lecture_id) DO UPDATE SET
         watched_seconds = MAX(lecture_progress.watched_seconds, excluded.watched_seconds),
         last_position = excluded.last_position,
         percent = MAX(lecture_progress.percent, excluded.percent),
         completed = MAX(lecture_progress.completed, excluded.completed),
         updated_at = excluded.updated_at`,
    )
      .bind(newId(), auth.user.id, lecture.id, watched, duration, percent, watched, completed, new Date().toISOString())
      .run();

    if (completed) {
      ctx.ctx.waitUntil(
        ctx.env.DB.prepare(
          `UPDATE user_profiles SET streak_days = CASE
             WHEN last_active_at IS NULL THEN 1
             WHEN date(last_active_at) = date('now','-1 day') THEN streak_days + 1
             WHEN date(last_active_at) = date('now') THEN streak_days
             ELSE 1 END,
             last_active_at = ?2 WHERE user_id = ?1`,
        )
          .bind(auth.user.id, new Date().toISOString())
          .run()
          .catch(() => undefined),
      );
    }

    return json({ percent, completed: Boolean(completed) });
  });
}
