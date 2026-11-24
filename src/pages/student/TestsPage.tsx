import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ClipboardList, History, Trophy } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { Badge, EmptyState, ErrorState, Pagination, Skeleton, Tabs } from '@/components/ui';
import { ExamCardItem } from '@/components/ui/ContentCard';
import { formatDateTime } from '@/lib/format';
import type { AttemptHistoryItem, ExamCard, Paginated } from '@shared/types';

const KINDS = [
  { value: '', label: 'All' },
  { value: 'practice', label: 'Practice' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'full_mock', label: 'Full mock' },
  { value: 'previous_year', label: 'Previous year' },
  { value: 'board', label: 'Board' },
];

export default function TestsPage() {
  useDocumentTitle('Tests');
  const { status } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<'available' | 'history'>('available');
  const kind = searchParams.get('kind') ?? '';
  const page = Number(searchParams.get('page') ?? 1) || 1;

  const exams = useApiQuery<Paginated<ExamCard>>(
    '/api/exams',
    { kind: kind || undefined, page, pageSize: 20 },
    { auth: status === 'authenticated', deps: [kind, page], enabled: tab === 'available' },
  );

  const history = useApiQuery<Paginated<AttemptHistoryItem>>(
    '/api/exams/attempts',
    { page, pageSize: 20 },
    { auth: true, enabled: tab === 'history' && status === 'authenticated' },
  );

  return (
    <div className="container-app space-y-4 py-4 sm:py-6">
      <div>
        <h1 className="font-display text-xl font-bold sm:text-2xl">Tests &amp; Mock exams</h1>
        <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">Practice with timed tests and see where you stand.</p>
      </div>

      <Tabs
        value={tab}
        onChange={(value) => { setTab(value); setSearchParams(new URLSearchParams(), { replace: true }); }}
        tabs={[
          { value: 'available', label: 'Available tests' },
          { value: 'history', label: 'My attempts' },
        ]}
        className="max-w-sm"
      />

      {tab === 'available' ? (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {KINDS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  if (option.value) next.set('kind', option.value);
                  else next.delete('kind');
                  next.delete('page');
                  setSearchParams(next, { replace: true });
                }}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition ${
                  kind === option.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {exams.loading && !exams.data ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl2" />)}
            </div>
          ) : exams.error ? (
            <ErrorState message={exams.error} onRetry={exams.refetch} />
          ) : !exams.data?.items.length ? (
            <EmptyState title="No tests available" description="No published examinations match this filter yet." icon={<ClipboardList className="h-6 w-6" aria-hidden />} />
          ) : (
            <>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {exams.data.items.map((exam) => <ExamCardItem key={exam.id} exam={exam} />)}
              </div>
              <Pagination page={exams.data.page} totalPages={exams.data.totalPages} onChange={(next) => {
                const params = new URLSearchParams(searchParams);
                params.set('page', String(next));
                setSearchParams(params);
              }} />
            </>
          )}
        </>
      ) : status !== 'authenticated' ? (
        <EmptyState title="Sign in to see your attempts" description="Your test history is stored securely against your account." action={<Link to="/login?next=/tests" className="btn-primary">Sign in</Link>} icon={<History className="h-6 w-6" aria-hidden />} />
      ) : history.loading && !history.data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl2" />)}</div>
      ) : history.error ? (
        <ErrorState message={history.error} onRetry={history.refetch} />
      ) : !history.data?.items.length ? (
        <EmptyState title="No attempts yet" description="Attempt your first test to see results, accuracy and rank here." action={<Link to="/tests" className="btn-primary" onClick={() => setTab('available')}>Browse tests</Link>} icon={<ClipboardList className="h-6 w-6" aria-hidden />} />
      ) : (
        <div className="space-y-2">
          {history.data.items.map((attempt) => (
            <div key={attempt.attemptId} className="card flex items-center gap-3 p-3.5">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${attempt.status === 'in_progress' ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300'}`}>
                {attempt.status === 'in_progress' ? <History className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold">{attempt.examTitle}</p>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  {attempt.status === 'in_progress' ? 'In progress — resume to continue' : `Submitted ${formatDateTime(attempt.submittedAt)}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {attempt.status === 'in_progress' ? (
                  <Link to={`/attempts/${attempt.attemptId}`} className="btn-primary btn-sm">Resume</Link>
                ) : attempt.resultPublished && attempt.percentage !== null ? (
                  <>
                    <p className="text-sm font-bold tabular-nums">{Math.round(attempt.percentage)}%</p>
                    <Link to={attempt.resultId ? `/results/${attempt.resultId}` : `/results?examId=${attempt.examId}`} className="text-[11px] font-semibold text-brand-600">View result</Link>
                  </>
                ) : (
                  <Badge tone="warning">Awaiting result</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
