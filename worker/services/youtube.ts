// =============================================================================
// YouTube Data API v3 integration
// =============================================================================
// * Extracts ids from every URL shape (watch / youtu.be / shorts / embed /
//   live / playlist) — parsing lives in shared/youtube.ts so the admin UI and
//   the Worker agree.
// * Fetches metadata server-side only; YOUTUBE_API_KEY never reaches the client.
// * Retries transient failures with exponential backoff and caches responses in
//   D1 (`api_cache`) so repeated saves do not burn quota.
// * If the key is missing or the API fails, the caller gets a structured
//   "manual entry allowed" result instead of a broken screen.
// =============================================================================

import type { Env } from '../env';
import { parseYouTubeUrl, isoDurationToSeconds, youtubeThumbnail } from '../../shared/youtube';
import { HttpError, upstreamError } from '../lib/http';
import { withRetry } from '../lib/util';

const YT_API = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL_SECONDS = 12 * 60 * 60; // 12 hours of metadata caching

export type VideoMetadata = {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  thumbnails: { url: string; width: number; height: number }[];
  channelId: string | null;
  channelName: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  tags: string[];
  categoryId: string | null;
  embeddable: boolean;
  viewCount: number | null;
  cached?: boolean;
};

export type PlaylistMetadata = {
  playlistId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelId: string | null;
  channelName: string | null;
  itemCount: number;
  cached?: boolean;
};

export type PlaylistItem = {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  position: number;
  durationSeconds: number | null;
  publishedAt: string | null;
};

export type MetadataResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'not_configured' | 'invalid_url' | 'not_found' | 'api_error'; message: string };

export function youtubeConfigured(env: Env): boolean {
  return Boolean(env.YOUTUBE_API_KEY?.trim());
}

// ---- D1-backed response cache ----------------------------------------------

async function readCache<T>(env: Env, key: string): Promise<T | null> {
  try {
    const row = await env.DB.prepare('SELECT payload FROM api_cache WHERE key = ?1 AND expires_at > ?2')
      .bind(key, Date.now())
      .first<{ payload: string }>();
    return row ? (JSON.parse(row.payload) as T) : null;
  } catch {
    return null;
  }
}

