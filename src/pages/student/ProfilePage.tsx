import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Bell,
  ChevronRight,
  Download,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Sun,
  Target,
  Trash2,
  Trophy,
  User,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { notificationPermission, pushSupport, registerForPush } from '@/lib/messaging';
import { Button } from '@/components/ui/Button';
import { Badge, ConfirmDialog, Alert, ErrorState, Modal, ProgressBar, Spinner, Tabs } from '@/components/ui';
import { formatDateTime, initials } from '@/lib/format';
import type { Paginated, ResultSummary } from '@shared/types';

type ProfileDashboard = {
  profile: {
    fullName: string | null;
    classId: string | null;
    className: string | null;
    targetExamTypeId: string | null;
    targetExamName: string | null;
    streakDays: number;
    studyGoalMinutes: number;
    onboardingCompleted: number | boolean;
    avatarUrl: string | null;
  } | null;
  stats: {
    lecturesCompleted: number;
    watchedMinutes: number;
    attempts: number;
    results: number;
    avgPercentage: number | null;
    bookmarks: number;
  };
  recentResults: { id: string; examTitle: string; percentage: number; isPublished: boolean; computedAt: string }[];
};

type ProgressPayload = {
  weekly: { date: string; lectures: number; seconds: number }[];
  subjects: { subject: string; lectures: number; completed: number }[];
  streakDays: number;
  studyGoalMinutes: number;
};

