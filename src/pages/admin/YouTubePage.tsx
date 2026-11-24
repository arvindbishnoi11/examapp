import { useState } from 'react';
import { AlertCircle, DownloadCloud, ListVideo, PlayCircle, Plus, RefreshCw, Trash2, Video } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, ConfirmDialog, Modal, Spinner } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { PageHeader, Panel, SearchInput } from '@/components/admin/AdminUI';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { formatDateTime, formatDurationLabel } from '@/lib/format';
import { parseYouTubeUrl, youtubeThumbnail } from '@shared/youtube';
import type { Paginated } from '@shared/types';

type Playlist = {
  id: string;
  youtubePlaylistId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  channelName: string | null;
  itemCount: number;
  courseId: string | null;
  seriesId: string | null;
  courseName: string | null;
  seriesTitle: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
};

type PlaylistItem = { id: string; youtubeVideoId: string; title: string; thumbnailUrl: string | null; position: number; durationSeconds: number | null; lectureId: string | null };

type VideoMeta = {
  ok: boolean;
  code?: string;
  message?: string;
  configured?: boolean;
  kind?: 'video' | 'playlist';
  video?: { videoId: string; title: string; description: string; thumbnailUrl: string; channelName: string; durationSeconds: number | null; publishedAt: string | null };
  playlist?: { title: string; description: string; thumbnailUrl: string; channelName: string; itemCount: number };
  fallback?: { videoId: string; title: string; thumbnailUrl: string; youtubeUrl: string } | null;
};