async function writeCache(env: Env, key: string, value: unknown, ttlSeconds = CACHE_TTL_SECONDS): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO api_cache (key, payload, expires_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET payload = ?2, expires_at = ?3`,
    )
      .bind(key, JSON.stringify(value), Date.now() + ttlSeconds * 1000)
      .run();
  } catch {
    /* cache is best-effort */
  }
}

export async function clearCache(env: Env, prefix: string): Promise<void> {
  await env.DB.prepare('DELETE FROM api_cache WHERE key LIKE ?1').bind(`${prefix}%`).run();
}

// ---- Low-level API call -----------------------------------------------------

type YtError = { code: number; message: string; reasons: string[] };

async function ytFetch<T>(env: Env, path: string, params: Record<string, string>): Promise<T> {
  const key = env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    throw new HttpError(412, 'youtube_not_configured', 'YOUTUBE_API_KEY is not configured on the server.');
  }
  const search = new URLSearchParams({ ...params, key });
  const url = `${YT_API}/${path}?${search.toString()}`;

  const response = await withRetry(
    async () => {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) return res;
      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        /* ignore */
      }
      const error = (payload as { error?: { message?: string; errors?: { reason?: string }[] } })?.error;
      const ytErr: YtError = {
        code: res.status,
        message: error?.message ?? `YouTube API error ${res.status}`,
        reasons: (error?.errors ?? []).map((e) => e.reason ?? ''),
      };
      throw Object.assign(new Error(ytErr.message), { yt: ytErr });
    },
    {
      attempts: 4,
      shouldRetry: (err) => {
        const status = (err as { yt?: YtError }).yt?.code;
        return status === 429 || (status !== undefined && status >= 500);
      },
    },
  );

  return (await response.json()) as T;
}

function describeApiError(err: unknown): string {
  const yt = (err as { yt?: YtError }).yt;
  if (!yt) return 'YouTube is unreachable right now. You can enter the details manually.';
  if (yt.code === 400 && yt.reasons.includes('keyInvalid')) {
    return 'The YouTube API key is invalid. Ask the platform owner to update YOUTUBE_API_KEY.';
  }
  if (yt.code === 403 && yt.reasons.some((r) => r === 'quotaExceeded' || r === 'dailyLimitExceeded')) {
    return 'The YouTube API daily quota is exhausted. You can still add the lecture manually.';
  }
  if (yt.code === 403) {
    return 'The YouTube API key lacks permission for this request. You can add the lecture manually.';
  }
  return 'YouTube could not be reached. You can enter the details manually.';
}

// ---- Public API -------------------------------------------------------------

export async function fetchVideoMetadata(env: Env, inputUrl: string): Promise<MetadataResult<VideoMetadata>> {
  const parsed = parseYouTubeUrl(inputUrl);
  const videoId = parsed.kind === 'video' ? parsed.videoId : parsed.kind === 'playlist' ? parsed.videoId : null;
  if (parsed.kind === 'invalid') return { ok: false, code: 'invalid_url', message: parsed.reason };
  if (!videoId) {
    return {
      ok: false,
      code: 'invalid_url',
      message: 'This is a playlist link. Use the playlist import instead.',
    };
  }
  if (!youtubeConfigured(env)) {
    return {
      ok: false,
      code: 'not_configured',
      message:
        'YouTube metadata is disabled because YOUTUBE_API_KEY is not set. The lecture will be saved with the video ID and the thumbnail from YouTube; edit the title and description manually.',
    };
  }

  const cacheKey = `yt:video:${videoId}`;
  const cached = await readCache<VideoMetadata>(env, cacheKey);
  if (cached) return { ok: true, data: { ...cached, cached: true } };

  try {
    const data = await ytFetch<{
      items?: {
        id: string;
        snippet?: {
          title?: string;
          description?: string;
          channelId?: string;
          channelTitle?: string;
          publishedAt?: string;
          tags?: string[];
          categoryId?: string;
          thumbnails?: Record<string, { url: string; width: number; height: number }>;
        };
        contentDetails?: { duration?: string };
        status?: { embeddable?: boolean };
        statistics?: { viewCount?: string };
      }[];
    }>(env, 'videos', {
      part: 'snippet,contentDetails,status,statistics',
      id: videoId,
      maxResults: '1',
    });

    const item = data.items?.[0];
    if (!item) {
      return {
        ok: false,
        code: 'not_found',
        message: 'That video is private, deleted or unavailable. Check the link and try again.',
      };
    }

    const thumbs = item.snippet?.thumbnails ?? {};
    const ordered = ['maxres', 'standard', 'high', 'medium', 'default']
      .map((k) => thumbs[k])
      .filter(Boolean) as { url: string; width: number; height: number }[];

    const metadata: VideoMetadata = {
      videoId,
      title: item.snippet?.title ?? 'Untitled YouTube video',
      description: item.snippet?.description ?? '',
      thumbnailUrl: ordered[0]?.url ?? youtubeThumbnail(videoId, 'high'),
      thumbnails: ordered,
      channelId: item.snippet?.channelId ?? null,
      channelName: item.snippet?.channelTitle ?? null,
      durationSeconds: isoDurationToSeconds(item.contentDetails?.duration),
      publishedAt: item.snippet?.publishedAt ?? null,
      tags: item.snippet?.tags?.slice(0, 20) ?? [],
      categoryId: item.snippet?.categoryId ?? null,
      embeddable: item.status?.embeddable !== false,
      viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
    };

    await writeCache(env, cacheKey, metadata);
    return { ok: true, data: metadata };
  } catch (err) {
    return { ok: false, code: 'api_error', message: describeApiError(err) };
  }
}

export async function fetchPlaylistMetadata(env: Env, inputUrl: string): Promise<MetadataResult<PlaylistMetadata>> {
  const parsed = parseYouTubeUrl(inputUrl);
  const playlistId = parsed.kind === 'playlist' ? parsed.playlistId : null;
  if (!playlistId) return { ok: false, code: 'invalid_url', message: 'That link does not contain a playlist id.' };
  if (!youtubeConfigured(env)) {
    return {
      ok: false,
      code: 'not_configured',
      message: 'YOUTUBE_API_KEY is not configured, so playlists cannot be imported automatically.',
    };
  }

  const cacheKey = `yt:playlist:${playlistId}`;
  const cached = await readCache<PlaylistMetadata>(env, cacheKey);
  if (cached) return { ok: true, data: { ...cached, cached: true } };

  try {
    const data = await ytFetch<{
      items?: {
        id: string;
        snippet?: {
          title?: string;
          description?: string;
          channelId?: string;
          channelTitle?: string;
          thumbnails?: Record<string, { url: string; width: number; height: number }>;
        };
        contentDetails?: { itemCount?: number };
      }[];
    }>(env, 'playlists', { part: 'snippet,contentDetails', id: playlistId, maxResults: '1' });

    const item = data.items?.[0];
    if (!item) return { ok: false, code: 'not_found', message: 'That playlist is private or does not exist.' };

    const thumbs = item.snippet?.thumbnails ?? {};
    const best = thumbs.maxres ?? thumbs.high ?? thumbs.medium ?? thumbs.default;

    const metadata: PlaylistMetadata = {
      playlistId,
      title: item.snippet?.title ?? 'Untitled playlist',
      description: item.snippet?.description ?? '',
      thumbnailUrl: best?.url ?? '',
      channelId: item.snippet?.channelId ?? null,
      channelName: item.snippet?.channelTitle ?? null,
      itemCount: item.contentDetails?.itemCount ?? 0,
    };
    await writeCache(env, cacheKey, metadata);
    return { ok: true, data: metadata };
  } catch (err) {
    return { ok: false, code: 'api_error', message: describeApiError(err) };
  }
}

/** Lists playlist items (paged, capped) and resolves durations in one batch. */
export async function fetchPlaylistItems(
  env: Env,
  playlistId: string,
  options: { maxItems?: number } = {},
): Promise<MetadataResult<PlaylistItem[]>> {
  if (!youtubeConfigured(env)) {
    return { ok: false, code: 'not_configured', message: 'YOUTUBE_API_KEY is not configured.' };
  }
  const maxItems = Math.min(options.maxItems ?? 200, 500);

  try {
    const ids: { videoId: string; title: string; description: string; thumbnailUrl: string; position: number; publishedAt: string | null }[] = [];
    let pageToken: string | undefined;

    while (ids.length < maxItems) {
      const data: {
        nextPageToken?: string;
        items?: {
          snippet?: {
            title?: string;
            description?: string;
            position?: number;
            publishedAt?: string;
            resourceId?: { videoId?: string };
            thumbnails?: Record<string, { url: string }>;
          };
        }[];
      } = await ytFetch(env, 'playlistItems', {
        part: 'snippet,contentDetails',
        playlistId,
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      });

      for (const item of data.items ?? []) {
        const videoId = item.snippet?.resourceId?.videoId;
        if (!videoId) continue;
        const thumbs = item.snippet?.thumbnails ?? {};
        ids.push({
          videoId,
          title: item.snippet?.title ?? '',
          description: item.snippet?.description ?? '',
          thumbnailUrl: (thumbs.maxres ?? thumbs.high ?? thumbs.medium ?? thumbs.default)?.url ?? youtubeThumbnail(videoId),
          position: item.snippet?.position ?? ids.length,
          publishedAt: item.snippet?.publishedAt ?? null,
        });
      }
      if (!data.nextPageToken || ids.length >= maxItems) break;
      pageToken = data.nextPageToken;
    }

    const unique = ids.slice(0, maxItems);
    const durations = new Map<string, number | null>();

    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50);
      const data = await ytFetch<{ items?: { id: string; contentDetails?: { duration?: string } }[] }>(env, 'videos', {
        part: 'contentDetails',
        id: batch.map((v) => v.videoId).join(','),
        maxResults: '50',
      });
      for (const item of data.items ?? []) durations.set(item.id, isoDurationToSeconds(item.contentDetails?.duration));
    }

    return {
      ok: true,
      data: unique.map((v) => ({ ...v, durationSeconds: durations.get(v.videoId) ?? null })),
    };
  } catch (err) {
    return { ok: false, code: 'api_error', message: describeApiError(err) };
  }
}

/** Extracts a video id from any supported URL (used by admin create flows). */
export function videoIdFromUrl(inputUrl: string): string | null {
  const parsed = parseYouTubeUrl(inputUrl);
  if (parsed.kind === 'video') return parsed.videoId;
  if (parsed.kind === 'playlist' && parsed.videoId) return parsed.videoId;
  return null;
}

export function assertUpstreamConfigured(env: Env): void {
  if (!youtubeConfigured(env)) {
    throw upstreamError('YouTube integration is not configured on this server.');
  }
}
