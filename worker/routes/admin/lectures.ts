// =============================================================================
// Admin: lectures & lecture series (full CRUD, publish workflow, YouTube)
// =============================================================================

import type { Router } from '../../lib/router';
import {
  badRequest,
  conflict,
  json,
  notFound,
  parsePage,
  paginated,
  readJson,
  Validator,
} from '../../lib/http';
import { requirePermission } from '../../services/session';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { fetchVideoMetadata } from '../../services/youtube';
import { parseYouTubeUrl, youtubeThumbnail } from '../../../shared/youtube';
import { writeAudit } from '../../lib/audit';
import { invalidateAsync } from '../../lib/cache';
import { likePattern, newId, nowIso } from '../../lib/util';
import { ensureUniqueSlug } from '../../lib/slug';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidParam(value: string | undefined): string {
  if (!value || !UUID_RE.test(value)) throw badRequest('Invalid identifier.');
  return value;
}

export function registerAdminLectureRoutes(router: Router): void {
  // ===================== LECTURES =========================================
  router.get('/api/admin/lectures', async (ctx) => {
    await requirePermission(ctx, 'lectures.view');
    const page = parsePage(ctx.url, { pageSize: 25, maxPageSize: 100 });
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const status = ctx.url.searchParams.get('status');
    const courseId = ctx.url.searchParams.get('courseId');
    const chapterId = ctx.url.searchParams.get('chapterId');
    const seriesId = ctx.url.searchParams.get('seriesId');

    const where: string[] = [];
    const binds: unknown[] = [];
    if (q) {
      binds.push(likePattern(q));
      where.push(`(l.title LIKE ?${binds.length} OR l.youtube_video_id LIKE ?${binds.length})`);
    }
    if (status && ['draft', 'published', 'archived'].includes(status)) {
      binds.push(status);
      where.push(`l.status = ?${binds.length}`);
    }
    if (courseId) {
      binds.push(courseId);
      where.push(`l.course_id = ?${binds.length}`);
    }
    if (chapterId) {
      binds.push(chapterId);
      where.push(`l.chapter_id = ?${binds.length}`);
    }
    if (seriesId) {
      binds.push(seriesId);
      where.push(`l.series_id = ?${binds.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM lectures l ${whereSql}`).bind(...binds).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT l.id, l.title, l.description, l.youtube_video_id AS youtubeVideoId, l.youtube_url AS youtubeUrl,
                l.thumbnail_url AS thumbnailUrl, l.channel_name AS channelName, l.duration_seconds AS durationSeconds,
                l.lecture_number AS lectureNumber, l.is_free AS isFree, l.status, l.visibility, l.sort_order AS sortOrder,
                l.view_count AS viewCount, l.published_at AS publishedAt, l.created_at AS createdAt, l.updated_at AS updatedAt,
                l.course_id AS courseId, l.subject_id AS subjectId, l.chapter_id AS chapterId, l.series_id AS seriesId,
                l.language, l.tags,
                c.name AS courseName, s.name AS subjectName, ch.name AS chapterName, ls.title AS seriesTitle
           FROM lectures l
           LEFT JOIN courses c ON c.id = l.course_id
           LEFT JOIN subjects s ON s.id = l.subject_id
           LEFT JOIN chapters ch ON ch.id = l.chapter_id
           LEFT JOIN lecture_series ls ON ls.id = l.series_id
           ${whereSql}
          ORDER BY l.sort_order ASC, l.created_at DESC
          LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    return json(
      paginated(
        (rows.results ?? []).map((r) => ({ ...r, isFree: Boolean(r.isFree) })),
        Number(count?.n ?? 0),
        page,
      ),
    );
  });

  router.get('/api/admin/lectures/:id', async (ctx) => {
    await requirePermission(ctx, 'lectures.view');
    const id = uuidParam(ctx.params.id);
    const row = await ctx.env.DB.prepare(
      `SELECT l.*, (SELECT group_concat(course_id) FROM lecture_courses lc WHERE lc.lecture_id = l.id) AS extraCourses
         FROM lectures l WHERE l.id = ?1`,
    )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!row) throw notFound('Lecture not found.');
    return json({ lecture: { ...row, extraCourses: row.extraCourses ? String(row.extraCourses).split(',') : [] } });
  });

  /**
   * Create a lecture. The admin pastes a YouTube URL; metadata is fetched
   * server-side (title/description/thumbnail/duration) unless overridden.
   * If the YouTube API is unavailable the lecture is still created so the
   * workflow never dead-ends — the response says metadata could not be fetched.
   */
  router.post('/api/admin/lectures', async (ctx) => {
    const auth = await requirePermission(ctx, 'lectures.manage');
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const url = v.string('youtubeUrl', { max: 600 });
    const videoIdInput = v.string('youtubeVideoId', { max: 20 });
    const titleInput = v.string('title', { max: 200 });
    const description = v.string('description', { max: 5000 });
    const thumbnailInput = v.string('thumbnailUrl', { max: 512 });
    const courseId = v.string('courseId', { max: 64 });
    const subjectId = v.string('subjectId', { max: 64 });
    const chapterId = v.string('chapterId', { max: 64 });
    const seriesId = v.string('seriesId', { max: 64 });
    const lectureNumber = v.number('lectureNumber', { min: 0, max: 10000, integer: true });
    const durationInput = v.number('durationSeconds', { min: 0, max: 360000, integer: true });
    const language = v.string('language', { max: 8 }) ?? 'en';
    const isFree = v.boolean('isFree', false)!;
    const status = v.enum('status', ['draft', 'published', 'archived'] as const, { fallback: 'draft' })!;
    const visibility = v.enum('visibility', ['public', 'restricted'] as const, { fallback: 'public' })!;
    const sortOrder = v.number('sortOrder', { min: 0, max: 100000, integer: true }) ?? 0;
    const fetchMetadata = v.boolean('fetchMetadata', true);
    const extraCourseIds = v.array('courseIds', { maxItems: 20 });
    v.throwIfInvalid();

    // Resolve the YouTube video id.
    let videoId = videoIdInput ?? null;
    if (!videoId && url) {
      const parsed = parseYouTubeUrl(url);
      if (parsed.kind === 'video') videoId = parsed.videoId;
      else if (parsed.kind === 'playlist' && parsed.videoId) videoId = parsed.videoId;
      else if (parsed.kind === 'playlist') throw badRequest('That is a playlist link. Use the YouTube Playlist Manager to import playlists.');
      else if (parsed.kind === 'invalid') throw badRequest(parsed.reason);
    }
    if (!videoId) throw badRequest('A valid YouTube URL or video ID is required.');
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw badRequest('The YouTube video ID is invalid.');

    const duplicate = await ctx.env.DB.prepare(
      'SELECT id, title FROM lectures WHERE youtube_video_id = ?1 AND ((series_id IS NULL AND ?2 IS NULL) OR series_id = ?2)',
    )
      .bind(videoId, seriesId ?? null)
      .first<{ id: string; title: string }>();
    if (duplicate) throw conflict(`This video already exists in this series: "${duplicate.title}".`, { existingId: duplicate.id });

    // Metadata
    let title = titleInput ?? null;
    let finalDescription = description ?? null;
    let thumbnail = thumbnailInput ?? null;
    let channelName: string | null = null;
    let duration = durationInput ?? null;
    let publishedAt: string | null = null;
    let metadataWarning: string | null = null;

    if (fetchMetadata !== false) {
      const meta = await fetchVideoMetadata(ctx.env, videoId);
      if (meta.ok) {
        title = title ?? meta.data.title;
        finalDescription = finalDescription ?? meta.data.description?.slice(0, 5000) ?? null;
        thumbnail = thumbnail ?? meta.data.thumbnailUrl;
        channelName = meta.data.channelName;
        duration = duration ?? meta.data.durationSeconds;
        publishedAt = meta.data.publishedAt;
      } else {
        metadataWarning = meta.message;
      }
    }
    if (!title) {
      return json(
        {
          error: {
            code: 'title_required',
            message:
              metadataWarning ??
              'YouTube metadata could not be fetched. Enter a title manually and save again.',
          },
          metadataWarning,
          videoId,
          fallbackThumbnail: youtubeThumbnail(videoId, 'high'),
        },
        { status: 422 },
      );
    }

    if (courseId) {
      const course = await ctx.env.DB.prepare('SELECT id FROM courses WHERE id = ?1').bind(courseId).first();
      if (!course) throw badRequest('Selected course does not exist.');
    }

    const id = newId();
    await ctx.env.DB.prepare(
      `INSERT INTO lectures (id, course_id, subject_id, chapter_id, series_id, title, description, youtube_video_id,
          youtube_url, thumbnail_url, channel_name, duration_seconds, lecture_number, language, is_free, status, visibility,
          sort_order, published_at, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21)`,
    )
      .bind(
        id,
        courseId ?? null,
        subjectId ?? null,
        chapterId ?? null,
        seriesId ?? null,
        title,
        finalDescription,
        videoId,
        url ?? `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail ?? youtubeThumbnail(videoId, 'high'),
        channelName,
        duration,
        lectureNumber ?? null,
        language,
        isFree ? 1 : 0,
        status,
        visibility,
        sortOrder,
        publishedAt,
        auth.user.id,
        nowIso(),
      )
      .run();

    if (Array.isArray(extraCourseIds) && extraCourseIds.length) {
      const statements = extraCourseIds
        .filter((c): c is string => typeof c === 'string' && UUID_RE.test(c))
        .slice(0, 20)
        .map((cid) =>
          ctx.env.DB.prepare('INSERT OR IGNORE INTO lecture_courses (lecture_id, course_id) VALUES (?1, ?2)').bind(id, cid),
        );
      if (statements.length) await ctx.env.DB.batch(statements);
    }

    if (seriesId) await refreshSeries(ctx.env, seriesId);

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'lecture.create',
      entityType: 'lecture',
      entityId: id,
      after: { title, videoId, status, courseId, seriesId, metadataWarning },
    });

    return json({ id, title, videoId, status, metadataWarning, thumbnail }, { status: 201 });
  });

  router.put('/api/admin/lectures/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'lectures.manage');
    const id = uuidParam(ctx.params.id);
    const existing = await ctx.env.DB.prepare('SELECT id, title, status, series_id, course_id FROM lectures WHERE id = ?1')
      .bind(id)
      .first<{ id: string; title: string; status: string; series_id: string | null; course_id: string | null }>();
    if (!existing) throw notFound('Lecture not found.');

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { max: 200 });
    const description = v.string('description', { max: 5000 });
    const thumbnailUrl = v.string('thumbnailUrl', { max: 512 });
    const courseId = v.string('courseId', { max: 64 });
    const subjectId = v.string('subjectId', { max: 64 });
    const chapterId = v.string('chapterId', { max: 64 });
    const seriesId = v.string('seriesId', { max: 64 });
    const lectureNumber = v.number('lectureNumber', { min: 0, max: 10000, integer: true });
    const durationSeconds = v.number('durationSeconds', { min: 0, max: 360000, integer: true });
    const language = v.string('language', { max: 8 });
    const isFree = v.boolean('isFree');
    const status = v.enum('status', ['draft', 'published', 'archived'] as const);
    const visibility = v.enum('visibility', ['public', 'restricted'] as const);
    const sortOrder = v.number('sortOrder', { min: 0, max: 100000, integer: true });
    v.throwIfInvalid();

    const fields: Record<string, unknown> = {
      title: title ?? undefined,
      description: description ?? undefined,
      thumbnail_url: thumbnailUrl ?? undefined,
      course_id: courseId ?? undefined,
      subject_id: subjectId ?? undefined,
      chapter_id: chapterId ?? undefined,
      series_id: seriesId ?? undefined,
      lecture_number: lectureNumber ?? undefined,
      duration_seconds: durationSeconds ?? undefined,
      language: language ?? undefined,
      is_free: isFree === undefined ? undefined : isFree ? 1 : 0,
      status: status ?? undefined,
      visibility: visibility ?? undefined,
      sort_order: sortOrder ?? undefined,
      updated_by: auth.user.id,
      published_at: status === 'published' ? nowIso() : undefined,
    };

    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    const setSql = keys.map((k, i) => `${k} = ?${i + 2}`).join(', ');
    await ctx.env.DB.prepare(`UPDATE lectures SET ${setSql} WHERE id = ?1`)
      .bind(id, ...keys.map((k) => fields[k]))
      .run();

    if (existing.series_id) await refreshSeries(ctx.env, existing.series_id);
    if (seriesId && seriesId !== existing.series_id) await refreshSeries(ctx.env, seriesId);

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'lecture.update',
      entityType: 'lecture',
      entityId: id,
      before: { title: existing.title, status: existing.status },
      after: { title, status },
    });
    return json({ ok: true });
  });

  router.post('/api/admin/lectures/:id/publish', async (ctx) => {
    const auth = await requirePermission(ctx, 'lectures.publish');
    const id = uuidParam(ctx.params.id);
    const body = await readJson(ctx.request);
    const publish = body.publish !== false;

    const lecture = await ctx.env.DB.prepare('SELECT id, status, series_id, title FROM lectures WHERE id = ?1')
      .bind(id)
      .first<{ id: string; status: string; series_id: string | null; title: string }>();
    if (!lecture) throw notFound('Lecture not found.');

    await ctx.env.DB.prepare('UPDATE lectures SET status = ?2, published_at = COALESCE(?3, published_at) WHERE id = ?1')
      .bind(id, publish ? 'published' : 'draft', publish ? nowIso() : null)
      .run();
    if (lecture.series_id) await refreshSeries(ctx.env, lecture.series_id);

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: publish ? 'lecture.publish' : 'lecture.unpublish',
      entityType: 'lecture',
      entityId: id,
      after: { status: publish ? 'published' : 'draft' },
    });
    return json({ ok: true, status: publish ? 'published' : 'draft' });
  });

  router.delete('/api/admin/lectures/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'lectures.manage');
    const id = uuidParam(ctx.params.id);
    const lecture = await ctx.env.DB.prepare('SELECT id, title, series_id FROM lectures WHERE id = ?1')
      .bind(id)
      .first<{ id: string; title: string; series_id: string | null }>();
    if (!lecture) throw notFound('Lecture not found.');

    await ctx.env.DB.prepare('DELETE FROM lectures WHERE id = ?1').bind(id).run();
    if (lecture.series_id) await refreshSeries(ctx.env, lecture.series_id);

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'lecture.delete',
      entityType: 'lecture',
      entityId: id,
      status: 'success',
      before: { title: lecture.title },
    });
    return json({ ok: true });
  });

  // ===================== LECTURE SERIES ===================================
  router.get('/api/admin/lecture-series', async (ctx) => {
    await requirePermission(ctx, 'lectures.view');
    const courseId = ctx.url.searchParams.get('courseId');
    const page = parsePage(ctx.url, { pageSize: 50 });
    const binds: unknown[] = [];
    let where = '';
    if (courseId) {
      binds.push(courseId);
      where = 'WHERE ls.course_id = ?1';
    }
    const rows = await ctx.env.DB.prepare(
      `SELECT ls.*, c.name AS courseName, ch.name AS chapterName
         FROM lecture_series ls
         LEFT JOIN courses c ON c.id = ls.course_id
         LEFT JOIN chapters ch ON ch.id = ls.chapter_id
         ${where}
        ORDER BY ls.sort_order ASC, ls.created_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
    )
      .bind(...binds, page.pageSize, page.offset)
      .all<Record<string, unknown>>();
    return json({ items: (rows.results ?? []).map((r) => ({ ...r, isFree: Boolean(r.isFree) })) });
  });

  router.post('/api/admin/lecture-series', async (ctx) => {
    const auth = await requirePermission(ctx, 'lectures.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { required: true, max: 200 })!;
    const courseId = v.string('courseId', { required: true, max: 64 })!;
    const chapterId = v.string('chapterId', { max: 64 });
    const subjectId = v.string('subjectId', { max: 64 });
    const description = v.string('description', { max: 2000 });
    const thumbnailUrl = v.string('thumbnailUrl', { max: 512 });
    const status = v.enum('status', ['draft', 'published', 'archived'] as const, { fallback: 'draft' })!;
    const isFree = v.boolean('isFree', false)!;
    const sortOrder = v.number('sortOrder', { min: 0, max: 10000, integer: true }) ?? 0;
    v.throwIfInvalid();

    if (!(await ctx.env.DB.prepare('SELECT id FROM courses WHERE id = ?1').bind(courseId).first())) {
      throw badRequest('Selected course does not exist.');
    }
    const id = newId();
    await ctx.env.DB.prepare(
      `INSERT INTO lecture_series (id, course_id, chapter_id, subject_id, title, slug, description, thumbnail_url,
          is_free, status, sort_order, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
    )
      .bind(
        id,
        courseId,
        chapterId ?? null,
        subjectId ?? null,
        title,
        await ensureUniqueSlug(ctx.env.DB, 'lecture_series', 'slug', title),
        description ?? null,
        thumbnailUrl ?? null,
        isFree ? 1 : 0,
        status,
        sortOrder,
        auth.user.id,
        nowIso(),
      )
      .run();

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'lecture_series.create',
      entityType: 'lecture_series',
      entityId: id,
      after: { title, courseId },
    });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/lecture-series/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'lectures.manage');
    const id = uuidParam(ctx.params.id);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { max: 200 });
    const description = v.string('description', { max: 2000 });
    const thumbnailUrl = v.string('thumbnailUrl', { max: 512 });
    const chapterId = v.string('chapterId', { max: 64 });
    const status = v.enum('status', ['draft', 'published', 'archived'] as const);
    const isFree = v.boolean('isFree');
    const sortOrder = v.number('sortOrder', { min: 0, max: 10000, integer: true });
    v.throwIfInvalid();

    const exists = await ctx.env.DB.prepare('SELECT id FROM lecture_series WHERE id = ?1').bind(id).first();
    if (!exists) throw notFound('Lecture series not found.');

    const fields: Record<string, unknown> = {
      title: title ?? undefined,
      description: description ?? undefined,
      thumbnail_url: thumbnailUrl ?? undefined,
      chapter_id: chapterId ?? undefined,
      status: status ?? undefined,
      is_free: isFree === undefined ? undefined : isFree ? 1 : 0,
      sort_order: sortOrder ?? undefined,
    };
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (keys.length) {
      await ctx.env.DB.prepare(`UPDATE lecture_series SET ${keys.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
        .bind(id, ...keys.map((k) => fields[k]))
        .run();
    }
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'lecture_series.update',
      entityType: 'lecture_series',
      entityId: id,
      after: body,
    });
    return json({ ok: true });
  });

  router.delete('/api/admin/lecture-series/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'lectures.manage');
    const id = uuidParam(ctx.params.id);
    const usage = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM lectures WHERE series_id = ?1').bind(id).first<{ n: number }>();
    if (Number(usage?.n ?? 0) > 0) throw conflict('This series still contains lectures. Move or delete them first.');
    await ctx.env.DB.prepare('DELETE FROM lecture_series WHERE id = ?1').bind(id).run();
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'lecture_series.delete',
      entityType: 'lecture_series',
      entityId: id,
    });
    return json({ ok: true });
  });
}

async function refreshSeries(env: { DB: D1Database }, seriesId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE lecture_series SET
       lecture_count = (SELECT COUNT(*) FROM lectures WHERE series_id = ?1 AND status = 'published'),
       total_minutes = (SELECT COALESCE(SUM(COALESCE(duration_seconds,0)),0)/60 FROM lectures WHERE series_id = ?1)
     WHERE id = ?1`,
  )
    .bind(seriesId)
    .run();
}
