import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, FileText, PlayCircle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { ExamCardItem, Thumb } from '@/components/ui/ContentCard';
import type { ChapterRef, ExamCard, SubjectRef } from '@shared/types';

type CourseDetail = {
  course: {
    id: string;
    name: string;
    description: string | null;
    shortDescription: string | null;
    coverImageUrl: string | null;
    className: string | null;
    examTypeName: string | null;
    isFree: boolean;
    lectureCount: number;
    examCount: number;
    subjectCount: number;
    tags: string[] | null;
  };
  subjects: (SubjectRef & { lectureCount: number; chapterCount: number })[];
  lectureSeries: { id: string; title: string; description: string | null; thumbnailUrl: string | null; lectureCount: number; totalMinutes: number; isFree: boolean; chapterName: string | null }[];
  exams: ExamCard[];
  announcements: { id: string; title: string; body: string }[];
};

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApiQuery<CourseDetail>(id ? `/api/courses/${id}` : null, undefined, { auth: true });
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);

  useDocumentTitle(data?.course?.name ?? 'Course');

  const chapters = useApiQuery<{ items: ChapterRef[] }>(
    expandedSubject ? '/api/chapters' : null,
    { subjectId: expandedSubject ?? undefined },
    { auth: false, enabled: Boolean(expandedSubject) },
  );

  if (loading && !data) return <div className="container-app py-10"><Spinner /></div>;
  if (error) return <div className="container-app py-10"><ErrorState message={error} onRetry={refetch} /></div>;
  if (!data) return null;

  return (
    <div className="container-app space-y-5 py-4 sm:py-6">
      <Link to="/courses" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-brand-600 dark:text-slate-400">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All courses
      </Link>

      {/* Hero */}
      <section className="overflow-hidden rounded-xl3 border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-0 sm:grid-cols-[240px_1fr]">
          <div className="relative">
            <Thumb src={data.course.coverImageUrl} alt={data.course.name} aspect="square" className="!rounded-none sm:h-full" />
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap gap-1.5">
              {data.course.className ? <Badge tone="brand">{data.course.className}</Badge> : null}
              {data.course.examTypeName ? <Badge tone="neutral">{data.course.examTypeName}</Badge> : null}
              {data.course.isFree ? <Badge tone="success">Free</Badge> : null}
            </div>
            <h1 className="mt-2 font-display text-xl font-bold sm:text-2xl">{data.course.name}</h1>
            {data.course.description ? (
              <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-400">{data.course.description}</p>
            ) : data.course.shortDescription ? (
              <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-400">{data.course.shortDescription}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4" aria-hidden /> {data.course.subjectCount} subjects</span>
              <span className="inline-flex items-center gap-1.5"><PlayCircle className="h-4 w-4" aria-hidden /> {data.course.lectureCount} lectures</span>
              <span className="inline-flex items-center gap-1.5"><FileText className="h-4 w-4" aria-hidden /> {data.course.examCount} tests</span>
            </div>

            {data.course.tags?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.course.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">#{tag}</span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Subjects with chapters */}
      <section>
        <div className="section-title"><h2>Subjects &amp; chapters</h2></div>
        {!data.subjects.length ? (
          <EmptyState title="No subjects yet" description="This course has no subjects published." icon={<BookOpen className="h-6 w-6" aria-hidden />} />
        ) : (
          <div className="space-y-2">
            {data.subjects.map((subject) => {
              const isOpen = expandedSubject === subject.id;
              return (
                <div key={subject.id} className="card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedSubject(isOpen ? null : subject.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: subject.color || '#4f46e5' }}>
                      {subject.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold">{subject.name}</span>
                      <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">
                        {subject.chapterCount} chapters · {subject.lectureCount} lectures
                      </span>
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                  </button>
                  {isOpen ? (
                    <div className="border-t border-slate-100 px-2 py-1.5 dark:border-slate-800">
                      {chapters.loading ? (
                        <p className="px-3 py-3 text-xs text-slate-500">Loading chapters…</p>
                      ) : !chapters.data?.items.length ? (
                        <p className="px-3 py-3 text-xs text-slate-500">No chapters published for this subject yet.</p>
                      ) : (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                          {chapters.data.items.map((chapter) => (
                            <li key={chapter.id}>
                              <Link
                                to={`/lectures?chapterId=${chapter.id}`}
                                className="flex items-center gap-2 rounded-lg px-3 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium">{chapter.name}</span>
                                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                                    {chapter.lectureCount ?? 0} lectures · {chapter.examCount ?? 0} tests
                                  </span>
                                </span>
                                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Lecture series */}
      {data.lectureSeries.length ? (
        <section>
          <div className="section-title"><h2>Lecture series</h2></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.lectureSeries.map((series) => (
              <Link key={series.id} to={`/series/${series.id}`} className="card card-hover overflow-hidden">
                <Thumb src={series.thumbnailUrl} alt={series.title} aspect="wide" />
                <div className="p-3">
                  <p className="line-clamp-2-safe text-[13.5px] font-semibold leading-snug">{series.title}</p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {series.chapterName ? `${series.chapterName} · ` : ''}{series.lectureCount} lectures
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Exams */}
      {data.exams.length ? (
        <section>
          <div className="section-title"><h2>Tests in this course</h2></div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.exams.map((exam) => (
              <ExamCardItem key={exam.id} exam={exam} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
