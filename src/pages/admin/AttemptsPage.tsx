import { useState } from 'react';
import { Clock, PlayCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Badge, type Tone } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { FilterSelect, PageHeader, SearchInput } from '@/components/admin/AdminUI';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { Paginated } from '@shared/types';

type AttemptRow = {
  id: string;
  examId: string;
  examTitle: string;
  studentEmail: string;
  status: string;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  percentage: number | null;
  expiresAtMs: number;
  timeSpentSeconds: number;
  answeredCount: number;
  totalQuestions: number;
  submitChannel: string | null;
};

const STATUS_TONES: Record<string, Tone> = {
  in_progress: 'warning',
  submitted: 'brand',
  auto_submitted: 'brand',
  evaluated: 'success',
  expired: 'danger',
  abandoned: 'neutral',
};

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In progress',
  submitted: 'Submitted',
  auto_submitted: 'Auto-submitted',
  evaluated: 'Evaluated',
  expired: 'Expired',
  abandoned: 'Abandoned',
};

function elapsedLabel(seconds: number): string {
  if (!seconds) return '—';
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

export default function AdminAttemptsPage() {
  useDocumentTitle('Exam attempts');
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('in_progress');
  const [examId, setExamId] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const exams = useApiQuery<Paginated<{ id: string; title: string }>>('/api/admin/exams', { pageSize: 100 });
  const attempts = useApiQuery<Paginated<AttemptRow>>(
    '/api/admin/attempts',
    { status: status || undefined, examId: examId || undefined, page, pageSize: 25 },
    { deps: [status, examId, page] },
  );

  // The API has no text filter; filter the current page so the search box is
  // still useful without pretending to search the whole table.
  const rows = (attempts.data?.items ?? []).filter((row) =>
    q ? row.studentEmail.toLowerCase().includes(q.toLowerCase()) || row.examTitle.toLowerCase().includes(q.toLowerCase()) : true,
  );

  const now = Date.now();
  const canForceSubmit = hasPermission('results.view');

  const forceSubmit = async (row: AttemptRow) => {
    setBusyId(row.id);
    try {
      await api.post(`/api/admin/attempts/${row.id}/submit`);
      toast.success(`Submitted ${row.studentEmail}'s attempt. The result is now available.`);
      attempts.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<AttemptRow>[] = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold">{row.studentEmail}</p>
          <p className="truncate text-[10.5px] text-slate-500">{row.examTitle}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={STATUS_TONES[row.status] ?? 'neutral'}>{STATUS_LABELS[row.status] ?? row.status}</Badge>
          {row.status === 'in_progress' && row.expiresAtMs < now ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600">
              <ShieldAlert className="h-3 w-3" aria-hidden /> past deadline
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Answered',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-[11.5px] text-slate-600 dark:text-slate-400">
          {row.answeredCount}/{row.totalQuestions}
        </span>
      ),
    },
    {
      key: 'spent',
      header: 'Time',
      hideOnMobile: true,
      render: (row) => (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-slate-600 dark:text-slate-400">
          <Clock className="h-3 w-3" aria-hidden /> {elapsedLabel(row.timeSpentSeconds)}
        </span>
      ),
    },
    {
      key: 'score',
      header: 'Score',
      render: (row) =>
        row.score === null ? (
          <span className="text-[11.5px] text-slate-400">—</span>
        ) : (
          <span className="text-[12px] font-semibold">
            {formatNumber(row.score)}
            {row.percentage !== null ? <span className="ml-1 text-[10.5px] font-normal text-slate-500">({Math.round(row.percentage)}%)</span> : null}
          </span>
        ),
    },
    {
      key: 'when',
      header: 'Started',
      hideOnMobile: true,
      render: (row) => <span className="text-[10.5px] text-slate-500">{formatDateTime(row.startedAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status === 'in_progress' && canForceSubmit ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busyId === row.id}
            icon={<PlayCircle className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => void forceSubmit(row)}
          >
            Force submit
          </Button>
        ) : null,
    },
  ];

  const staleCount = (attempts.data?.items ?? []).filter((row) => row.status === 'in_progress' && row.expiresAtMs < now).length;

  return (
    <div>
      <PageHeader
        title="Exam attempts"
        description="Live and finished attempts. The cron closes anything past its deadline plus 45 seconds; use force submit to recover a stuck attempt immediately."
        onRefresh={attempts.refetch}
        refreshing={attempts.loading}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => {
              setStatus('in_progress');
              setExamId('');
              setPage(1);
            }}
          >
            Show in-progress
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Filter this page" className="min-w-[150px] flex-1 sm:max-w-xs" />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'submitted', label: 'Submitted' },
            { value: 'auto_submitted', label: 'Auto-submitted' },
            { value: 'evaluated', label: 'Evaluated' },
            { value: 'expired', label: 'Expired' },
          ]}
        />
        <FilterSelect
          label="Examination"
          value={examId}
          onChange={(value) => {
            setExamId(value);
            setPage(1);
          }}
          options={[{ value: '', label: 'All examinations' }, ...(exams.data?.items ?? []).map((exam) => ({ value: exam.id, label: exam.title }))]}
        />
      </div>

      {staleCount > 0 ? (
        <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
          {staleCount} attempt{staleCount === 1 ? ' is' : 's are'} past the deadline on this page and waiting for the cron.
        </p>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        loading={attempts.loading && !attempts.data}
        error={attempts.error}
        rowKey={(row) => row.id}
        page={attempts.data?.page}
        totalPages={attempts.data?.totalPages}
        total={attempts.data?.total}
        onPage={setPage}
        emptyMessage={status === 'in_progress' ? 'No attempts are in progress right now.' : 'No attempts match these filters.'}
      />

      <div className="mt-4 rounded-xl2 border border-slate-200 bg-white p-3.5 text-[12px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <p className="mb-1 font-semibold text-slate-800 dark:text-slate-200">Why an attempt can look stuck</p>
        Answers autosave every few seconds, so an attempt only stays <strong>in progress</strong> while the student has it open.
        If their device dies mid-exam the deadline still applies: the 15-minute cron submits and evaluates anything past
        <code> expires_at + 45s</code>. Forcing a submit does exactly the same evaluation as the student pressing submit, and is
        audit-logged against your account.
      </div>
    </div>
  );
}
