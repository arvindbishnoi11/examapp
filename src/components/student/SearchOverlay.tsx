import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BookOpen, FileText, Loader2, PlayCircle, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatDurationLabel } from '@/lib/format';

type SearchResults = {
  courses: { id: string; name: string; className?: string | null; coverImageUrl?: string | null }[];
  lectures: { id: string; title: string; thumbnailUrl?: string | null; durationSeconds?: number | null; subjectName?: string | null }[];
  exams: { id: string; title: string; examKind: string; durationMinutes: number; totalQuestions: number }[];
  papers: { id: string; title: string; year?: number | null }[];
};

const EMPTY: SearchResults = { courses: [], lectures: [], exams: [], papers: [] };

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 280);
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults(EMPTY);
      setError(null);
    } else {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const term = debounced.trim();
    if (term.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<SearchResults>('/api/search', { q: term }, { auth: true, retries: 1 })
      .then((data) => {
        if (!cancelled) {
          setResults({
            courses: data.courses ?? [],
            lectures: data.lectures ?? [],
            exams: data.exams ?? [],
            papers: data.papers ?? [],
          });
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Search is unavailable right now. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  const total = useMemo(
    () => results.courses.length + results.lectures.length + results.exams.length + results.papers.length,
    [results],
  );

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[75] bg-slate-900/50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Search PrepSetu">
      <div className="mx-auto mt-0 flex h-full max-w-2xl flex-col bg-white dark:bg-slate-950 sm:mt-[6vh] sm:h-auto sm:max-h-[80vh] sm:rounded-2xl sm:shadow-float">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <Search className="h-4 w-4 text-slate-400" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search lectures, courses, tests, papers…"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
            aria-label="Search query"
            autoComplete="off"
          />
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden /> : null}
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close search">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {error ? <p className="px-2 py-6 text-center text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

          {!error && query.trim().length < 2 ? (
            <p className="px-2 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Type at least two characters. Try “kinematics”, “NEET” or “mock”.
            </p>
          ) : null}

          {!error && query.trim().length >= 2 && !loading && total === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No results for “{query.trim()}”. Try a different subject or chapter.
            </p>
          ) : null}

          {results.lectures.length ? (
            <section className="mb-3">
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Lectures</p>
              {results.lectures.map((lecture) => (
                <Link key={lecture.id} to={`/lectures/${lecture.id}`} onClick={onClose} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-900">
                  {lecture.thumbnailUrl ? (
                    <img src={lecture.thumbnailUrl} alt="" className="h-10 w-16 rounded-md object-cover" loading="lazy" />
                  ) : (
                    <span className="grid h-10 w-16 place-items-center rounded-md bg-slate-100 dark:bg-slate-800"><PlayCircle className="h-4 w-4 text-slate-400" aria-hidden /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{lecture.title}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {[lecture.subjectName, formatDurationLabel(lecture.durationSeconds)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {results.courses.length ? (
            <section className="mb-3">
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Courses</p>
              {results.courses.map((course) => (
                <Link key={course.id} to={`/courses/${course.id}`} onClick={onClose} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-900">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300"><BookOpen className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{course.name}</span>
                    {course.className ? <span className="block text-xs text-slate-500 dark:text-slate-400">{course.className}</span> : null}
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {results.exams.length ? (
            <section className="mb-3">
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Tests</p>
              {results.exams.map((exam) => (
                <Link key={exam.id} to={`/tests/${exam.id}`} onClick={onClose} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-900">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><FileText className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{exam.title}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {exam.durationMinutes} min · {exam.totalQuestions} questions
                    </span>
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {results.papers.length ? (
            <section>
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Papers</p>
              {results.papers.map((paper) => (
                <Link key={paper.id} to={`/papers/${paper.id}`} onClick={onClose} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-900">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300"><FileText className="h-4 w-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{paper.title}</span>
                    {paper.year ? <span className="block text-xs text-slate-500 dark:text-slate-400">{paper.year}</span> : null}
                  </span>
                </Link>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
