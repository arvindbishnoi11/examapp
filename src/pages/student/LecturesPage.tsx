import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ListFilter, PlayCircle, Search, X } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button } from '@/components/ui/Button';
import { CardSkeletonGrid, EmptyState, ErrorState, Pagination, Tabs } from '@/components/ui';
import { LectureCardItem } from '@/components/ui/ContentCard';
import type { ChapterRef, LectureCard, Paginated, SubjectRef } from '@shared/types';

type CourseOption = { id: string; name: string; className: string | null };

export default function LecturesPage() {
  useDocumentTitle('Lectures');
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const debounced = useDebouncedValue(query, 350);
  const [sort, setSort] = useState<'recent' | 'popular' | 'oldest'>('recent');
  const [showFilters, setShowFilters] = useState(false);

  const courseId = searchParams.get('courseId') ?? '';
  const subjectId = searchParams.get('subjectId') ?? '';
  const chapterId = searchParams.get('chapterId') ?? '';
  const page = Number(searchParams.get('page') ?? 1) || 1;

  const courses = useApiQuery<Paginated<CourseOption>>('/api/courses', { pageSize: 60 }, { auth: false });
  const subjects = useApiQuery<{ items: SubjectRef[] }>('/api/subjects', { courseId: courseId || undefined }, { auth: false, enabled: Boolean(courseId) });
  const chapters = useApiQuery<{ items: ChapterRef[] }>(
    '/api/chapters',
    { subjectId: subjectId || undefined, courseId: !subjectId && courseId ? courseId : undefined },
    { auth: false, enabled: Boolean(subjectId || courseId) },
  );

  const lectures = useApiQuery<Paginated<LectureCard>>(
    '/api/lectures',
    {
      q: debounced.trim() || undefined,
      courseId: courseId || undefined,
      subjectId: subjectId || undefined,
      chapterId: chapterId || undefined,
      sort,
      page,
      pageSize: 24,
    },
    { auth: true, deps: [debounced, courseId, subjectId, chapterId, sort, page] },
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'courseId') {
      next.delete('subjectId');
      next.delete('chapterId');
    }
    if (key === 'subjectId') next.delete('chapterId');
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const filterCount = [courseId, subjectId, chapterId].filter(Boolean).length;

  return (
    <div className="container-app space-y-4 py-4 sm:py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold sm:text-2xl">Lectures</h1>
          <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">Watch chapter-wise video lectures anytime.</p>
        </div>
        <Button variant="secondary" size="sm" icon={<ListFilter className="h-3.5 w-3.5" aria-hidden />} onClick={() => setShowFilters((v) => !v)} className="lg:hidden">
          Filters{filterCount ? ` (${filterCount})` : ''}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search lectures"
            className="input pl-9"
            aria-label="Search lectures"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Clear search">
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
        <Tabs
          value={sort}
          onChange={(value) => setSort(value)}
          tabs={[
            { value: 'recent', label: 'Latest' },
            { value: 'popular', label: 'Popular' },
            { value: 'oldest', label: 'First' },
          ]}
          className="shrink-0"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <aside className={`${showFilters ? 'block' : 'hidden'} space-y-3 lg:block`}>
          <div className="card p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Course</p>
              {filterCount ? (
                <button type="button" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })} className="text-[11px] font-semibold text-brand-600">
                  Clear
                </button>
              ) : null}
            </div>
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              <button type="button" onClick={() => setParam('courseId', '')} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] ${!courseId ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                All courses
              </button>
              {(courses.data?.items ?? []).map((course) => (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => setParam('courseId', course.id)}
                  className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] ${courseId === course.id ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                >
                  {course.name}
                </button>
              ))}
            </div>
          </div>

          {courseId && subjects.data?.items.length ? (
            <div className="card p-3.5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Subject</p>
              <div className="space-y-0.5">
                <button type="button" onClick={() => setParam('subjectId', '')} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] ${!subjectId ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'}`}>
                  All subjects
                </button>
                {subjects.data.items.map((subject) => (
                  <button
                    key={subject.id}
                    type="button"
                    onClick={() => setParam('subjectId', subject.id)}
                    className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] ${subjectId === subject.id ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'}`}
                  >
                    {subject.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {(subjectId || courseId) && chapters.data?.items.length ? (
            <div className="card p-3.5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Chapter</p>
              <div className="max-h-64 space-y-0.5 overflow-y-auto">
                <button type="button" onClick={() => setParam('chapterId', '')} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] ${!chapterId ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'}`}>
                  All chapters
                </button>
                {chapters.data.items.map((chapter) => (
                  <button
                    key={chapter.id}
                    type="button"
                    onClick={() => setParam('chapterId', chapter.id)}
                    className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] ${chapterId === chapter.id ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'}`}
                  >
                    {chapter.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <div>
          {lectures.loading && !lectures.data ? (
            <CardSkeletonGrid count={6} />
          ) : lectures.error ? (
            <ErrorState message={lectures.error} onRetry={lectures.refetch} />
          ) : !lectures.data?.items.length ? (
            <EmptyState
              title="No lectures found"
              description={debounced ? `Nothing matches “${debounced}”.` : 'No lectures published yet for this selection.'}
              icon={<PlayCircle className="h-6 w-6" aria-hidden />}
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {lectures.data.items.map((lecture) => (
                  <LectureCardItem key={lecture.id} lecture={lecture} progressPercent={lecture.progressPercent} />
                ))}
              </div>
              <Pagination
                page={lectures.data.page}
                totalPages={lectures.data.totalPages}
                onChange={(next) => {
                  const params = new URLSearchParams(searchParams);
                  params.set('page', String(next));
                  setSearchParams(params);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
