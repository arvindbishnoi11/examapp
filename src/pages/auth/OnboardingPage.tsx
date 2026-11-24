import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, GraduationCap, Target } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Alert, Spinner } from '@/components/ui';
import { appConfig } from '@/config';

type ClassItem = { id: string; name: string; slug: string; level: number };
type ExamItem = { id: string; name: string; slug: string; shortName: string | null };

const GOALS = [30, 60, 90, 120, 180];

export default function OnboardingPage() {
  useDocumentTitle('Set up your profile');
  const { user, completeOnboarding } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const classes = useApiQuery<{ items: ClassItem[] }>('/api/classes', undefined, { auth: false });
  const examTypes = useApiQuery<{ items: ExamItem[] }>('/api/exam-types', undefined, { auth: false });

  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState('');
  const [classId, setClassId] = useState('');
  const [examTypeId, setExamTypeId] = useState('');
  const [goal, setGoal] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setFullName(user.profile?.fullName ?? user.displayName ?? '');
    setClassId(user.profile?.classId ?? '');
    setExamTypeId(user.profile?.targetExamTypeId ?? '');
    setGoal(user.profile?.studyGoalMinutes ?? 60);
  }, [user]);

  // Sensible default: Class 12 for a student with no class yet.
  useEffect(() => {
    if (!classId && classes.data?.items.length) {
      const preferred = classes.data.items.find((c) => c.level === 12) ?? classes.data.items[classes.data.items.length - 1];
      setClassId(preferred.id);
    }
  }, [classes.data, classId]);

  const examOptions = useMemo(() => {
    const cls = classes.data?.items.find((c) => c.id === classId);
    const all = examTypes.data?.items ?? [];
    if (!cls) return all;
    // Board exam first, then competitive exams.
    return [...all].sort((a, b) => {
      const boardA = a.name.toLowerCase().includes('board') ? 0 : 1;
      const boardB = b.name.toLowerCase().includes('board') ? 0 : 1;
      return boardA - boardB || a.name.localeCompare(b.name);
    });
  }, [classes.data, examTypes.data, classId]);

  const finish = async () => {
    if (!fullName.trim() || !classId || !examTypeId) {
      setError('Please complete all three steps.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await completeOnboarding({ fullName: fullName.trim(), classId, targetExamTypeId: examTypeId, studyGoalMinutes: goal });
      toast.success('You are all set!');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <div className="container-app py-16"><Spinner /></div>;

  const cls = classes.data?.items.find((c) => c.id === classId);
  const exam = examTypes.data?.items.find((e) => e.id === examTypeId);
  const steps = ['Your name', 'Your class', 'Your goal'];

  return (
    <div className="container-app max-w-xl py-6 sm:py-10">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
          <GraduationCap className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div>
          <p className="font-display text-base font-bold">{appConfig.name}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Personalise your preparation</p>
        </div>
      </div>

      <div className="card p-5 sm:p-6">
        {/* Progress */}
        <div className="mb-5 flex gap-1.5">
          {steps.map((label, index) => (
            <div key={label} className="flex-1">
              <div className={`h-1.5 rounded-full ${index <= step ? 'bg-brand-600' : 'bg-slate-200 dark:bg-slate-800'}`} />
              <p className={`mt-1.5 text-[10.5px] font-semibold ${index <= step ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400'}`}>{label}</p>
            </div>
          ))}
        </div>

        {error ? <div className="mb-4"><Alert tone="error">{error}</Alert></div> : null}

        {step === 0 ? (
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold">What should we call you?</h1>
              <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">This appears on your profile and results.</p>
            </div>
            <div>
              <label className="label" htmlFor="fullName">Full name</label>
              <input
                id="fullName"
                className="input"
                value={fullName}
                maxLength={80}
                autoComplete="name"
                autoFocus
                onChange={(event) => setFullName(event.target.value)}
                placeholder="e.g. Ananya Sharma"
              />
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold">Which class are you in?</h1>
              <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">We show lectures and tests aligned to your syllabus.</p>
            </div>
            {classes.loading ? <Spinner /> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(classes.data?.items ?? []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setClassId(item.id)}
                    className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-left text-[13.5px] font-semibold transition ${
                      classId === item.id ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {item.name}
                    {classId === item.id ? <Check className="h-4 w-4" aria-hidden /> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold">What are you preparing for?</h1>
              <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">You can change this any time from your profile.</p>
            </div>
            {examTypes.loading ? <Spinner /> : (
              <div className="grid gap-2">
                {examOptions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setExamTypeId(item.id)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition ${
                      examTypeId === item.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/50' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    <Target className={`h-4 w-4 shrink-0 ${examTypeId === item.id ? 'text-brand-600' : 'text-slate-400'}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">{item.name}</span>
                      {item.shortName ? <span className="block text-[11px] text-slate-500">{item.shortName}</span> : null}
                    </span>
                    {examTypeId === item.id ? <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden /> : null}
                  </button>
                ))}
              </div>
            )}

            <div>
              <p className="label">Daily study goal</p>
              <div className="flex flex-wrap gap-1.5">
                {GOALS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => setGoal(minutes)}
                    className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold ${
                      goal === minutes ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {minutes} min
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </Button>
          {step < 2 ? (
            <Button
              onClick={() => {
                setError(null);
                if (step === 0 && !fullName.trim()) { setError('Please enter your name.'); return; }
                if (step === 1 && !classId) { setError('Please pick your class.'); return; }
                setStep((s) => s + 1);
              }}
              iconRight={<ArrowRight className="h-4 w-4" aria-hidden />}
            >
              Continue
            </Button>
          ) : (
            <Button onClick={finish} loading={saving} icon={<Check className="h-4 w-4" aria-hidden />}>
              Start preparing
            </Button>
          )}
        </div>
      </div>

      {step === 2 && (cls || exam) ? (
        <p className="mt-3 text-center text-[11.5px] text-slate-500 dark:text-slate-400">
          {cls?.name ?? '—'} · {exam?.name ?? '—'} · {goal} min/day
        </p>
      ) : null}
    </div>
  );
}
