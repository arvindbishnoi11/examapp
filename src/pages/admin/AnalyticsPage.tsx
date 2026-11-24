import { useMemo, useState } from 'react';
import { Activity, BarChart3, BookOpen, GraduationCap, Target, TrendingUp } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Badge, EmptyState, Skeleton } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { PageHeader, Panel } from '@/components/admin/AdminUI';
import { formatNumber, formatDate } from '@/lib/format';
import type { Paginated } from '@shared/types';

type Overview = {
  rangeDays: number;
  signupsTrend: { date: string; signups: number }[];
  attemptsTrend: { date: string; attempts: number; avgPercentage: number | null }[];
  engagement: { activeLearners?: number; lectureSessions?: number; attemptCount?: number; testTakers?: number; avgScore?: number | null };
  subjectPerformance: { subject: string; attempts: number; avgPercentage: number | null; avgAccuracy: number | null }[];
  topLectures: { id: string; title: string; views: number; recentViewers: number }[];
  lectureCompletionRate: number;
  generatedAt: string;
};

type ExamAnalytics = {
  summary: { attempts?: number; students?: number; avgPercentage?: number | null; minPercentage?: number | null; maxPercentage?: number | null };
  distribution: { bucket: string; count: number }[];
  hardestQuestions: { id: string; question: string; wrong: number; exposure: number }[];
  easiestQuestions: { id: string; question: string; correct: number; exposure: number }[];
};

const RANGES = [7, 30, 90, 180];

