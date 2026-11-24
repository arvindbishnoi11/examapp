import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Filter, Search, X } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button } from '@/components/ui/Button';
import { CardSkeletonGrid, EmptyState, ErrorState, Pagination } from '@/components/ui';
import { CourseCardItem } from '@/components/ui/ContentCard';
import type { CourseCard, Paginated } from '@shared/types';

type Taxonomy = { items: { id: string; name: string; level?: number; shortName?: string | null }[] };

export default function CoursesPage() {
  useDocumentTitle('Courses');
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const debounced = useDebouncedValue(query, 350);
  const [showFilters, setShowFilters] = useState(false);

  const classId = searchParams.get('classId') ?? '';
  const examTypeId = searchParams.get('examTypeId') ?? '';
  const free = searchParams.get('free') ?? '';
  const page = Number(searchParams.get('page') ?? 1) || 1;

  const classes = useApiQuery<Taxonomy>('/api/classes', undefined, { auth: false });
  const examTypes = useApiQuery<Taxonomy>('/api/exam-types', undefined, { auth: false });

  const courses = useApiQuery<Paginated<CourseCard>>(
    '/api/courses',
    { q: debounced.trim() || undefined, classId: classId || undefined, examTypeId: examTypeId || undefined, free: free === 'true' ? undefined : undefined, page, pageSize: 24 },
    { auth: false, deps: [debounced, classId, examTypeId, free, page] },
  );

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const activeFilters = [classId && 'Class', examTypeId && 'Exam', free === 'true' && 'Free'].filter(Boolean) as string[];

  return (
    <div className="container-app space-y-4 py-4 sm:py-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold sm:text-2xl">Courses</h1>
          <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">Structured courses by class and target examination.</p>
        </div>
        <Button variant="secondary" size="sm" icon={<Filter className="h-3.5 w-3.5" aria-hidden />} onClick={() => setShowFilters((v) => !v)} className="lg:hidden">
          Filters{activeFilters.length ? ` (${activeFilters.length})` : ''}
        </Button>
      </header>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search courses by name or topic"
          className="input pl-9"
          aria-label="Search courses"
        />
        {query ? (
          <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Clear search">
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        {/* Filters */}
        <aside className={`${showFilters ? 'block' : 'hidden'} space-y-4 lg:block`}>
          <div className="card p-3.5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Class</p>
            <div className="flex flex-wrap gap-1.5 lg:flex-col">
              <button type="button" onClick={() => updateParam('classId', '')} className={`rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition ${!classId ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                All classes
              </button>
              {(classes.data?.items ?? []).map((cls) => (
                <button
                  key={cls.id}
                  type="button"
                  onClick={() => updateParam('classId', cls.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition ${classId === cls.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                >
                  {cls.name}
                </button>
              ))}
            </div>
          </div>

          <div className="card p-3.5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Examination</p>
            <div className="flex flex-wrap gap-1.5 lg:flex-col">
              <button type="button" onClick={() => updateParam('examTypeId', '')} className={`rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition ${!examTypeId ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                All exams
              </button>
              {(examTypes.data?.items ?? []).map((exam) => (
                <button
                  key={exam.id}
                  type="button"
                  onClick={() => updateParam('examTypeId', exam.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition ${examTypeId === exam.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                >
                  {exam.name}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Results */}
        <div>
          {courses.loading && !courses.data ? (
            <CardSkeletonGrid count={6} />
          ) : courses.error ? (
            <ErrorState message={courses.error} onRetry={courses.refetch} />
          ) : !courses.data?.items.length ? (
            <EmptyState
              title="No courses found"
              description={debounced ? `Nothing matches “${debounced}”. Try another search or clear the filters.` : 'No published courses yet for this selection.'}
              icon={<BookOpen className="h-6 w-6" aria-hidden />}
              action={
                activeFilters.length ? (
                  <Button variant="secondary" size="sm" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {courses.data.items.map((course) => (
                  <CourseCardItem key={course.id} course={course} />
                ))}
              </div>
              <Pagination
                page={courses.data.page}
                totalPages={courses.data.totalPages}
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
