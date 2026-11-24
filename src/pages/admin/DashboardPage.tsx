import { Link } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  FileQuestion,
  FileText,
  GraduationCap,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Table2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { Badge, ErrorState, ProgressBar, Skeleton, StatTile } from '@/components/ui';
import { Panel, PageHeader } from '@/components/admin/AdminUI';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import type { DashboardStats } from '@shared/types';

type SystemStatus = {
  sheetsConfigured: boolean;
  youtubeConfigured: boolean;
  firebaseAdminConfigured: boolean;
  superAdminEmail: string | null;
  environment: string;
};

function TrendBars({ data, label }: { data: { date: string; count: number }[]; label: string }) {
  if (!data.length) return <p className="text-[12px] text-slate-500">No data in the last 30 days.</p>;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div>
      <div className="flex h-24 items-end gap-0.5" role="img" aria-label={label}>
        {data.map((point) => (
          <div key={point.date} className="group relative flex-1" title={`${formatDate(point.date)}: ${point.count}`}>
            <div className="rounded-t bg-brand-500/80 transition group-hover:bg-brand-600" style={{ height: `${Math.max(3, (point.count / max) * 96)}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{formatDate(data[0]?.date)}</span>
        <span>{formatDate(data[data.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  useDocumentTitle('Admin dashboard');
  const { user, isSuperAdmin } = useAuth();
  const { data, loading, error, refetch } = useApiQuery<DashboardStats>('/api/admin/dashboard');
  const system = useApiQuery<SystemStatus>('/api/admin/system/status');

  if (error) {
    return <div className="container-app py-6"><ErrorState message={error} onRetry={refetch} /></div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Welcome${user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}`}
        description="Live platform health, content and examination activity."
        onRefresh={refetch}
        refreshing={loading}
        actions={
          <Link to="/admin/exams" className="btn-primary btn-sm">
            <FileText className="h-3.5 w-3.5" aria-hidden /> Create examination
          </Link>
        }
      />

      {/* Configuration warnings */}
      {system.data ? (
        !system.data.sheetsConfigured || !system.data.youtubeConfigured || !system.data.firebaseAdminConfigured ? (
          <div className="rounded-xl2 border border-amber-200 bg-amber-50 p-3.5 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-semibold">Some integrations are not fully configured</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {!system.data.sheetsConfigured ? <li>Google Sheets sync needs <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>.</li> : null}
              {!system.data.youtubeConfigured ? <li>YouTube metadata import needs <code>YOUTUBE_API_KEY</code> (manual entry still works).</li> : null}
              {!system.data.firebaseAdminConfigured ? <li>Firebase Admin is not set — production sign-in tokens cannot be verified.</li> : null}
            </ul>
            <Link to="/admin/settings" className="mt-1.5 inline-block font-semibold underline">Open platform settings</Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl2 border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            All server integrations configured · environment <strong>{system.data.environment}</strong>
            {isSuperAdmin ? <Badge tone="success">Super Admin</Badge> : null}
          </div>
        )
      ) : null}

      {/* Primary stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {loading && !data
          ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl2" />)
          : data
            ? [
                { label: 'Total students', value: formatNumber(data.totalStudents), hint: `${data.activeStudents} active in 7 days`, icon: <Users className="h-4 w-4" aria-hidden />, tone: 'brand' as const },
                { label: 'New registrations', value: formatNumber(data.newRegistrations), hint: 'Last 7 days', icon: <TrendingUp className="h-4 w-4" aria-hidden />, tone: 'success' as const },
                { label: 'Courses', value: formatNumber(data.totalCourses), hint: `${data.allCourses} incl. drafts`, icon: <BookOpen className="h-4 w-4" aria-hidden />, tone: 'brand' as const },
                { label: 'Lectures', value: formatNumber(data.totalLectures), hint: `${data.allLectures} incl. drafts`, icon: <PlayCircle className="h-4 w-4" aria-hidden />, tone: 'brand' as const },
                { label: 'Examinations', value: formatNumber(data.totalExams), hint: `${data.inProgressAttempts} attempts running`, icon: <FileText className="h-4 w-4" aria-hidden />, tone: 'brand' as const },
                { label: 'Questions', value: formatNumber(data.totalQuestions), hint: 'In question bank', icon: <FileQuestion className="h-4 w-4" aria-hidden />, tone: 'neutral' as const },
                { label: 'Attempts', value: formatNumber(data.totalAttempts), hint: `${data.totalResults} results computed`, icon: <GraduationCap className="h-4 w-4" aria-hidden />, tone: 'success' as const },
                { label: 'Test papers', value: formatNumber(data.totalTestPapers), hint: data.pendingSyncs ? `${data.pendingSyncs} sync issues` : 'Sync healthy', icon: <Table2 className="h-4 w-4" aria-hidden />, tone: data.pendingSyncs ? ('warning' as const) : ('neutral' as const) },
              ].map((tile) => (
                <StatTile key={tile.label} label={tile.label} value={tile.value} hint={tile.hint} icon={tile.icon} tone={tile.tone} />
              ))
            : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Trends */}
        <Panel title="Registrations (30 days)" className="lg:col-span-1">
          {loading && !data ? <Skeleton className="h-28" /> : <TrendBars data={data?.registrationsTrend ?? []} label="Daily registrations" />}
        </Panel>
        <Panel title="Exam attempts (30 days)" className="lg:col-span-1">
          {loading && !data ? <Skeleton className="h-28" /> : <TrendBars data={data?.attemptsTrend ?? []} label="Daily exam attempts" />}
        </Panel>

        {/* Recent activity */}
        <Panel title="Recent admin activity" action={<Link to="/admin/audit-logs" className="text-[11.5px] font-semibold text-brand-600">View all</Link>}>
          {loading && !data ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : !data?.recentActivities.length ? (
            <p className="text-[12.5px] text-slate-500">No administrative activity recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.recentActivities.slice(0, 7).map((activity) => (
                <li key={activity.id} className="flex items-start gap-2 py-1.5">
                  <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{activity.action}</p>
                    <p className="truncate text-[10.5px] text-slate-500 dark:text-slate-400">
                      {activity.actorEmail ?? 'system'} · {formatRelative(activity.createdAt)}
                    </p>
                  </div>
                  {activity.status !== 'success' ? <Badge tone="danger">{activity.status}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Popular lectures">
          {!data?.popularLectures.length ? <p className="text-[12.5px] text-slate-500">No lecture views yet.</p> : (
            <ul className="space-y-2">
              {data.popularLectures.map((lecture) => (
                <li key={lecture.id} className="flex items-center gap-2">
                  <div className="h-9 w-14 shrink-0 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    {lecture.thumbnailUrl ? <img src={lecture.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{lecture.title}</p>
                    <p className="text-[10.5px] text-slate-500">{formatNumber(lecture.viewCount)} views</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Most attempted tests">
          {!data?.mostAttemptedExams.length ? <p className="text-[12.5px] text-slate-500">No attempts yet.</p> : (
            <ul className="space-y-2">
              {data.mostAttemptedExams.map((exam) => (
                <li key={exam.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium">{exam.title}</p>
                    <p className="text-[10.5px] text-slate-500">{exam.totalQuestions} questions</p>
                  </div>
                  <Badge tone="brand">{formatNumber(exam.attempts)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Performance overview">
          {!data?.performanceOverview.length ? <p className="text-[12.5px] text-slate-500">No results computed yet.</p> : (
            <ul className="space-y-2.5">
              {data.performanceOverview.map((row) => (
                <li key={row.examTitle}>
                  <div className="flex justify-between gap-2 text-[11.5px]">
                    <span className="truncate font-medium">{row.examTitle}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{row.avgScore}/{row.maxScore}</span>
                  </div>
                  <ProgressBar value={row.maxScore ? (row.avgScore / row.maxScore) * 100 : 0} className="mt-1" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <RefreshCw className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          <span className="text-slate-500 dark:text-slate-400">Data refreshes when you open a page; all figures come live from D1.</span>
          <Link to="/admin/sheets" className="ml-auto font-semibold text-brand-600">Google Sheets sync →</Link>
        </div>
      </Panel>
    </div>
  );
}
