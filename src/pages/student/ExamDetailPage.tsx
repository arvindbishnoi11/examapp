import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileQuestion,
  Info,
  ListChecks,
  Lock,
  Play,
  RotateCcw,
  Trophy,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { api, errorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, ErrorState, Spinner } from '@/components/ui';
import { formatDateTime, formatMarks } from '@/lib/format';
import type { AttemptHistoryItem, ExamSession, Paginated } from '@shared/types';

type ExamOverview = {
  exam: {
    id: string;
    title: string;
    description: string | null;
    instructions: string | null;
    examKind: string;
    durationMinutes: number;
    totalMarks: number;
    totalQuestions: number;
    negativeMarks: number;
    negativeMarkingEnabled: boolean;
    startAt: string | null;
    endAt: string | null;
    maxAttempts: number;
    isFree: boolean;
    status: string;
    resultPublishMode: string;
    passingPercentage: number;
    courseName: string | null;
    examTypeName: string | null;
    subjectName: string | null;
  };
  sections: { id: string; title: string; instructions: string | null; isOptional: boolean; sortOrder: number; subjectName: string | null; questionCount: number }[];
};

const KIND_LABELS: Record<string, string> = {
  practice: 'Practice',
  chapter: 'Chapter test',
  topic: 'Topic test',
  full_mock: 'Full mock',
  previous_year: 'Previous year',
  board: 'Board',
  custom: 'Custom',
};

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { status, user } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<ExamOverview>(id ? `/api/exams/${id}` : null, undefined, {
    auth: status === 'authenticated',
  });
  const attempts = useApiQuery<Paginated<AttemptHistoryItem>>('/api/exams/attempts', { pageSize: 50 }, {
    auth: true,
    enabled: status === 'authenticated',
  });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useDocumentTitle(data?.exam?.title ?? 'Test');

  if (loading && !data) return <div className="container-app py-10"><Spinner /></div>;
  if (error) return <div className="container-app py-10"><ErrorState message={error} onRetry={refetch} /></div>;
  if (!data) return null;

  const { exam, sections } = data;
  const myAttempts = (attempts.data?.items ?? []).filter((a) => a.examId === exam.id);
  const live = myAttempts.find((a) => a.status === 'in_progress');
  const completed = myAttempts.filter((a) => a.status !== 'in_progress' && a.status !== 'abandoned');
  const attemptsLeft = Math.max(0, exam.maxAttempts - completed.length);
  const now = Date.now();
  const notYetOpen = exam.startAt ? Date.parse(exam.startAt) > now : false;
  const closed = exam.endAt ? Date.parse(exam.endAt) < now : false;
  const canAttempt = Boolean(user) && !closed && !notYetOpen && attemptsLeft > 0 && exam.status !== 'archived';
  const best = completed.reduce<number | null>((acc, a) => (a.score === null ? acc : acc === null ? a.score : Math.max(acc, a.score)), null);

  const begin = async () => {
    if (status !== 'authenticated') {
      navigate(`/login?next=${encodeURIComponent(`/tests/${exam.id}`)}`);
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const session = await api.post<ExamSession & { resumed?: boolean }>(`/api/exams/${exam.id}/start`);
      toast.success(session.resumed ? 'Resuming your attempt' : 'Good luck! Timer has started.');
      navigate(`/attempts/${session.attemptId}`, { replace: true });
    } catch (err) {
      setStartError(errorMessage(err));
      setStarting(false);
    }
  };

  return (
    <div className="container-app space-y-4 py-4 sm:py-6">
      <Link to="/tests" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-brand-600 dark:text-slate-400">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All tests
      </Link>

      <section className="rounded-xl3 border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="brand">{KIND_LABELS[exam.examKind] ?? exam.examKind}</Badge>
          {exam.examTypeName ? <Badge tone="neutral">{exam.examTypeName}</Badge> : null}
          {exam.isFree ? <Badge tone="success">Free</Badge> : null}
          {notYetOpen ? <Badge tone="warning">Starts {formatDateTime(exam.startAt)}</Badge> : null}
          {closed ? <Badge tone="danger">Closed</Badge> : null}
        </div>
        <h1 className="mt-2 font-display text-xl font-bold leading-tight sm:text-2xl">{exam.title}</h1>
        {exam.description ? (
          <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-400">{exam.description}</p>
        ) : null}

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: FileQuestion, label: 'Questions', value: exam.totalQuestions },
            { icon: Clock, label: 'Duration', value: `${exam.durationMinutes} min` },
            { icon: Trophy, label: 'Total marks', value: formatMarks(exam.totalMarks) },
            { icon: RotateCcw, label: 'Attempts left', value: `${Math.max(0, attemptsLeft)}/${exam.maxAttempts}` },
          ].map((item) => (
            <div key={item.label} className="surface-muted px-3 py-2.5">
              <item.icon className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden />
              <dd className="mt-1 text-[15px] font-bold tabular-nums">{item.value}</dd>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</dt>
            </div>
          ))}
        </dl>

        {exam.negativeMarkingEnabled ? (
          <p className="mt-3 inline-flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Negative marking is enabled: {exam.negativeMarks} mark(s) are deducted for each wrong answer.
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {live ? (
            <Button size="lg" icon={<Play className="h-4 w-4" aria-hidden />} onClick={() => navigate(`/attempts/${live.attemptId}`)}>
              Resume attempt ({live.status === 'in_progress' ? 'in progress' : live.status})
            </Button>
          ) : canAttempt ? (
            <Button size="lg" icon={<Play className="h-4 w-4" aria-hidden />} loading={starting} onClick={begin}>
              {status === 'authenticated' ? `Start test${attemptsLeft < exam.maxAttempts ? ` (attempt ${completed.length + 1})` : ''}` : 'Sign in to start'}
            </Button>
          ) : status !== 'authenticated' ? (
            <Button size="lg" icon={<Lock className="h-4 w-4" aria-hidden />} onClick={() => navigate(`/login?next=/tests/${exam.id}`)}>
              Sign in to attempt
            </Button>
          ) : closed ? (
            <Alert tone="warning" title="This test window has closed">You can no longer start a new attempt.</Alert>
          ) : notYetOpen ? (
            <Alert tone="info" title="Not open yet">This test opens on {formatDateTime(exam.startAt)}.</Alert>
          ) : attemptsLeft === 0 ? (
            <Alert tone="warning" title="No attempts remaining">You have used all {exam.maxAttempts} allowed attempts for this test.</Alert>
          ) : null}

          {best !== null ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Best score: {formatMarks(best)} / {formatMarks(exam.totalMarks)}
            </div>
          ) : null}
        </div>
        {startError ? <div className="mt-3"><Alert tone="error">{startError}</Alert></div> : null}
        {exam.startAt || exam.endAt ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
            <Calendar className="h-3.5 w-3.5" aria-hidden /> Window: {formatDateTime(exam.startAt)} → {formatDateTime(exam.endAt)}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><Info className="h-4 w-4 text-brand-600" aria-hidden /> Instructions</h2>
          {exam.instructions ? (
            <div className="prose-explanation whitespace-pre-line text-[13px]">{exam.instructions}</div>
          ) : (
            <ul className="list-inside list-disc space-y-1.5 text-[13px] text-slate-600 dark:text-slate-400">
              <li>The timer starts the moment you press Start and cannot be paused.</li>
              <li>Answers are saved automatically; you may refresh or return later and resume.</li>
              <li>The test submits automatically when the timer reaches zero.</li>
              <li>Do not open multiple tabs — only the latest saved answers are kept.</li>
            </ul>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><ListChecks className="h-4 w-4 text-brand-600" aria-hidden /> Sections</h2>
          {!sections.length ? (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">This test has no sections. All questions appear in a single list.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {sections.map((section) => (
                <li key={section.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{section.title}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      {section.questionCount} questions{section.subjectName ? ` · ${section.subjectName}` : ''}{section.isOptional ? ' · Optional' : ''}
                    </span>
                  </span>
                  <Badge tone="neutral">{section.questionCount}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {myAttempts.length ? (
        <section className="card p-4">
          <h2 className="mb-2 text-[15px] font-semibold">Your attempts</h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {myAttempts.map((attempt) => (
              <li key={attempt.attemptId} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {attempt.status === 'in_progress' ? 'In progress' : formatDateTime(attempt.submittedAt)}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {attempt.score !== null ? `${formatMarks(attempt.score)} / ${formatMarks(attempt.maxScore)} · ${Math.round(attempt.percentage ?? 0)}%` : 'Submitted'}
                  </p>
                </div>
                {attempt.status === 'in_progress' ? (
                  <Link to={`/attempts/${attempt.attemptId}`} className="btn-primary btn-sm">Resume</Link>
                ) : attempt.resultPublished ? (
                  <Link to={attempt.resultId ? `/results/${attempt.resultId}` : `/results?examId=${exam.id}`} className="text-[12px] font-semibold text-brand-600">See result</Link>
                ) : (
                  <Badge tone="warning">Awaiting result</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
