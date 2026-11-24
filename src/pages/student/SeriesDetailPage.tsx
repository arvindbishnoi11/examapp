import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ListVideo, PlayCircle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { Thumb } from '@/components/ui/ContentCard';
import { formatDurationLabel } from '@/lib/format';

type SeriesDetail = {
  series: {
    id: string;
    title: string;
    description: string | null;
    thumbnailUrl: string | null;
    courseId: string;
    courseName: string | null;
    chapterName: string | null;
    lectureCount: number;
    totalMinutes: number;
    isFree: boolean;
  };
  lectures: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    lectureNumber: number | null;
    isFree: boolean;
    viewCount: number;
    youtubeVideoId: string;
  }[];
};

export default function SeriesDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApiQuery<SeriesDetail>(id ? `/api/lecture-series/${id}` : null, undefined, { auth: true });
  useDocumentTitle(data?.series?.title ?? 'Lecture series');

  if (loading && !data) return <div className="container-app py-10"><Spinner /></div>;
  if (error) return <div className="container-app py-10"><ErrorState message={error} onRetry={refetch} /></div>;
  if (!data) return null;

  return (
    <div className="container-app space-y-5 py-4 sm:py-6">
      <button type="button" onClick={() => history.back()} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-brand-600 dark:text-slate-400">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>

      <section className="overflow-hidden rounded-xl3 border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="grid sm:grid-cols-[280px_1fr]">
          <Thumb src={data.series.thumbnailUrl} alt={data.series.title} aspect="wide" className="!rounded-none" />
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap gap-1.5">
              {data.series.chapterName ? <Badge tone="brand">{data.series.chapterName}</Badge> : null}
              {data.series.isFree ? <Badge tone="success">Free</Badge> : null}
            </div>
            <h1 className="mt-2 font-display text-xl font-bold">{data.series.title}</h1>
            {data.series.description ? (
              <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">{data.series.description}</p>
            ) : null}
            <p className="mt-3 text-[12px] text-slate-500 dark:text-slate-400">
              {data.series.lectureCount} lectures · {Math.round(data.series.totalMinutes)} min
              {data.series.courseName ? ` · ${data.series.courseName}` : ''}
            </p>
            {data.lectures[0] ? (
              <Link to={`/lectures/${data.lectures[0].id}`} className="btn-primary mt-4 inline-flex">
                <PlayCircle className="h-4 w-4" aria-hidden /> Start series
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <ListVideo className="h-5 w-5 text-brand-600" aria-hidden /> Lectures
        </h2>
        {!data.lectures.length ? (
          <EmptyState title="No lectures published" description="This series does not have any published lectures yet." />
        ) : (
          <ol className="space-y-2">
            {data.lectures.map((lecture, index) => (
              <li key={lecture.id}>
                <Link to={`/lectures/${lecture.id}`} className="card flex items-center gap-3 p-2.5 transition hover:shadow-card-hover">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-[12px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {lecture.lectureNumber ?? index + 1}
                  </span>
                  <div className="relative w-24 shrink-0 sm:w-32">
                    <Thumb src={lecture.thumbnailUrl} alt="" aspect="video" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2-safe text-[13px] font-semibold leading-snug">{lecture.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {formatDurationLabel(lecture.durationSeconds) || 'Video'}
                      {lecture.isFree ? ' · Free' : ''}
                    </p>
                  </div>
                  <PlayCircle className="h-5 w-5 shrink-0 text-brand-500" aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