export default function AdminYouTubePage() {
  useDocumentTitle('YouTube manager');
  const toast = useToast();
  const { classes } = useAdminTaxonomy();
  const [tab, setTab] = useState<'lookup' | 'playlists'>('lookup');

  // Playlist form state
  const [url, setUrl] = useState('');
  const [courseId, setCourseId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Playlist | null>(null);
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Single-video lookup state
  const [videoUrl, setVideoUrl] = useState('');
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [looking, setLooking] = useState(false);

  const playlists = useApiQuery<{ items: Playlist[]; configured: boolean }>('/api/admin/youtube/playlists');
  const courses = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/courses', { pageSize: 100 });
  const series = useApiQuery<Paginated<{ id: string; title: string }>>('/api/admin/lecture-series', { pageSize: 100 });

  const addPlaylist = async () => {
    setAdding(true);
    try {
      const result = await api.post<{ id: string; alreadyExists?: boolean; metadataAvailable?: boolean; message?: string }>('/api/admin/youtube/playlists', {
        url,
        courseId: courseId || undefined,
        seriesId: seriesId || undefined,
      });
      if (result.alreadyExists) toast.info('That playlist is already registered.');
      else if (result.metadataAvailable === false) toast.warning(result.message ?? 'Playlist added — sync will work once YOUTUBE_API_KEY is configured.');
      else toast.success('Playlist registered');
      setUrl('');
      playlists.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const syncPlaylist = async (playlist: Playlist) => {
    setSyncBusy(playlist.id);
    try {
      const result = await api.post<{ ok: boolean; message?: string; items?: PlaylistItem[] }>(`/api/admin/youtube/playlists/${playlist.id}/sync`);
      if (!result.ok) toast.warning(result.message ?? 'Sync failed.');
      else toast.success(`Synced ${result.items?.length ?? 0} videos`);
      playlists.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSyncBusy(null);
    }
  };

  const lookup = async () => {
    setLooking(true);
    setVideoMeta(null);
    try {
      const result = await api.post<VideoMeta>('/api/admin/youtube/metadata', { url: videoUrl });
      setVideoMeta(result);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLooking(false);
    }
  };

  const parsedVideo = parseYouTubeUrl(videoUrl);

  return (
    <div>
      <PageHeader
        title="YouTube manager"
        description="Resolve video links, import playlists and keep lecture metadata in sync — videos always play from the original YouTube embed."
        actions={
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {[{ id: 'lookup' as const, label: 'Video lookup' }, { id: 'playlists' as const, label: 'Playlists' }].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${tab === item.id ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />

      {playlists.data && !playlists.data.configured ? (
        <div className="mb-3">
          <Alert tone="warning" title="YouTube Data API key not configured">
            Metadata and playlist sync need <code>YOUTUBE_API_KEY</code>. You can still add individual videos by pasting a URL
            and typing the title manually — playback works regardless because videos are embedded, not re-hosted.
          </Alert>
        </div>
      ) : null}

      {tab === 'lookup' ? (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Panel title="Resolve a YouTube link">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="input"
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=… / youtu.be/… / shorts/… / embed/…"
                aria-label="YouTube URL"
              />
              <Button loading={looking} onClick={lookup} disabled={!videoUrl.trim()} icon={<PlayCircle className="h-4 w-4" aria-hidden />}>Resolve</Button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Accepted: watch, youtu.be, shorts, embed, live and playlist URLs. Video IDs have 11 characters.
            </p>

            {videoMeta ? (
              videoMeta.ok && videoMeta.video ? (
                <div className="mt-3 space-y-2.5">
                  <div className="flex gap-3">
                    <img src={videoMeta.video.thumbnailUrl} alt="" className="h-20 w-36 rounded-lg object-cover" />
                    <div className="min-w-0 text-[12px]">
                      <p className="font-semibold leading-snug">{videoMeta.video.title}</p>
                      <p className="text-slate-500">{videoMeta.video.channelName}</p>
                      <p className="text-slate-500">{formatDurationLabel(videoMeta.video.durationSeconds)}{videoMeta.video.publishedAt ? ` · ${formatDateTime(videoMeta.video.publishedAt)}` : ''}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] text-slate-400">{videoMeta.video.videoId}</p>
                    </div>
                  </div>
                  <details className="rounded-lg bg-slate-50 p-2.5 text-[11.5px] dark:bg-slate-800/60">
                    <summary className="cursor-pointer font-semibold">Description</summary>
                    <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{videoMeta.video.description?.slice(0, 1200) || 'No description.'}</p>
                  </details>
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ Metadata fetched. Use “Add lecture” to attach it to a course.</p>
                </div>
              ) : videoMeta.ok && videoMeta.playlist ? (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-3">
                    <img src={videoMeta.playlist.thumbnailUrl} alt="" className="h-20 w-36 rounded-lg object-cover" />
                    <div className="min-w-0 text-[12px]">
                      <p className="font-semibold">{videoMeta.playlist.title}</p>
                      <p className="text-slate-500">{videoMeta.playlist.channelName} · {videoMeta.playlist.itemCount} videos</p>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => { setTab('playlists'); setUrl(videoUrl); }}>Register this playlist</Button>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <p className="font-semibold">{videoMeta.message ?? 'Metadata unavailable'}</p>
                  {videoMeta.fallback ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <img src={videoMeta.fallback.thumbnailUrl} alt="" className="h-12 w-20 rounded object-cover" />
                      <div>
                        <p className="font-mono text-[10.5px]">{videoMeta.fallback.videoId}</p>
                        <p className="text-[10.5px]">Thumbnail from YouTube; add a title manually when saving the lecture.</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            ) : parsedVideo.kind === 'invalid' && videoUrl ? (
              <p className="mt-2 text-[11.5px] text-rose-600">{parsedVideo.reason}</p>
            ) : null}
          </Panel>

          <Panel title="How the playlist flow works">
            <ol className="list-inside list-decimal space-y-1.5 text-[12px] text-slate-600 dark:text-slate-300">
              <li>Paste a playlist URL and choose the course / series it belongs to.</li>
              <li>Press <strong>Sync</strong> to pull the list of videos (requires the API key).</li>
              <li>Preview the items, then import them as drafts or published lectures.</li>
              <li>Duplicate videos are skipped — importing twice never creates duplicates.</li>
            </ol>
            <p className="mt-2 text-[11px] text-slate-500">
              Videos are always embedded from youtube-nocookie.com. We never copy, download or re-host video files.
            </p>
          </Panel>
        </div>
      ) : (
        <div className="space-y-4">
          <Panel title="Register a playlist">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <input
                  className="input"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://www.youtube.com/playlist?list=…"
                  aria-label="Playlist URL"
                />
              </div>
              <select className="input" value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Course">
                <option value="">Course (optional)</option>
                {(courses.data?.items ?? []).map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
              <select className="input" value={seriesId} onChange={(event) => setSeriesId(event.target.value)} aria-label="Series">
                <option value="">Series (optional)</option>
                {(series.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </div>
            <div className="mt-2">
              <Button size="sm" loading={adding} onClick={addPlaylist} disabled={!url.trim()} icon={<Plus className="h-3.5 w-3.5" aria-hidden />}>Register playlist</Button>
            </div>
          </Panel>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {playlists.loading ? <Spinner /> : !playlists.data?.items.length ? (
              <div className="md:col-span-2 xl:col-span-3 rounded-xl2 border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
                <Video className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden />
                <p className="mt-2 text-[13px] text-slate-500">No playlists registered yet. Paste a playlist URL above.</p>
              </div>
            ) : playlists.data.items.map((playlist) => (
              <div key={playlist.id} className="card overflow-hidden">
                <div className="flex gap-2.5 p-3">
                  <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                    {playlist.thumbnailUrl ? <img src={playlist.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2-safe text-[12.5px] font-semibold leading-snug">{playlist.title}</p>
                    <p className="truncate text-[10.5px] text-slate-500">{playlist.channelName ?? 'Unknown channel'}</p>
                    <p className="text-[10.5px] text-slate-500">{playlist.itemCount} videos{playlist.lastSyncedAt ? ` · synced ${formatDateTime(playlist.lastSyncedAt)}` : ' · never synced'}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {playlist.courseName ? <Badge tone="brand">{playlist.courseName}</Badge> : null}
                      {playlist.seriesTitle ? <Badge tone="neutral">{playlist.seriesTitle}</Badge> : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                  <Button size="sm" variant="secondary" loading={syncBusy === playlist.id} onClick={() => syncPlaylist(playlist)} icon={<RefreshCw className="h-3 w-3" aria-hidden />}>Sync</Button>
                  <Button size="sm" variant="secondary" onClick={() => setSelected(playlist)} icon={<ListVideo className="h-3 w-3" aria-hidden />}>Items</Button>
                  <button type="button" onClick={() => setDeleteTarget(playlist)} className="ml-auto rounded p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40" aria-label="Delete playlist">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Playlist items + import */}
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.title ?? 'Playlist'} size="xl">
        {selected ? <PlaylistItemsPanel playlist={selected} onImported={() => { setSelected(null); playlists.refetch(); }} /> : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove this playlist?"
        description="Only the playlist registration and its cached item list are removed. Lectures already imported are kept."
        confirmLabel="Remove playlist"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            await api.delete(`/api/admin/youtube/playlists/${deleteTarget.id}`);
            toast.success('Playlist removed');
            setDeleteTarget(null);
            playlists.refetch();
          } catch (err) { toast.error(errorMessage(err)); } finally { setDeleting(false); }
        }}
      />

      <p className="mt-4 text-[10.5px] text-slate-400">{classes.length} classes known · YouTube Data API v3 quota is cached server-side where possible.</p>
    </div>
  );
}

function PlaylistItemsPanel({ playlist, onImported }: { playlist: Playlist; onImported: () => void }) {
  const toast = useToast();
  const items = useApiQuery<{ items: PlaylistItem[] }>(`/api/admin/youtube/playlists/${playlist.id}/items`);
  const courses = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/courses', { pageSize: 100 });
  const seriesList = useApiQuery<Paginated<{ id: string; title: string }>>('/api/admin/lecture-series', { pageSize: 100 });
  const [courseId, setCourseId] = useState(playlist.courseId ?? '');
  const [seriesId, setSeriesId] = useState(playlist.seriesId ?? '');
  const [publish, setPublish] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = (items.data?.items ?? []).filter((item) => !search || item.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter videos" className="flex-1" />
        <span className="text-[11px] text-slate-500">{items.data?.items.length ?? 0} videos</span>
      </div>

      {items.loading ? <Spinner /> : !filtered.length ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-[12.5px] text-slate-500 dark:border-slate-700">
          <AlertCircle className="mx-auto mb-1 h-5 w-5 text-slate-300" aria-hidden />
          No videos cached. Press <strong>Sync</strong> on the playlist tile first.
        </div>
      ) : (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {filtered.slice(0, 200).map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-1.5">
              <img src={youtubeThumbnail(item.youtubeVideoId, 'default')} alt="" className="h-9 w-16 rounded object-cover" loading="lazy" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium">{item.title}</p>
                <p className="text-[10px] text-slate-500">{item.youtubeVideoId}{item.durationSeconds ? ` · ${formatDurationLabel(item.durationSeconds)}` : ''}</p>
              </div>
              {item.lectureId ? <Badge tone="success">imported</Badge> : <Badge tone="neutral">new</Badge>}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2 dark:border-slate-800">
        <select className="input" value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Target course">
          <option value="">Select course *</option>
          {(courses.data?.items ?? []).map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
        <select className="input" value={seriesId} onChange={(event) => setSeriesId(event.target.value)} aria-label="Target series">
          <option value="">Series (optional)</option>
          {(seriesList.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[12.5px] sm:col-span-2">
          <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
          Publish imported lectures immediately (otherwise they are saved as drafts)
        </label>
      </div>

      <Button
        loading={importing}
        disabled={!courseId || !items.data?.items.length}
        icon={<DownloadCloud className="h-4 w-4" aria-hidden />}
        onClick={async () => {
          setImporting(true);
          try {
            const result = await api.post<{ created: number; skipped: number; total: number }>(`/api/admin/youtube/playlists/${playlist.id}/import`, {
              courseId,
              seriesId: seriesId || undefined,
              publish,
            });
            toast.success(`Imported ${result.created} lectures (${result.skipped} duplicates skipped)`);
            onImported();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setImporting(false);
          }
        }}
      >
        Import all videos as lectures
      </Button>
    </div>
  );
}
