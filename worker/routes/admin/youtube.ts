// =============================================================================
// Admin: YouTube metadata + playlist manager
//   POST /api/admin/youtube/metadata     resolve a URL → metadata (never persists)
//   POST /api/admin/youtube/playlists    import/link a playlist
//   GET  /api/admin/youtube/playlists
//   POST /api/admin/youtube/playlists/:id/sync   re-pull items
//   POST /api/admin/youtube/playlists/:id/import import items as lectures
//   DELETE /api/admin/youtube/playlists/:id
// =============================================================================

import type { Router } from '../../lib/router';
import { badRequest, json, notFound, readJson, Validator } from '../../lib/http';
import { requirePermission } from '../../services/session';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { fetchPlaylistItems, fetchPlaylistMetadata, fetchVideoMetadata, youtubeConfigured } from '../../services/youtube';
import { parseYouTubeUrl } from '../../../shared/youtube';
import { writeAudit } from '../../lib/audit';
import { invalidateAsync } from '../../lib/cache';
import { newId, nowIso } from '../../lib/util';

export function registerAdminYouTubeRoutes(router: Router): void {
  // ---- Metadata lookup (used by the "add lecture" form) ------------------
  router.post('/api/admin/youtube/metadata', async (ctx) => {
    const auth = await requirePermission(ctx, 'youtube.manage');
    await enforceRateLimit(ctx.env, RATE_LIMITS.youtube, clientIdentity(ctx.request, auth.user.id));

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const url = v.string('url', { required: true, max: 600 })!;
    v.throwIfInvalid();

    const parsed = parseYouTubeUrl(url);
    if (parsed.kind === 'playlist') {
      const meta = await fetchPlaylistMetadata(ctx.env, url);
      if (!meta.ok) {
        return json(
          {
            ok: false,
            code: meta.code,
            message: meta.message,
            parsed: { kind: 'playlist', playlistId: parsed.playlistId },
            configured: youtubeConfigured(ctx.env),
          },
          { status: 200 },
        );
      }
      return json({ ok: true, kind: 'playlist', playlist: meta.data, configured: true });
    }

    const meta = await fetchVideoMetadata(ctx.env, url);
    if (!meta.ok) {
      const videoId = parsed.kind === 'video' ? parsed.videoId : null;
      return json(
        {
          ok: false,
          code: meta.code,
          message: meta.message,
          configured: youtubeConfigured(ctx.env),
          // Provide a best-effort fallback the admin can edit manually.
          fallback: videoId
            ? {
                videoId,
                title: '',
                description: '',
                thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
              }
            : null,
        },
        { status: 200 },
      );
    }

    return json({
      ok: true,
      kind: 'video',
      video: meta.data,
      embedUrl: `https://www.youtube-nocookie.com/embed/${meta.data.videoId}`,
      configured: true,
    });
  });

  // ---- Playlist list -----------------------------------------------------
  router.get('/api/admin/youtube/playlists', async (ctx) => {
    await requirePermission(ctx, 'youtube.manage');
    const rows = await ctx.env.DB.prepare(
      `SELECT p.id, p.youtube_playlist_id AS youtubePlaylistId, p.title, p.description, p.thumbnail_url AS thumbnailUrl,
              p.channel_name AS channelName, p.item_count AS itemCount, p.course_id AS courseId, p.series_id AS seriesId,
              p.is_active AS isActive, p.last_synced_at AS lastSyncedAt, p.created_at AS createdAt,
              c.name AS courseName, ls.title AS seriesTitle
         FROM youtube_playlists p
         LEFT JOIN courses c ON c.id = p.course_id
         LEFT JOIN lecture_series ls ON ls.id = p.series_id
        ORDER BY p.created_at DESC LIMIT 200`,
    ).all<Record<string, unknown>>();
    return json({
      items: (rows.results ?? []).map((r) => ({ ...r, isActive: Boolean(r.isActive) })),
      configured: youtubeConfigured(ctx.env),
    });
  });

  // ---- Register a playlist ------------------------------------------------
  router.post('/api/admin/youtube/playlists', async (ctx) => {
    const auth = await requirePermission(ctx, 'youtube.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const url = v.string('url', { max: 600 });
    const courseId = v.string('courseId', { max: 64 });
    const seriesId = v.string('seriesId', { max: 64 });
    v.throwIfInvalid();

    const playlistId = url ? (parseYouTubeUrl(url).kind === 'playlist' ? (parseYouTubeUrl(url) as { playlistId: string }).playlistId : null) : null;
    if (!playlistId) throw badRequest('Enter a valid YouTube playlist URL (…/playlist?list=…).');

    const existing = await ctx.env.DB.prepare('SELECT id FROM youtube_playlists WHERE youtube_playlist_id = ?1')
      .bind(playlistId)
      .first<{ id: string }>();
    if (existing) return json({ id: existing.id, alreadyExists: true });

    const meta = await fetchPlaylistMetadata(ctx.env, url!);
    if (!meta.ok && meta.code !== 'not_configured') throw badRequest(meta.message);

    const id = newId();
    await ctx.env.DB.prepare(
      `INSERT INTO youtube_playlists (id, youtube_playlist_id, title, description, thumbnail_url, channel_name, item_count,
        course_id, series_id, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
    )
      .bind(
        id,
        playlistId,
        meta.ok ? meta.data.title : `Playlist ${playlistId}`,
        meta.ok ? meta.data.description : null,
        meta.ok ? meta.data.thumbnailUrl : null,
        meta.ok ? meta.data.channelName : null,
        meta.ok ? meta.data.itemCount : 0,
        courseId ?? null,
        seriesId ?? null,
        auth.user.id,
        nowIso(),
      )
      .run();

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'youtube.playlist_added',
      entityType: 'youtube_playlist',
      entityId: id,
      meta: { playlistId, configured: meta.ok },
    });
    return json({ id, metadataAvailable: meta.ok, message: meta.ok ? undefined : meta.message }, { status: 201 });
  });

  // ---- Sync playlist items ------------------------------------------------
  router.post('/api/admin/youtube/playlists/:id/sync', async (ctx) => {
    const auth = await requirePermission(ctx, 'youtube.manage');
    await enforceRateLimit(ctx.env, RATE_LIMITS.youtube, clientIdentity(ctx.request, auth.user.id));

    const playlist = await ctx.env.DB.prepare('SELECT id, youtube_playlist_id FROM youtube_playlists WHERE id = ?1')
      .bind(ctx.params.id)
      .first<{ id: string; youtube_playlist_id: string }>();
    if (!playlist) throw notFound('Playlist not found.');

    const items = await fetchPlaylistItems(ctx.env, playlist.youtube_playlist_id, { maxItems: 200 });
    if (!items.ok) return json({ ok: false, code: items.code, message: items.message }, { status: 200 });

    const statements: D1PreparedStatement[] = [ctx.env.DB.prepare('DELETE FROM youtube_playlist_items WHERE playlist_id = ?1').bind(playlist.id)];
    for (const item of items.data) {
      statements.push(
        ctx.env.DB.prepare(
          `INSERT INTO youtube_playlist_items (id, playlist_id, youtube_video_id, title, thumbnail_url, position, duration_seconds)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        ).bind(newId(), playlist.id, item.videoId, item.title, item.thumbnailUrl, item.position, item.durationSeconds),
      );
    }
    for (let i = 0; i < statements.length; i += 50) await ctx.env.DB.batch(statements.slice(i, i + 50));

    await ctx.env.DB.prepare('UPDATE youtube_playlists SET item_count = ?2, last_synced_at = ?3 WHERE id = ?1')
      .bind(playlist.id, items.data.length, nowIso())
      .run();

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'youtube.playlist_synced',
      entityType: 'youtube_playlist',
      entityId: playlist.id,
      meta: { items: items.data.length },
    });
    return json({ ok: true, items: items.data });
  });

  router.get('/api/admin/youtube/playlists/:id/items', async (ctx) => {
    await requirePermission(ctx, 'youtube.manage');
    const rows = await ctx.env.DB.prepare(
      'SELECT id, youtube_video_id AS youtubeVideoId, title, thumbnail_url AS thumbnailUrl, position, duration_seconds AS durationSeconds, lecture_id AS lectureId FROM youtube_playlist_items WHERE playlist_id = ?1 ORDER BY position ASC',
    )
      .bind(ctx.params.id)
      .all();
    return json({ items: rows.results ?? [] });
  });

  // ---- Import playlist items as lectures ----------------------------------
  router.post('/api/admin/youtube/playlists/:id/import', async (ctx) => {
    const auth = await requirePermission(ctx, 'lectures.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const courseId = v.string('courseId', { required: true, max: 64 })!;
    const chapterId = v.string('chapterId', { max: 64 });
    const subjectId = v.string('subjectId', { max: 64 });
    const seriesId = v.string('seriesId', { max: 64 });
    const publish = v.boolean('publish', false)!;
    v.throwIfInvalid();

    const playlist = await ctx.env.DB.prepare('SELECT id, title FROM youtube_playlists WHERE id = ?1')
      .bind(ctx.params.id)
      .first<{ id: string; title: string }>();
    if (!playlist) throw notFound('Playlist not found.');

    const items = await ctx.env.DB.prepare(
      'SELECT youtube_video_id AS videoId, title, thumbnail_url AS thumbnailUrl, position, duration_seconds AS durationSeconds FROM youtube_playlist_items WHERE playlist_id = ?1 ORDER BY position ASC',
    )
      .bind(playlist.id)
      .all<{ videoId: string; title: string; thumbnailUrl: string | null; position: number; durationSeconds: number | null }>();

    if (!items.results?.length) throw badRequest('Sync the playlist first so its videos are available.');

    let created = 0;
    let skipped = 0;

    for (const item of items.results) {
      const existing = await ctx.env.DB.prepare(
        'SELECT id FROM lectures WHERE youtube_video_id = ?1 AND ((series_id IS NULL AND ?2 IS NULL) OR series_id = ?2)',
      )
        .bind(item.videoId, seriesId ?? null)
        .first<{ id: string }>();
      if (existing) {
        skipped++;
        continue;
      }
      await ctx.env.DB.prepare(
        `INSERT INTO lectures (id, course_id, subject_id, chapter_id, series_id, title, youtube_video_id, youtube_url,
            thumbnail_url, duration_seconds, lecture_number, status, sort_order, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)`,
      )
        .bind(
          newId(),
          courseId,
          subjectId ?? null,
          chapterId ?? null,
          seriesId ?? null,
          item.title || `Lecture ${item.position + 1}`,
          item.videoId,
          `https://www.youtube.com/watch?v=${item.videoId}`,
          item.thumbnailUrl ?? `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
          item.durationSeconds,
          item.position + 1,
          publish ? 'published' : 'draft',
          item.position,
          auth.user.id,
          nowIso(),
        )
        .run();
      created++;
    }

    if (seriesId) {
      await ctx.env.DB.prepare(
        `UPDATE lecture_series SET lecture_count = (SELECT COUNT(*) FROM lectures WHERE series_id = ?1 AND status='published'),
           total_minutes = (SELECT COALESCE(SUM(COALESCE(duration_seconds,0)),0)/60 FROM lectures WHERE series_id = ?1)
         WHERE id = ?1`,
      )
        .bind(seriesId)
        .run();
    }

    // Remember the mapping so future playlist syncs know where they land.
    await ctx.env.DB.prepare('UPDATE youtube_playlists SET course_id = COALESCE(course_id, ?2), series_id = COALESCE(series_id, ?3), last_synced_at = ?4 WHERE id = ?1')
      .bind(playlist.id, courseId, seriesId ?? null, nowIso())
      .run();

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'youtube.playlist_imported',
      entityType: 'youtube_playlist',
      entityId: playlist.id,
      meta: { created, skipped, courseId, seriesId: seriesId ?? null, publish },
    });
    return json({ created, skipped, total: items.results.length });
  });

  router.delete('/api/admin/youtube/playlists/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'youtube.manage');
    await ctx.env.DB.prepare('DELETE FROM youtube_playlists WHERE id = ?1').bind(ctx.params.id).run();
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'youtube.playlist_deleted',
      entityType: 'youtube_playlist',
      entityId: ctx.params.id,
    });
    return json({ ok: true });
  });
}
