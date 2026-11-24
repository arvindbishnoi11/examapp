import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  Eye,
  MinusCircle,
  Target,
  Trophy,
  XCircle,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Badge, CardSkeletonGrid, ErrorState, ProgressBar, Spinner, Tabs } from '@/components/ui';
import { formatClock, formatDateTime, formatMarks, formatPercent } from '@/lib/format';
import type { ChapterBreakdown, ResultReview, ResultSummary, SubjectBreakdown } from '@shared/types';

type ResultPayload = ResultSummary & {
  message?: string;
  subjectBreakdown: SubjectBreakdown[] | null;
  chapterBreakdown: ChapterBreakdown[] | null;
  review: ResultReview | null;
};

const EVAL_TONE = {
  correct: 'text-emerald-600 dark:text-emerald-400',
  wrong: 'text-rose-600 dark:text-rose-400',
  partial: 'text-amber-600 dark:text-amber-400',
  unattempted: 'text-slate-400',
} as const;

const EVAL_LABEL = {
  correct: 'Correct',
  wrong: 'Incorrect',
  partial: 'Partial',
  unattempted: 'Not attempted',
} as const;

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApiQuery<ResultPayload>(id ? `/api/results/${id}` : null);
  const [tab, setTab] = useState<'summary' | 'questions'>('summary');
  const [filter, setFilter] = useState<'all' | 'correct' | 'wrong' | 'unattempted'>('all');

  useDocumentTitle(data?.examTitle ? `Result — ${data.examTitle}` : 'Result');

  const filteredQuestions = useMemo(() => {
    if (!data?.review?.length) return [];
    if (filter === 'all') return data.review;
    return data.review.filter((q) => q.evaluation === filter);
  }, [data, filter]);

  if (loading && !data) return <div className="container-app py-10"><Spinner /></div>;
  if (error) return <div className="container-app py-10"><ErrorState message={error} onRetry={refetch} /></div>;
  if (!data) return null;

  // Result exists but has not been released yet.
  if (data.isPublished === false) {
    return (
      <div className="container-app py-8">
        <Link to="/tests" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to tests
        </Link>
        <div className="card mx-auto mt-4 max-w-lg p-6 text-center">
          <Clock className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">Result not released yet</h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{data.message ?? 'Your answers were recorded. The result will be published by your institute.'}</p>
          <p className="mt-3 text-[11.5px] text-slate-500">Submitted {formatDateTime(data.computedAt)}</p>
        </div>
      </div>
    );
  }

  const scoreTone = data.percentage >= 70 ? 'text-emerald-600 dark:text-emerald-400' : data.percentage >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';

  return (
    <div className="container-app space-y-4 py-4 sm:py-6">
      <Link to="/tests" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-brand-600 dark:text-slate-400">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to tests
      </Link>

      {/* Score hero */}
      <section className="overflow-hidden rounded-xl3 bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 p-5 text-white shadow-float sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Result</p>
            <h1 className="mt-1 font-display text-xl font-bold leading-tight sm:text-2xl">{data.examTitle}</h1>
            <p className="mt-1 text-[12px] text-white/70">Evaluated {formatDateTime(data.computedAt)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold ${scoreTone}`}>
                {data.passed ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Target className="h-3.5 w-3.5" aria-hidden />}
                {data.passed ? 'Passed' : 'Keep practising'}
              </span>
              {data.rank ? <span className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1 text-[12px] font-semibold backdrop-blur"><Trophy className="h-3.5 w-3.5" aria-hidden /> Rank {data.rank}</span> : null}
              {data.percentile !== null ? <span className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1 text-[12px] font-semibold backdrop-blur"><Award className="h-3.5 w-3.5" aria-hidden /> {data.percentile.toFixed(1)} percentile</span> : null}
            </div>
          </div>
          <div className="text-right">
            <p className="font-display text-4xl font-extrabold tabular-nums leading-none">{Math.round(data.percentage)}<span className="text-2xl">%</span></p>
            <p className="mt-1 text-[12px] text-white/70">{formatMarks(data.score)} / {formatMarks(data.maxScore)} marks</p>
            <p className="text-[11px] text-white/60">Accuracy {formatPercent(data.accuracy)}</p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white transition-all" style={{ width: `${Math.min(100, Math.max(0, data.percentage))}%` }} />
        </div>
      </section>

      {/* Stat tiles */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { icon: CheckCircle2, label: 'Correct', value: data.correctCount, tone: 'text-emerald-600 dark:text-emerald-400' },
          { icon: XCircle, label: 'Incorrect', value: data.wrongCount, tone: 'text-rose-600 dark:text-rose-400' },
          { icon: MinusCircle, label: 'Unattempted', value: data.unattemptedCount, tone: 'text-slate-500' },
          { icon: Clock, label: 'Time taken', value: formatClock(data.timeSpentSeconds), tone: 'text-brand-600 dark:text-brand-400' },
        ].map((item) => (
          <div key={item.label} className="card p-3.5">
            <item.icon className={`h-4 w-4 ${item.tone}`} aria-hidden />
            <p className="mt-1 text-[17px] font-bold tabular-nums">{item.value}</p>
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</p>
          </div>
        ))}
      </section>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'summary', label: 'Analysis' },
          { value: 'questions', label: 'Solutions', count: data.review?.length ?? 0 },
        ]}
        className="max-w-sm"
      />

      {tab === 'summary' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><BarChart3 className="h-4 w-4 text-brand-600" aria-hidden /> Subject-wise performance</h2>
            {!data.subjectBreakdown?.length ? (
              <p className="text-[13px] text-slate-500">No subject breakdown available for this test.</p>
            ) : (
              <ul className="space-y-3.5">
                {data.subjectBreakdown.map((subject) => (
                  <li key={subject.subject}>
                    <div className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="truncate font-medium">{subject.subject || 'General'}</span>
                      <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                        {formatMarks(subject.score)}/{formatMarks(subject.maxScore)} · {Math.round(subject.accuracy)}% acc
                      </span>
                    </div>
                    <ProgressBar value={subject.maxScore ? (subject.score / subject.maxScore) * 100 : 0} className="mt-1.5" tone={subject.accuracy >= 70 ? 'success' : subject.accuracy >= 40 ? 'amber' : 'rose'} />
                    <p className="mt-1 text-[10.5px] text-slate-400">
                      {subject.correct} correct · {subject.wrong} wrong · {subject.unattempted} unattempted
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><Target className="h-4 w-4 text-brand-600" aria-hidden /> Chapter-wise focus areas</h2>
            {!data.chapterBreakdown?.length ? (
              <p className="text-[13px] text-slate-500">Attempt a chapter or topic test to see chapter-level analytics.</p>
            ) : (
              <ul className="space-y-2.5">
                {[...data.chapterBreakdown]
                  .sort((a, b) => a.accuracy - b.accuracy)
                  .slice(0, 8)
                  .map((chapter) => (
                    <li key={`${chapter.subject}-${chapter.chapter}`} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-medium">{chapter.chapter}</p>
                        <p className="text-[10.5px] text-slate-400">{chapter.subject} · {chapter.correct}/{chapter.total} correct</p>
                      </div>
                      <Badge tone={chapter.accuracy >= 70 ? 'success' : chapter.accuracy >= 40 ? 'warning' : 'danger'}>
                        {Math.round(chapter.accuracy)}%
                      </Badge>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {(['all', 'correct', 'wrong', 'unattempted'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] font-semibold capitalize ${filter === option ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'}`}
              >
                {option}
              </button>
            ))}
          </div>

          {!data.review ? (
            <p className="card p-4 text-[13px] text-slate-500">Detailed solutions are not available for this result.</p>
          ) : !filteredQuestions.length ? (
            <p className="card p-4 text-[13px] text-slate-500">No questions in this filter.</p>
          ) : (
            <ol className="space-y-3">
              {filteredQuestions.map((question, index) => (
                <li key={question.examQuestionId} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Q{index + 1} · {question.questionType.replace(/_/g, ' ')}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`text-[11.5px] font-bold ${EVAL_TONE[question.evaluation]}`}>{EVAL_LABEL[question.evaluation]}</span>
                      <Badge tone={question.marksAwarded > 0 ? 'success' : question.marksAwarded < 0 ? 'danger' : 'neutral'}>
                        {question.marksAwarded > 0 ? '+' : ''}{formatMarks(question.marksAwarded)}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed">{question.questionText}</p>
                  <ul className="mt-2 space-y-1.5">
                    {question.options.map((option) => {
                      const chosen = question.selectedOptions.includes(option.key);
                      return (
                        <li
                          key={option.key}
                          className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] ${
                            option.isCorrect
                              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                              : chosen
                                ? 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40'
                                : 'border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <span className="font-bold">{option.key}.</span>
                          <span className="min-w-0 flex-1">{option.text}</span>
                          {option.isCorrect ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : null}
                          {chosen && !option.isCorrect ? <XCircle className="h-4 w-4 shrink-0 text-rose-500" aria-hidden /> : null}
                        </li>
                      );
                    })}
                  </ul>
                  {question.numericAnswerValue !== null || question.correctInteger !== null ? (
                    <p className="mt-2 text-[12px]">
                      <span className="text-slate-500">Correct value:</span>{' '}
                      <strong>{question.correctInteger ?? question.numericAnswerValue}</strong>
                      {question.numericAnswer !== null ? <span className="text-slate-500"> · You: <strong>{question.numericAnswer}</strong></span> : null}
                    </p>
                  ) : null}
                  {question.explanation ? (
                    <div className="mt-2 rounded-lg bg-slate-50 p-2.5 text-[12.5px] leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                      <p className="mb-1 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400"><Eye className="h-3 w-3" aria-hidden /> Solution</p>
                      {question.explanation}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