export default function ProfilePage({ initialTab = 'overview' }: { initialTab?: 'overview' | 'history' }) {
  useDocumentTitle('Profile');
  const { user, signOut, updateProfile, deleteAccount, status } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'history'>(initialTab);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const dashboard = useApiQuery<ProfileDashboard>('/api/student/dashboard', undefined, { enabled: status === 'authenticated' });
  const progress = useApiQuery<ProgressPayload>('/api/student/progress', undefined, { enabled: status === 'authenticated' });
  const results = useApiQuery<Paginated<ResultSummary>>('/api/results', { pageSize: 30 }, { enabled: status === 'authenticated' });

  const [prefs, setPrefs] = useState({ push: true, email: true, examReminders: true, newContent: true });
  useEffect(() => {
    if (user?.profile?.notificationPrefs) setPrefs(user.profile.notificationPrefs);
  }, [user?.profile?.notificationPrefs]);

  /**
   * "Push notifications" is the only preference that needs anything from the
   * browser. Turning it on requests permission (this runs inside the click, so
   * the gesture is preserved) and registers the device's FCM token; if the user
   * blocks it, we store the preference as off rather than pretending otherwise.
   */
  const setPushEnabled = async (enabled: boolean) => {
    if (!enabled) {
      void savePrefs({ ...prefs, push: false });
      return;
    }

    const support = pushSupport();
    if (support !== 'supported') {
      const reason: Record<string, string> = {
        'no-vapid-key': 'Push is not configured for this deployment (missing VAPID key).',
        'firebase-unconfigured': 'Push is unavailable because Firebase is not configured.',
        'unsupported-browser': 'This browser does not support web push.',
        'no-service-worker': 'This browser does not support service workers.',
      };
      toast.error(reason[support] ?? 'Push is not available on this device.');
      return;
    }

    const result = await registerForPush();
    if (!result.ok) {
      toast.error(
        result.reason?.startsWith('permission')
          ? 'Notifications are blocked. Allow them in your browser settings to receive exam reminders.'
          : 'Could not enable push notifications on this device.',
      );
      return;
    }
    void savePrefs({ ...prefs, push: true });
  };

  const savePrefs = async (next: typeof prefs) => {
    setPrefs(next);
    setSavingPrefs(true);
    try {
      await api.put('/api/notifications/preferences', { preferences: next });
      toast.success('Notification preferences updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingPrefs(false);
    }
  };

  if (status !== 'authenticated' || !user) {
    return <div className="container-app py-10"><Spinner label="Loading profile…" /></div>;
  }

  const displayName = user.profile?.fullName || user.displayName || user.email.split('@')[0];

  // Reflect what the browser actually allows, so the checkbox never lies.
  const pushCapability = pushSupport();
  const permission = notificationPermission();
  const pushHint =
    pushCapability === 'no-vapid-key'
      ? 'Not configured for this deployment yet.'
      : pushCapability === 'unsupported-browser' || pushCapability === 'firebase-unconfigured'
        ? 'This browser or deployment does not support web push.'
        : permission === 'denied'
          ? 'Blocked in your browser settings — in-app notifications still arrive.'
          : permission === 'granted'
            ? 'Exam reminders and new content arrive on this device.'
            : 'Turning this on will ask your browser for permission.';
  const maxWeekly = Math.max(1, ...(progress.data?.weekly ?? []).map((d) => Math.round(d.seconds / 60)));

  return (
    <div className="container-app space-y-4 py-4 sm:py-6">
      {/* Identity card */}
      <section className="card flex flex-wrap items-center gap-4 p-4 sm:p-5">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-600 text-xl font-bold text-white">
          {user.photoUrl ? <img src={user.photoUrl} alt="" className="h-full w-full object-cover" /> : initials(displayName, user.email)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="truncate font-display text-lg font-bold">{displayName}</h1>
            {user.isSuperAdmin ? <Badge tone="brand">Super Admin</Badge> : user.isStaff ? <Badge tone="neutral">Admin</Badge> : null}
            {user.emailVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Unverified</Badge>}
          </div>
          <p className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">{user.email}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
            {dashboard.data?.profile?.className ? <span>{dashboard.data.profile.className}</span> : null}
            {dashboard.data?.profile?.targetExamName ? <><span aria-hidden>·</span><span>Target: {dashboard.data.profile.targetExamName}</span></> : null}
            {dashboard.data?.profile?.streakDays ? <><span aria-hidden>·</span><span>{dashboard.data.profile.streakDays}-day streak 🔥</span></> : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={() => setEditOpen(true)}>Edit</Button>
          {user.isStaff ? <Link to="/admin" className="btn-primary btn-sm">Admin console</Link> : null}
        </div>
      </section>

      {!user.emailVerified ? (
        <Alert tone="warning" title="Verify your email">
          Check your inbox for the verification link, then refresh. Some content may require a verified account.{' '}
          <Link to="/verify-email" className="font-semibold underline">Resend verification</Link>
        </Alert>
      ) : null}

      {/* Stats */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: 'Lectures done', value: dashboard.data?.stats.lecturesCompleted ?? 0, icon: BookOpen },
          { label: 'Study time', value: `${dashboard.data?.stats.watchedMinutes ?? 0}m`, icon: Monitor },
          { label: 'Tests taken', value: dashboard.data?.stats.attempts ?? 0, icon: Target },
          { label: 'Avg score', value: dashboard.data?.stats.avgPercentage !== null && dashboard.data?.stats.avgPercentage !== undefined ? `${Math.round(dashboard.data.stats.avgPercentage)}%` : '—', icon: Trophy },
        ].map((item) => (
          <div key={item.label} className="card p-3.5">
            <item.icon className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden />
            <p className="mt-1 text-[17px] font-bold tabular-nums">{item.value}</p>
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</p>
          </div>
        ))}
      </section>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'overview', label: 'Overview' }, { value: 'history', label: 'Test history' }]}
        className="max-w-xs"
      />

      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Weekly study */}
          <section className="card p-4">
            <h2 className="mb-3 text-[15px] font-semibold">Last 28 days</h2>
            {progress.loading ? <Spinner /> : !progress.data?.weekly.length ? (
              <p className="text-[13px] text-slate-500">No study activity recorded yet. Watch a lecture to start your streak.</p>
            ) : (
              <>
                <div className="flex h-24 items-end gap-1">
                  {progress.data.weekly.map((day) => {
                    const minutes = Math.round(day.seconds / 60);
                    return (
                      <div key={day.date} className="group relative flex-1" title={`${day.date}: ${minutes} min`}>
                        <div className="rounded-t bg-brand-500/80 transition group-hover:bg-brand-600" style={{ height: `${Math.max(4, (minutes / maxWeekly) * 96)}px` }} />
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">
                  Goal: {progress.data.studyGoalMinutes} min/day · Streak {progress.data.streakDays} day(s)
                </p>
              </>
            )}
          </section>

          {/* Subject progress */}
          <section className="card p-4">
            <h2 className="mb-3 text-[15px] font-semibold">Subject progress</h2>
            {!progress.data?.subjects.length ? (
              <p className="text-[13px] text-slate-500">Watch lectures across subjects to see your progress here.</p>
            ) : (
              <ul className="space-y-2.5">
                {progress.data.subjects.slice(0, 6).map((subject) => {
                  const percent = subject.lectures ? (Number(subject.completed ?? 0) / Number(subject.lectures)) * 100 : 0;
                  return (
                    <li key={subject.subject}>
                      <div className="flex justify-between text-[12.5px]">
                        <span className="truncate font-medium">{subject.subject}</span>
                        <span className="text-slate-500">{subject.completed}/{subject.lectures}</span>
                      </div>
                      <ProgressBar value={percent} className="mt-1" />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : results.loading ? (
        <Spinner />
      ) : results.error ? (
        <ErrorState message={results.error} onRetry={results.refetch} />
      ) : !results.data?.items.length ? (
        <p className="card p-4 text-[13px] text-slate-500">You have not attempted any published test yet.</p>
      ) : (
        <div className="space-y-2">
          {results.data.items.map((result) => (
            <div key={result.id} className="card flex items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold">{result.examTitle}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{formatDateTime(result.computedAt)}</p>
              </div>
              {result.isPublished ? (
                <>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums">{Math.round(result.percentage)}%</p>
                    <p className="text-[10.5px] text-slate-500">{result.score}/{result.maxScore}</p>
                  </div>
                  <Link to={`/results/${result.id}`} className="btn-secondary btn-sm">View</Link>
                </>
              ) : (
                <Badge tone="warning">Not released</Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Settings */}
      <section className="card divide-y divide-slate-100 dark:divide-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-[13.5px] font-semibold">Appearance</p>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Reduce eye strain in low light.</p>
          </div>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {[
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value as 'light' | 'dark')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ${theme === option.value ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'}`}
              >
                <option.icon className="h-3.5 w-3.5" aria-hidden /> {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          <p className="mb-2 text-[13.5px] font-semibold">Notifications</p>
          <div className="space-y-2">
            {[
              { key: 'push' as const, label: 'Push notifications', hint: pushHint },
              { key: 'examReminders' as const, label: 'Exam reminders', hint: 'Reminders before scheduled tests.' },
              { key: 'newContent' as const, label: 'New lectures & papers', hint: 'When new content is published.' },
            ].map((item) => (
              <label key={item.key} className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-[12.5px] font-medium">{item.label}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">{item.hint}</span>
                </span>
                <input
                  type="checkbox"
                  checked={prefs[item.key]}
                  disabled={savingPrefs}
                  onChange={(event) =>
                   item.key === 'push'
                     ? void setPushEnabled(event.target.checked)
                     : void savePrefs({ ...prefs, [item.key]: event.target.checked })
                 }
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div>
            <p className="text-[13.5px] font-semibold">Account</p>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400">Sign out of this device or delete your account.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<LogOut className="h-3.5 w-3.5" aria-hidden />} onClick={async () => { await signOut(); navigate('/'); }}>
              Sign out
            </Button>
            <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          </div>
        </div>
      </section>

      <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete your account?"
        description="This removes your profile, progress and results from our records. This action cannot be undone. Your Firebase sign-in will also be deleted."
        confirmLabel="Delete my account"
        loading={deleting}
        tone="danger"
        onCancel={() => setDeleteOpen(false)}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setDeleting(true);
          let ok = false;
          try {
            ok = await deleteAccount();
          } catch {
            ok = false;
          }
          setDeleting(false);
          setDeleteOpen(false);
          if (ok) {
            toast.success('Your account has been deleted.');
            navigate('/');
          } else {
            toast.error('Could not delete the account. Please sign in again and retry.');
          }
        }}
      />
    </div>
  );
}

function EditProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    city: '',
    state: '',
    school: '',
    bio: '',
    studyGoalMinutes: 60,
  });

  useEffect(() => {
    if (!open || !user) return;
    setForm({
      fullName: user.profile?.fullName ?? user.displayName ?? '',
      city: user.profile?.city ?? '',
      state: user.profile?.state ?? '',
      school: user.profile?.school ?? '',
      bio: user.profile?.bio ?? '',
      studyGoalMinutes: user.profile?.studyGoalMinutes ?? 60,
    });
    setError(null);
  }, [open, user]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({
        fullName: form.fullName.trim(),
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        school: form.school.trim() || null,
        bio: form.bio.trim() || null,
        studyGoalMinutes: Number(form.studyGoalMinutes) || 60,
      });
      toast.success('Profile updated');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit profile"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={saving} onClick={submit}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <label className="label" htmlFor="fullName">Full name</label>
          <input id="fullName" className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} maxLength={80} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="city">City</label>
            <input id="city" className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={60} />
          </div>
          <div>
            <label className="label" htmlFor="state">State</label>
            <input id="state" className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} maxLength={60} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="school">School / coaching</label>
          <input id="school" className="input" value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor="goal">Daily study goal (minutes)</label>
          <input id="goal" type="number" min={15} max={720} className="input" value={form.studyGoalMinutes} onChange={(e) => setForm({ ...form, studyGoalMinutes: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label" htmlFor="bio">About you</label>
          <textarea id="bio" className="input min-h-[76px]" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={280} />
        </div>
      </div>
    </Modal>
  );
}
