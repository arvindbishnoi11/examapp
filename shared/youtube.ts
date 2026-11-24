// =============================================================================
// YouTube URL parsing — shared by the admin UI (instant feedback) and the
// Worker (authoritative validation before any metadata fetch is persisted).
// =============================================================================

export type ParsedYouTube =
  | { kind: 'video'; videoId: string; startSeconds?: number }
  | { kind: 'playlist'; playlistId: string; videoId?: string }
  | { kind: 'channel'; channelHandle: string }
  | { kind: 'invalid'; reason: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;

/**
 * Accepts standard, shortened, shorts, embed, live, nocookie URLs, bare video
 * ids and playlist URLs (including watch URLs that carry `list=`).
 */
export function parseYouTubeUrl(input: string): ParsedYouTube {
  const raw = (input ?? '').trim();
  if (!raw) return { kind: 'invalid', reason: 'Enter a YouTube URL or video ID.' };

  // Bare video id
  if (VIDEO_ID.test(raw)) return { kind: 'video', videoId: raw };

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return { kind: 'invalid', reason: 'That does not look like a valid URL.' };
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  const params = url.searchParams;

  const startSeconds = (() => {
    const t = params.get('t') ?? params.get('start');
    if (!t) return undefined;
    const match = /^(\d+)(s)?$/.exec(t);
    return match ? Number(match[1]) : undefined;
  })();

  const allowedHosts = [
    'youtube.com',
    'youtu.be',
    'youtube-nocookie.com',
    'music.youtube.com',
    'youtube.googleapis.com',
  ];
  if (!allowedHosts.some((h) => host === h || host.endsWith('.' + h))) {
    return { kind: 'invalid', reason: 'Only youtube.com and youtu.be links are supported.' };
  }

  // youtu.be/<id>
  if (host.endsWith('youtu.be')) {
    const id = segments[0];
    if (id && VIDEO_ID.test(id)) return { kind: 'video', videoId: id, startSeconds };
    return { kind: 'invalid', reason: 'The shortened YouTube link has no valid video id.' };
  }

  const playlistId = params.get('list') ?? undefined;

  // /playlist?list=PL...
  if (segments[0] === 'playlist') {
    if (playlistId && PLAYLIST_ID.test(playlistId)) return { kind: 'playlist', playlistId };
    return { kind: 'invalid', reason: 'The playlist link has no valid list id.' };
  }

  // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
  if (['shorts', 'embed', 'live', 'v', 'e'].includes(segments[0]) && segments[1]) {
    if (VIDEO_ID.test(segments[1])) return { kind: 'video', videoId: segments[1], startSeconds };
    return { kind: 'invalid', reason: 'The link contains an invalid video id.' };
  }

  // /watch?v=<id>  (optionally with list=)
  const v = params.get('v');
  if (v) {
    if (!VIDEO_ID.test(v)) return { kind: 'invalid', reason: 'The link contains an invalid video id.' };
    if (playlistId && PLAYLIST_ID.test(playlistId)) return { kind: 'playlist', playlistId, videoId: v };
    return { kind: 'video', videoId: v, startSeconds };
  }

  // /@handle or /channel/UC... or /c/name
  if (segments[0]?.startsWith('@')) return { kind: 'channel', channelHandle: segments[0] };
  if ((segments[0] === 'channel' || segments[0] === 'c' || segments[0] === 'user') && segments[1]) {
    return { kind: 'channel', channelHandle: segments[1] };
  }

  if (playlistId && PLAYLIST_ID.test(playlistId)) return { kind: 'playlist', playlistId };

  return { kind: 'invalid', reason: 'Could not find a video or playlist id in that link.' };
}

/** Extracts just a video id, or null. */
export function extractVideoId(input: string): string | null {
  const parsed = parseYouTubeUrl(input);
  if (parsed.kind === 'video') return parsed.videoId;
  if (parsed.kind === 'playlist' && parsed.videoId) return parsed.videoId;
  return null;
}

export function youtubeThumbnail(videoId: string, quality: 'default' | 'medium' | 'high' | 'max' = 'high'): string {
  const map = { default: 'default', medium: 'mqdefault', high: 'hqdefault', max: 'maxresdefault' } as const;
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${map[quality]}.jpg`;
}

export function youtubeEmbedUrl(videoId: string, opts: { start?: number; autoplay?: boolean } = {}): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  if (opts.start) params.set('start', String(opts.start));
  if (opts.autoplay) params.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

/** ISO-8601 duration (PT1H2M3S) → seconds. */
export function isoDurationToSeconds(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, mi, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