function Sparkline({ data, color = 'bg-brand-500/80' }: { data: { label: string; value: number }[]; color?: string }) {
  if (!data.length) return <p className="text-[12px] text-slate-500">No data for this range.</p>;
  const max = Math.max(1, ...data.map((point) => point.value));
  return (
    <div>
      <div className="flex h-24 items-end gap-0.5">
        {data.map((point) => (
          <div key={point.label} className="group relative flex-1" title={`${point.label}: ${point.value}`}>
            <div className={`rounded-t ${color} transition group-hover:opacity-80`} style={{ height: `${Math.max(3, (point.value / max) * 96)}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{formatDate(data[0]?.label)}</span>
        <span>{formatDate(data[data.length - 1]?.label)}</span>
      </div>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  useDocumentTitle('Analytics');
  const [days, setDays] = useState(30);
  const params = new URLSearchParams(window.location.search);
  const initialExamId = params.get('examId') ?? '';
  const [examId, setExamId] = useState(initialExamId);

  const overview = useApiQuery<Overview>('/api/admin/analytics/overview', { days }, { deps: [days] });
  const exams = useApiQuery<Paginated<{ id: string; title: string; attemptCount: number }>>('/api/admin/exams', { pageSize: 100 });
  const exam = useApiQuery<ExamAnalytics>(examId ? `/api/admin/analytics/exam/${examId}` : null, undefined, { enabled: Boolean(examId), deps: [examId] });
  const active = useApiQuery<{ rangeDays: number; trend: { date: string; activeStudents: number }[] }>('/api/admin/analytics/students/active', { days: Math.min(90, days) }, { deps: [days] });

  const distributionTotal = useMemo(() => (exam.data?.distribution ?? []).reduce((sum, bucket) => sum + Number(bucket.count), 0), [exam.data]);

  const engagement = overview.data?.engagement ?? {};

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Engagement, learning outcomes and examination performance across the platform."
        onRefresh={() => { overview.refetch(); active.refetch(); if (examId) exam.refetch(); }}
        refreshing={overview.loading}
        actions={
          <div className="flex gap-1">
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setDays(range)}
                className={`rounded-lg px-2 py-1 text-[11.5px] font-semibold ${days === range ? 'bg-brand-600 text-white' : 'border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
              >
                {range}d
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
        {[
          { label: 'Active learners', value: formatNumber(engagement.activeLearners ?? 0), icon: <Activity className="h-4 w-4" aria-hidden /> },
          { label: 'Test takers', value: formatNumber(engagement.testTakers ?? 0), icon: <GraduationCap className="h-4 w-4" aria-hidden /> },
          { label: 'Attempts', value: formatNumber(engagement.attemptCount ?? 0), icon: <Target className="h-4 w-4" aria-hidden /> },
          { label: 'Avg score', value: `${engagement.avgScore ?? 0}%`, icon: <TrendingUp className="h-4 w-4" aria-hidden /> },
          { label: 'Lecture completion', value: `${overview.data?.lectureCompletionRate ?? 0}%`, icon: <BookOpen className="h-4 w-4" aria-hidden /> },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl2 border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{tile.label}</p>
              <span className="rounded-md bg-brand-50 p-1 text-brand-600 dark:bg-brand-950/60">{tile.icon}</span>
            </div>
            <p className="mt-1.5 text-[17px] font-bold tabular-nums">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title={`New students (${days}d)`}>
          {overview.loading && !overview.data ? <Skeleton className="h-28" /> : (
            <Sparkline data={(overview.data?.signupsTrend ?? []).map((point) => ({ label: point.date, value: Number(point.signups) }))} />
          )}
        </Panel>
        <Panel title={`Attempts (${days}d)`}>
          {overview.loading && !overview.data ? <Skeleton className="h-28" /> : (
            <Sparkline data={(overview.data?.attemptsTrend ?? []).map((point) => ({ label: point.date, value: Number(point.attempts) }))} color="bg-emerald-500/80" />
          )}
        </Panel>
        <Panel title="Daily active students">
          {active.loading && !active.data ? <Skeleton className="h-28" /> : (
            <Sparkline data={(active.data?.trend ?? []).map((point) => ({ label: point.date, value: Number(point.activeStudents) }))} color="bg-violet-500/80" />
          )}
        </Panel>
        <Panel title="Subject performance">
          {!overview.data?.subjectPerformance.length ? (
            <p className="text-[12px] text-slate-500">No subject-linked results in this range.</p>
          ) : (
            <ul className="space-y-1.5">
              {overview.data.subjectPerformance.map((row) => (
                <li key={row.subject} className="flex items-center gap-2 text-[12px]">
                  <span className="w-28 shrink-0 truncate">{row.subject}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Number(row.avgPercentage ?? 0))}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-[10.5px] tabular-nums text-slate-500">{row.avgPercentage ?? 0}% · {row.attempts}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <Panel title="Most watched lectures">
          {!overview.data?.topLectures.length ? (
            <p className="text-[12px] text-slate-500">No lecture views recorded yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {overview.data.topLectures.map((lecture, index) => (
                <li key={lecture.id} className="flex items-start gap-2 text-[12px]">
                  <span className="w-4 shrink-0 text-[10.5px] font-bold text-slate-400">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{lecture.title}</span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-slate-500">{formatNumber(lecture.views)} views</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Examination deep dive">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select className="input h-9 w-auto min-w-[200px] py-0 text-[13px]" value={examId} onChange={(event) => setExamId(event.target.value)} aria-label="Select examination">
              <option value="">Select an examination…</option>
              {(exams.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            {exam.data ? (
              <Button size="sm" variant="secondary" onClick={() => exam.refetch()}>Refresh</Button>
            ) : null}
          </div>

          {!examId ? (
            <p className="text-[12px] text-slate-500">Choose an examination to see attempt distribution and the hardest/easiest questions.</p>
          ) : exam.loading && !exam.data ? (
            <Skeleton className="h-32" />
          ) : !exam.data?.summary.attempts ? (
            <EmptyState title="No attempts yet" description="Students have not attempted this examination." icon={<BarChart3 className="h-5 w-5" aria-hidden />} />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[['Attempts', exam.data.summary.attempts], ['Students', exam.data.summary.students], ['Average', `${exam.data.summary.avgPercentage ?? 0}%`], ['Range', `${exam.data.summary.minPercentage ?? 0}–${exam.data.summary.maxPercentage ?? 0}%`]].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="text-[13px] font-semibold tabular-nums">{String(value)}</p>
                  </div>
                ))}
              </div>

              <div>
                <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Score distribution</p>
                <ul className="space-y-1">
                  {[...exam.data.distribution].sort((a, b) => String(b.bucket).localeCompare(String(a.bucket))).map((bucket) => (
                    <li key={bucket.bucket} className="flex items-center gap-2 text-[11.5px]">
                      <span className="w-16 shrink-0 tabular-nums text-slate-500">{bucket.bucket}%</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${distributionTotal ? (Number(bucket.count) / distributionTotal) * 100 : 0}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right tabular-nums">{bucket.count}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Hardest questions</p>
                  {!exam.data.hardestQuestions.length ? <p className="text-[11.5px] text-slate-500">—</p> : (
                    <ul className="space-y-1">
                      {exam.data.hardestQuestions.slice(0, 5).map((question) => (
                        <li key={question.id} className="text-[11.5px]">
                          <p className="line-clamp-2">{question.question}</p>
                          <p className="text-[10px] text-slate-500">{question.wrong}/{question.exposure} wrong</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Easiest questions</p>
                  {!exam.data.easiestQuestions.length ? <p className="text-[11.5px] text-slate-500">—</p> : (
                    <ul className="space-y-1">
                      {exam.data.easiestQuestions.slice(0, 5).map((question) => (
                        <li key={question.id} className="text-[11.5px]">
                          <p className="line-clamp-2">{question.question}</p>
                          <p className="text-[10px] text-slate-500">{question.correct}/{question.exposure} correct</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-slate-400">
        <Badge tone="neutral">UTC</Badge> All ranges are UTC days. Data generated {overview.data?.generatedAt ? formatDate(overview.data.generatedAt) : '—'}.
      </p>
    </div>
  );
}
