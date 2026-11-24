import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Flag,
  LayoutGrid,
  LogOut,
  Send,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, ErrorState, Spinner } from '@/components/ui';
import { ExamTimer } from '@/components/exam/ExamTimer';
import { ExamPalette, statusFor } from '@/components/exam/ExamPalette';
import { QuestionBody, type DraftAnswer } from '@/components/exam/QuestionBody';
import { clearPending, enqueue, readPending, writePending } from '@/lib/offlineQueue';
import type { AnswerPayload, ExamSession, SavedAnswer } from '@shared/types';

type SessionResponse = ExamSession | { submitted: true; attemptId: string; status: string; resultId: string | null };

const EMPTY_DRAFT: DraftAnswer = {
  selectedOptions: [],
  numericAnswer: null,
  integerAnswer: null,
  status: 'not_answered',
};

const AUTOSAVE_DELAY_MS = 2500;

function draftFromSaved(saved: SavedAnswer | undefined): DraftAnswer {
  if (!saved) return { ...EMPTY_DRAFT };
  return {
    selectedOptions: saved.selectedOptions,
    numericAnswer: saved.numericAnswer,
    integerAnswer: saved.integerAnswer,
    status: saved.status,
  };
}

export default function ExamAttemptPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [session, setSession] = useState<ExamSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitQuit, setSubmitQuit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expired, setExpired] = useState(false);
  const [serverNowMs, setServerNowMs] = useState(Date.now());
  const [sectionFilter, setSectionFilter] = useState<string>('all');

  const dirtyRef = useRef<Set<string>>(new Set());
  const draftsRef = useRef<Record<string, DraftAnswer>>({});
  const savingRef = useRef(false);
  const submittedRef = useRef(false);
  const startedAtRef = useRef(Date.now());
  const questionEnteredAtRef = useRef(Date.now());

  useDocumentTitle(session ? `${session.exam.title} — attempt` : 'Exam');

  draftsRef.current = drafts;
  dirtyRef.current = dirty;

  // ---- Load session --------------------------------------------------------
  useEffect(() => {
    if (!attemptId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await api.get<SessionResponse>(`/api/exams/attempts/${attemptId}`);
        if (cancelled) return;
        if ('submitted' in result) {
          toast.info('This attempt has already been submitted.');
          navigate(result.resultId ? `/results/${result.resultId}` : '/tests', { replace: true });
          return;
        }
        setSession(result);
        setServerNowMs(result.serverNowMs);
        startedAtRef.current = Date.now();

        const initialDrafts: Record<string, DraftAnswer> = {};
        const initialVisited = new Set<string>();
        for (const question of result.questions) {
          const saved = result.answers.find((a) => a.examQuestionId === question.examQuestionId);
          initialDrafts[question.examQuestionId] = draftFromSaved(saved);
          if (saved) initialVisited.add(question.examQuestionId);
        }

        // Replay previously queued (offline) answers that never reached the server.
        const pending = readPending(attemptId);
        for (const [examQuestionId, payload] of Object.entries(pending)) {
          if (!initialDrafts[examQuestionId]) continue;
          initialDrafts[examQuestionId] = {
            selectedOptions: payload.selectedOptions ?? [],
            numericAnswer: payload.numericAnswer ?? null,
            integerAnswer: payload.integerAnswer ?? null,
            status: payload.status,
          };
        }
        setDrafts(initialDrafts);
        setVisited(initialVisited);
        if (Object.keys(pending).length) {
          setDirty(new Set(Object.keys(pending)));
          toast.info('Restored unsaved answers from this device.');
        }
        if (result.questions.length) {
          setVisited((current) => new Set(current).add(result.questions[0].examQuestionId));
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // ---- Online / offline detection -----------------------------------------
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Leave-site protection ----------------------------------------------
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (submittedRef.current) return;
      event.preventDefault();
      event.returnValue = 'Your exam is still in progress. Leave anyway?';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // ---- Autosave -----------------------------------------------------------
  const buildPayload = useCallback(
    (ids: string[], sessionData: ExamSession, currentDrafts: Record<string, DraftAnswer>): AnswerPayload[] => {
      const order = new Map(sessionData.questions.map((q) => [q.examQuestionId, q.questionId]));
      return ids
        .filter((id) => order.has(id))
        .map((id) => {
          const draft = currentDrafts[id] ?? EMPTY_DRAFT;
          return {
            examQuestionId: id,
            questionId: order.get(id),
            selectedOptions: draft.selectedOptions,
            numericAnswer: draft.numericAnswer,
            integerAnswer: draft.integerAnswer,
            status: draft.status,
            timeSpentSeconds: Math.round((Date.now() - startedAtRef.current) / 1000),
          } as AnswerPayload & { questionId?: string };
        });
    },
    [],
  );

  const flush = useCallback(async () => {
    if (!attemptId || !session || savingRef.current || submittedRef.current) return;
    const ids = Array.from(dirtyRef.current);
    if (!ids.length) return;
    const payloads = buildPayload(ids, session, draftsRef.current);
    if (!payloads.length) return;

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    // Persist locally first so nothing is lost if this request dies.
    enqueue(attemptId, payloads);
    try {
      await api.post(`/api/exams/attempts/${attemptId}/answers`, { answers: payloads });
      clearPending(attemptId, ids);
      setDirty((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
      setLastSavedAt(new Date());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Deadline passed or already submitted — stop saving and submit.
        if (err.code === 'attempt_expired' || err.code === 'already_submitted') {
          setExpired(true);
          return;
        }
      }
      if (err instanceof ApiError && err.status === 401) {
        setSaveError('Your session expired. Sign in again — answers are kept on this device.');
      } else {
        setSaveError(errorMessage(err));
      }
      const pending = readPending(attemptId);
      writePending(attemptId, { ...pending, ...Object.fromEntries(payloads.map((p) => [p.examQuestionId, p])) });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [attemptId, session, buildPayload]);

  useEffect(() => {
    if (!dirty.size) return;
    const timer = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, flush]);

  // Save when the tab is hidden (student switches apps on a phone).
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [flush]);

  // ---- Heartbeat: keep server clock authoritative --------------------------
  useEffect(() => {
    if (!session || submittedRef.current) return;
    const interval = window.setInterval(async () => {
      try {
        const beat = await api.post<{ serverNowMs: number; expiresAtMs: number; shouldSubmit: boolean; status: string }>(
          `/api/exams/attempts/${attemptId}/heartbeat`,
        );
        setServerNowMs(beat.serverNowMs);
        if (beat.shouldSubmit || beat.status !== 'in_progress') {
          setExpired(true);
          setSession((current) => (current ? { ...current, expiresAtMs: beat.expiresAtMs, serverNowMs: beat.serverNowMs } : current));
        }
      } catch {
        /* transient; the timer still enforces locally */
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [attemptId, session]);

  // ---- Submit ------------------------------------------------------------
  const submit = useCallback(
    async (reason: 'manual' | 'timer') => {
      if (!attemptId || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        await flush();
      } catch {
        /* best effort — server still evaluates what it has */
      }
      try {
        const outcome = await api.post<{ attemptId: string; status: string; resultId: string | null; resultVisible: boolean }>(
          `/api/exams/attempts/${attemptId}/submit`,
        );
        clearPending(attemptId);
        if (outcome.resultId && outcome.resultVisible) {
          toast.success(reason === 'timer' ? 'Time is up — your test was submitted.' : 'Test submitted successfully.');
          navigate(`/results/${outcome.resultId}`, { replace: true });
        } else {
          toast.success(
            reason === 'timer'
              ? 'Time is up — your answers were submitted. Results will be released by your institute.'
              : 'Answers submitted. Results will be released by your institute.',
          );
          navigate('/tests', { replace: true });
        }
      } catch (err) {
        submittedRef.current = false;
        if (err instanceof ApiError && err.status === 409) {
          // Already submitted elsewhere; go to the result if we can.
          toast.info('This attempt was already submitted.');
          navigate('/tests', { replace: true });
          return;
        }
        if (!navigator.onLine) {
          toast.error('You are offline. Reconnect to submit — your answers are saved on this device.');
        } else {
          toast.error(errorMessage(err));
        }
        setSubmitting(false);
        setSubmitQuit(false);
      }
    },
    [attemptId, flush, navigate, toast],
  );

  // ---- Expiry handler ----------------------------------------------------
  const onExpire = useCallback(() => {
    if (submittedRef.current) return;
    setExpired(true);
    setPaletteOpen(false);
    toast.warning('Time is up. Submitting your test…');
    void submit('timer');
  }, [submit, toast]);

  // ---- Navigation --------------------------------------------------------
  const questions = session?.questions ?? [];
  const orderedQuestions = useMemo(() => {
    const filtered = sectionFilter === 'all' ? questions : questions.filter((q) => q.sectionId === sectionFilter);
    return filtered.map((q) => ({ ...q, questionNumber: questions.findIndex((item) => item.examQuestionId === q.examQuestionId) + 1 }));
  }, [questions, sectionFilter]);

  const current = orderedQuestions[Math.min(index, Math.max(0, orderedQuestions.length - 1))];

  useEffect(() => {
    if (!current) return;
    setVisited((existing) => (existing.has(current.examQuestionId) ? existing : new Set(existing).add(current.examQuestionId)));
    questionEnteredAtRef.current = Date.now();
  }, [current?.examQuestionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchCurrent = (patch: Partial<DraftAnswer>) => {
    if (!current || expired) return;
    setDrafts((existing) => ({
      ...existing,
      [current.examQuestionId]: { ...(existing[current.examQuestionId] ?? EMPTY_DRAFT), ...patch },
    }));
    setDirty((existing) => new Set(existing).add(current.examQuestionId));
  };

  const toggleMark = () => {
    if (!current) return;
    const draft = drafts[current.examQuestionId] ?? EMPTY_DRAFT;
    const marked = draft.status === 'marked_for_review' || draft.status === 'answered_marked';
    const hasAnswer = draft.selectedOptions.length > 0 || draft.numericAnswer !== null || draft.integerAnswer !== null;
    patchCurrent({ status: marked ? (hasAnswer ? 'answered' : 'not_answered') : hasAnswer ? 'answered_marked' : 'marked_for_review' });
  };

  const goTo = (nextIndex: number) => {
    setIndex(Math.max(0, Math.min(orderedQuestions.length - 1, nextIndex)));
    setPaletteOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  // ---- Derived counts ----------------------------------------------------
  const answersMap = useMemo(() => {
    const result: Record<string, SavedAnswer> = {};
    for (const [id, draft] of Object.entries(drafts)) {
      const question = questions.find((q) => q.examQuestionId === id);
      result[id] = {
        examQuestionId: id,
        selectedOptions: draft.selectedOptions,
        numericAnswer: draft.numericAnswer,
        integerAnswer: draft.integerAnswer,
        status: draft.status,
        timeSpentSeconds: question ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0,
      };
    }
    return result;
  }, [drafts, questions]);

  const summary = useMemo(() => {
    let answered = 0;
    let marked = 0;
    let unanswered = 0;
    for (const question of questions) {
      const status: string = statusFor(answersMap[question.examQuestionId], visited.has(question.examQuestionId));
      if (status === 'answered' || status === 'answered_marked') answered += 1;
      if (status === 'marked' || status === 'answered_marked') marked += 1;
      if (status === 'not_answered' || status === 'not_visited' || status === 'marked') unanswered += 1;
    }
    return { answered, marked, unanswered };
  }, [answersMap, questions, visited]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Preparing your test…" />
      </div>
    );
  }

  if (loadError || !session || !current) {
    return (
      <div className="container-app py-12">
        <ErrorState message={loadError ?? 'This attempt could not be loaded.'} onRetry={() => window.location.reload()} />
        <div className="mt-4 text-center">
          <Button variant="secondary" onClick={() => navigate('/tests')}>Back to tests</Button>
        </div>
      </div>
    );
  }

  const draft = drafts[current.examQuestionId] ?? EMPTY_DRAFT;
  const sectionList = session.sections.length ? session.sections : [];

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 dark:bg-slate-950">
      {/* ---- Sticky exam header ------------------------------------------- */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight" title={session.exam.title}>{session.exam.title}</p>
            <p className="flex items-center gap-1.5 text-[10.5px] text-slate-500 dark:text-slate-400">
              {online ? <Wifi className="h-3 w-3 text-emerald-500" aria-hidden /> : <WifiOff className="h-3 w-3 text-rose-500" aria-hidden />}
              {saving ? 'Saving…' : saveError ? 'Not saved' : lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Autosave on'}
              <span aria-hidden>·</span>
              Attempt {session.attemptNumber}
            </p>
          </div>
          <ExamTimer expiresAtMs={session.expiresAtMs} serverNowMs={serverNowMs} onExpire={onExpire} paused={expired || submitting} />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded-lg border border-slate-200 p-2 text-slate-600 dark:border-slate-700 dark:text-slate-300 lg:hidden"
            aria-label="Open question palette"
          >
            <LayoutGrid className="h-5 w-5" aria-hidden />
          </button>
          <Button size="sm" variant="soft" icon={<Send className="h-3.5 w-3.5" aria-hidden />} onClick={() => setConfirmOpen(true)} disabled={submitting}>
            <span className="hidden sm:inline">Submit</span>
          </Button>
        </div>
        {saveError ? (
          <div className="flex items-center gap-1.5 bg-rose-50 px-3 py-1 text-[11px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {saveError}
          </div>
        ) : null}
        {!online ? (
          <div className="bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            You are offline. Answers are stored on this device and will sync when you reconnect.
          </div>
        ) : null}
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-4 px-3 py-4 sm:px-5 lg:grid-cols-[1fr_300px]">
        {/* ---- Question ---------------------------------------------------- */}
        <section className="min-w-0">
          {sectionList.length > 1 ? (
            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => { setSectionFilter('all'); setIndex(0); }}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${sectionFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'}`}
              >
                All {questions.length}
              </button>
              {sectionList.map((section) => {
                const count = questions.filter((q) => q.sectionId === section.id).length;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => { setSectionFilter(section.id); setIndex(0); }}
                    className={`whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${sectionFilter === section.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'}`}
                  >
                    {section.title} <span className="opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="card p-4 sm:p-6">
            <QuestionBody
              question={current}
              index={questions.findIndex((q) => q.examQuestionId === current.examQuestionId)}
              total={questions.length}
              draft={draft}
              onChange={patchCurrent}
              readOnly={expired || submitting}
            />
          </div>

          {/* ---- Question actions --------------------------------------- */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" aria-hidden />} onClick={() => goTo(index - 1)} disabled={index === 0}>
              Previous
            </Button>
            <Button
              variant={draft.status === 'marked_for_review' || draft.status === 'answered_marked' ? 'soft' : 'secondary'}
              icon={<Flag className="h-4 w-4" aria-hidden />}
              onClick={toggleMark}
              disabled={expired}
            >
              {draft.status === 'marked_for_review' || draft.status === 'answered_marked' ? 'Unmark' : 'Mark for review'}
            </Button>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => { void flush(); setConfirmOpen(true); }} disabled={submitting}>
                Submit
              </Button>
              <Button iconRight={<ChevronRight className="h-4 w-4" aria-hidden />} onClick={() => goTo(index + 1)} disabled={index >= orderedQuestions.length - 1}>
                Save &amp; next
              </Button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>{summary.answered} answered · {summary.unanswered} remaining</span>
            <span className="inline-flex items-center gap-1">
              <LogOut className="h-3 w-3" aria-hidden /> Leaving this page is safe — your progress is saved.
            </span>
          </div>
        </section>

        {/* ---- Desktop palette ----------------------------------------- */}
        <aside className="hidden lg:block">
          <div className="card sticky top-[76px] p-4">
            <h2 className="mb-2.5 text-[12px] font-bold uppercase tracking-wider text-slate-400">Question palette</h2>
            <ExamPalette
              questions={questions.map((q, i) => ({ examQuestionId: q.examQuestionId, questionNumber: i + 1, sectionId: q.sectionId }))}
              answers={answersMap}
              visited={visited}
              currentIndex={questions.findIndex((q) => q.examQuestionId === current.examQuestionId)}
              onJump={goTo}
              sections={sectionList.length ? sectionList : [{ id: '__all__', title: 'Questions' }].map((s) => s.id === '__all__' ? s : s)}
            />
            <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-[11.5px] dark:border-slate-800">
              <p className="flex justify-between"><span className="text-slate-500">Answered</span><strong>{summary.answered}</strong></p>
              <p className="flex justify-between"><span className="text-slate-500">Marked</span><strong>{summary.marked}</strong></p>
              <p className="flex justify-between"><span className="text-slate-500">Not answered</span><strong>{summary.unanswered}</strong></p>
            </div>
          </div>
        </aside>
      </main>

      {/* ---- Mobile palette drawer ------------------------------------ */}
      {paletteOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Question palette">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setPaletteOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-sm overflow-y-auto bg-white p-4 shadow-xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Questions</h2>
              <button type="button" onClick={() => setPaletteOpen(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close palette">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <ExamPalette
              questions={questions.map((q, i) => ({ examQuestionId: q.examQuestionId, questionNumber: i + 1, sectionId: q.sectionId }))}
              answers={answersMap}
              visited={visited}
              currentIndex={questions.findIndex((q) => q.examQuestionId === current.examQuestionId)}
              onJump={goTo}
              sections={sectionList}
            />
            <Button fullWidth className="mt-4" icon={<Send className="h-4 w-4" aria-hidden />} onClick={() => { setPaletteOpen(false); setConfirmOpen(true); }}>
              Submit test
            </Button>
          </div>
        </div>
      ) : null}

      {/* ---- Submit confirmation ------------------------------------- */}
      <ConfirmDialog
        open={confirmOpen}
        title="Submit your test?"
        confirmLabel="Submit test"
        cancelLabel="Keep solving"
        loading={submitting}
        tone="primary"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          setSubmitQuit(true);
          void submit('manual');
        }}
        description={
          <div className="space-y-2">
            <p>You cannot change answers after submitting.</p>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center dark:bg-slate-800">
              <div><p className="text-lg font-bold text-emerald-600">{summary.answered}</p><p className="text-[10px] font-semibold uppercase text-slate-500">Answered</p></div>
              <div><p className="text-lg font-bold text-violet-600">{summary.marked}</p><p className="text-[10px] font-semibold uppercase text-slate-500">Marked</p></div>
              <div><p className="text-lg font-bold text-rose-600">{summary.unanswered}</p><p className="text-[10px] font-semibold uppercase text-slate-500">Unanswered</p></div>
            </div>
            {summary.unanswered > 0 ? <p className="text-[12px] text-amber-700 dark:text-amber-300">{summary.unanswered} question(s) are still unanswered.</p> : null}
          </div>
        }
      />

      {expired && !submitQuit ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/70 p-4 backdrop-blur-sm">
          <div className="card max-w-sm p-6 text-center">
            <AlertTriangle className="mx-auto h-9 w-9 text-rose-500" aria-hidden />
            <h2 className="mt-2 text-lg font-semibold">Time is up</h2>
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
              The examination window has closed. Submitting your saved answers now.
            </p>
            <Button className="mt-4" loading={submitting} onClick={() => { setSubmitQuit(true); void submit('timer'); }}>
              Submit now
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
