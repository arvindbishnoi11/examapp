import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, ListVideo, Lock } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorState, Spinner } from '@/components/ui';
import { formatDurationLabel, formatRelative } from '@/lib/format';
import { youtubeEmbedUrl } from '@shared/youtube';

type LectureDetail = {
  lecture: {
    id: string;
    title: string;
    description: string | null;
    youtubeVideoId: string;
    thumbnailUrl: string | null;
    channelName: string | null;
    durationSeconds: number | null;
    lectureNumber: number | null;
    isFree: boolean;
    viewCount: number;
    publishedAt: string | null;
    createdAt: string;
    seriesId: string | null;
    seriesTitle: string | null;
    courseId: string | null;
    courseName: string | null;
    subjectName: string | null;
    chapterName: string | null;
    language: string;
    tags: string | null;
  };
  previous: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
  progress: { percent: number; lastPosition: number; completed: number };
  bookmarked: boolean;
};

export default function LectureDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { status } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<LectureDetail>(id ? `/api/lectures/${id}` : null, undefined, {
    auth: status === 'authenticated',
  });
  const [bookmarked, setBookmarked] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const lastSaved = useRef(0);

  useDocumentTitle(data?.lecture?.title ?? 'Lecture');

  useEffect(() => {
    if (data) setBookmarked(data.bookmarked);
  }, [data]);

  const saveProgress = useCallback(
    async (watchedSeconds: number, completed = false) => {
      if (!id || status !== 'authenticated') return;
      if (!completed && Math.abs(watchedSeconds - lastSaved.current) < 15) return;
      lastSaved.current = watchedSeconds;
      setSavingProgress(true);
      try {
        await api.post(`/api/lectures/${id}/progress`, { watchedSeconds, completed });
      } catch {
        /* progress is best-effort; never interrupt playback UI */
      } finally {
        setSavingProgress(false);
      }
    },
    [id, status],
  );

  // Resume from where the student stopped (client-side estimate; the authoritative
  // watched value is stored server-side and only grows).
  const startAt = data?.progress?.lastPosition && data.progress.lastPosition > 10 ? data.progress.lastPosition : undefined;

  const toggleBookmark = async () => {
    if (status !== 'authenticated') {
      toast.info('Sign in to save lectures.');
      return;
    }
    try {
      const result = await api.post<{ bookmarked: boolean }>('/api/bookmarks', { itemType: 'lecture', itemId: id });
      setBookmarked(result.bookmarked);
      toast.success(result.bookmarked ? 'Saved to your bookmarks' : 'Removed from bookmarks');
    } catch {
      toast.error('Could not update your bookmark. Please try again.');
    }
  };

  if (loading && !data) return <div className="container-app py-10"><Spinner /></div>;
  if (error) return <div className="container-app py-10"><ErrorState message={error} onRetry={refetch} /></div>;
  if (!data) return null;

  const { lecture } = data;
  const restricted = !lecture.isFree && status !== 'authenticated';

  return (
    <div className="container-app grid gap-5 py-4 sm:py-6 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-brand-600 dark:text-slate-400">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back
        </button>

        {/* Player */}
        <div className="overflow-hidden rounded-xl2 border border-slate-200 bg-black shadow-card dark:border-slate-800">
          {restricted ? (
            <div className="grid aspect-video place-items-center bg-slate-900 text-center text-white">
              <div className="px-6">
                <Lock className="mx-auto h-8 w-8 text-white/70" aria-hidden />
                <p className="mt-2 text-sm font-semibold">This lecture is for enrolled students</p>
                <Link to="/login" className="btn-primary mt-3 inline-flex">Sign in to continue</Link>
              </div>
            </div>
          ) : (
            <div className="relative aspect-video">
              <iframe
                key={lecture.youtubeVideoId}
                src={youtubeEmbedUrl(lecture.youtubeVideoId, { start: startAt, autoplay: false })}
                title={lecture.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                loading="lazy"
                className="absolute inset-0 h-full w-full"
              />
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {lecture.lectureNumber ? <Badge tone="brand">Lecture {lecture.lectureNumber}</Badge> : null}
              {lecture.isFree ? <Badge tone="success">Free</Badge> : null}
              {lecture.subjectName ? <Badge tone="neutral">{lecture.subjectName}</Badge> : null}
            </div>
            <h1 className="mt-1.5 font-display text-lg font-bold leading-snug sm:text-xl">{lecture.title}</h1>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
              {[
                lecture.channelName,
                formatDurationLabel(lecture.durationSeconds),
                `${lecture.viewCount.toLocaleString('en-IN')} views`,
                lecture.publishedAt ? formatRelative(lecture.publishedAt) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant={bookmarked ? 'soft' : 'secondary'}
              size="sm"
              icon={bookmarked ? <BookmarkCheck className="h-4 w-4" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
              onClick={toggleBookmark}
            >
              {bookmarked ? 'Saved' : 'Save'}
            </Button>
            {status === 'authenticated' ? (
              <Button variant="secondary" size="sm" onClick={() => saveProgress(Number(lecture.durationSeconds ?? 0) || 1, true)} loading={savingProgress}>
                Mark complete
              </Button>
            ) : null}
          </div>
        </div>

        {lecture.description ? (
          <div className="card p-4">
            <h2 className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">About this lecture</h2>
            <p className="prose-explanation mt-1.5 line-clamp-[12]">{lecture.description}</p>
          </div>
        ) : null}

        {/* Prev / next */}
        <div className="grid gap-2 sm:grid-cols-2">
          {data.previous ? (
            <Link to={`/lectures/${data.previous.id}`} className="card flex items-center gap-2 p-3 transition hover:shadow-card-hover">
              <ChevronLeft className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Previous</span>
                <span className="block truncate text-[13px] font-medium">{data.previous.title}</span>
              </span>
            </Link>
          ) : <div />}
          {data.next ? (
            <Link to={`/lectures/${data.next.id}`} className="card flex items-center justify-end gap-2 p-3 text-right transition hover:shadow-card-hover">
              <span className="min-w-0">
                <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Up next</span>
                <span className="block truncate text-[13px] font-medium">{data.next.title}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="space-y-3">
        {lecture.seriesId ? (
          <Link to={`/series/${lecture.seriesId}`} className="card flex items-center gap-2.5 p-3.5 transition hover:shadow-card-hover">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
              <ListVideo className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Part of series</span>
              <span className="block truncate text-[13px] font-semibold">{lecture.seriesTitle}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
          </Link>
        ) : null}

        {lecture.courseId ? (
          <Link to={`/courses/${lecture.courseId}`} className="card block p-3.5 transition hover:shadow-card-hover">
            <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Course</span>
            <span className="block truncate text-[13px] font-semibold">{lecture.courseName}</span>
            {lecture.chapterName ? <span className="mt-0.5 block truncate text-[11.5px] text-slate-500 dark:text-slate-400">{lecture.chapterName}</span> : null}
          </Link>
        ) : null}

        <div className="card p-4">
          <h2 className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">Study tip</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-400">
            Take notes while watching, then attempt the chapter test immediately — recall right after a lecture is when retention is highest.
          </p>
        </div>
      </aside>
    </div>
  );
}
