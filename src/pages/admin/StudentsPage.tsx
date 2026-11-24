import { useState } from 'react';
import { Ban, CheckCircle2, Eye, Trash2, UserCheck } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Badge, ConfirmDialog, EmptyState, Modal, Spinner } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { ExportButton, FilterSelect, PageHeader, SearchInput, downloadExport } from '@/components/admin/AdminUI';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import type { AdminUserRow, Paginated } from '@shared/types';

type StudentRow = AdminUserRow & { fullName?: string | null; lastActiveAt?: string | null; attemptCount?: number; lecturesCompleted?: number };

type StudentDetail = {
  student: StudentRow;
  attempts: { id: string; examTitle: string; status: string; score: number | null; startedAt: string; submittedAt: string | null }[];
  progress: { total: number; completed: number };
  bookmarkCount: number;
};

export default function AdminStudentsPage() {
  useDocumentTitle('Students');
  const { hasPermission } = useAuth();
  const toast = useToast();
  const { classes, examTypes } = useAdminTaxonomy();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [classId, setClassId] = useState('');
  const [examTypeId, setExamTypeId] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ row: StudentRow; next: 'active' | 'suspended' } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentRow | null>(null);
  const [busy, setBusy] = useState(false);

  const students = useApiQuery<Paginated<StudentRow>>(
    '/api/admin/students',
    { q: q || undefined, status: status || undefined, classId: classId || undefined, examTypeId: examTypeId || undefined, sort, page, pageSize: 25 },
    { deps: [q, status, classId, examTypeId, sort, page] },
  );

  const detail = useApiQuery<StudentDetail>(detailId ? `/api/admin/students/${detailId}` : null, undefined, { enabled: Boolean(detailId) });

  const columns: Column<StudentRow>[] = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{row.fullName ?? row.displayName ?? row.email.split('@')[0]}</p>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'class',
      header: 'Class / Goal',
      hideOnMobile: true,
      render: (row) => (
        <div className="text-[12px]">
          <p>{row.className ?? '—'}</p>
          <p className="text-[11px] text-slate-500">{row.targetExamName ?? 'No goal set'}</p>
        </div>
      ),
    },
    {
      key: 'activity',
      header: 'Activity',
      hideOnMobile: true,
      render: (row) => (
        <div className="text-[11.5px]">
          <p>{row.attemptCount ?? 0} tests · {row.lecturesCompleted ?? 0} lectures</p>
          <p className="text-slate-500">{row.lastActiveAt ? `Active ${formatDate(row.lastActiveAt)}` : 'Never active'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={row.status === 'active' ? 'success' : 'danger'}>{row.status}</Badge>
          {!row.emailVerified ? <span className="text-[10px] text-amber-600">unverified</span> : null}
        </div>
      ),
    },
    {
      key: 'joined',
      header: 'Joined',
      hideOnMobile: true,
      render: (row) => <span className="text-[11.5px] text-slate-500">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setDetailId(row.id)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800" aria-label={`View ${row.email}`}>
            <Eye className="h-3.5 w-3.5" aria-hidden />
          </button>
          {hasPermission('students.suspend') ? (
            <button
              type="button"
              onClick={() => setStatusTarget({ row, next: row.status === 'active' ? 'suspended' : 'active' })}
              className={`rounded p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 ${row.status === 'active' ? 'text-amber-600' : 'text-emerald-600'}`}
              aria-label={row.status === 'active' ? `Suspend ${row.email}` : `Reactivate ${row.email}`}
            >
              {row.status === 'active' ? <Ban className="h-3.5 w-3.5" aria-hidden /> : <UserCheck className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ) : null}
          {hasPermission('students.delete') ? (
            <button type="button" onClick={() => setDeleteTarget(row)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40" aria-label={`Delete ${row.email}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  const applyStatus = async () => {
    if (!statusTarget) return;
    setBusy(true);
    try {
      await api.post(`/api/admin/students/${statusTarget.row.id}/status`, { status: statusTarget.next });
      toast.success(statusTarget.next === 'suspended' ? 'Student suspended' : 'Student reactivated');
      setStatusTarget(null);
      students.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/students/${deleteTarget.id}`, { confirm: 'DELETE' });
      toast.success('Student account deleted (soft delete, data retained for audit)');
      setDeleteTarget(null);
      students.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Students"
        description="Directory of every registered learner with activity and goal."
        onRefresh={students.refetch}
        refreshing={students.loading}
        actions={
          hasPermission('students.export') ? (
            <ExportButton
              onClick={async () => {
                try {
                  await downloadExport('/api/admin/students/export', `prepsetu-students-${new Date().toISOString().slice(0, 10)}.csv`);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            />
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Name or email" className="min-w-[180px] flex-1 sm:max-w-xs" />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(value) => { setStatus(value); setPage(1); }}
          options={[{ value: '', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]}
        />
        <FilterSelect
          label="Class"
          value={classId}
          onChange={(value) => { setClassId(value); setPage(1); }}
          options={[{ value: '', label: 'All classes' }, ...classes.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <FilterSelect
          label="Target exam"
          value={examTypeId}
          onChange={(value) => { setExamTypeId(value); setPage(1); }}
          options={[{ value: '', label: 'All goals' }, ...examTypes.map((e) => ({ value: e.id, label: e.name }))]}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          onChange={(value) => { setSort(value); setPage(1); }}
          options={[{ value: 'recent', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'name', label: 'Name A–Z' }]}
        />
      </div>

      <DataTable
        rows={students.data?.items ?? []}
        columns={columns}
        loading={students.loading && !students.data}
        error={students.error}
        rowKey={(row) => row.id}
        page={students.data?.page}
        totalPages={students.data?.totalPages}
        total={students.data?.total}
        onPage={setPage}
        onRowClick={(row) => setDetailId(row.id)}
        emptyMessage={q || status || classId || examTypeId ? 'No students match these filters.' : 'No students have registered yet.'}
      />

      {/* ---- Detail drawer ---------------------------------------------- */}
      <Modal open={Boolean(detailId)} onClose={() => setDetailId(null)} title="Student profile" size="lg">
        {detail.loading ? <Spinner /> : detail.error ? <p className="text-[13px] text-rose-600">{detail.error}</p> : detail.data ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">
                {(detail.data.student.fullName ?? detail.data.student.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{detail.data.student.fullName ?? detail.data.student.displayName ?? 'Unnamed student'}</p>
                <p className="truncate text-[12px] text-slate-500">{detail.data.student.email}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={detail.data.student.status === 'active' ? 'success' : 'danger'}>{detail.data.student.status}</Badge>
                  {detail.data.student.className ? <Badge tone="brand">{detail.data.student.className}</Badge> : null}
                  {detail.data.student.targetExamName ? <Badge tone="neutral">{detail.data.student.targetExamName}</Badge> : null}
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
              {[
                { label: 'Joined', value: formatDate(detail.data.student.createdAt) },
                { label: 'Last active', value: detail.data.student.lastActiveAt ? formatDate(detail.data.student.lastActiveAt) : '—' },
                { label: 'Tests taken', value: formatNumber(detail.data.student.attemptCount ?? detail.data.attempts.length) },
                { label: 'Lectures done', value: `${detail.data.progress.completed}/${detail.data.progress.total}` },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</dt>
                  <dd className="mt-0.5 font-semibold">{item.value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <h3 className="mb-1.5 text-[13px] font-semibold">Recent attempts</h3>
              {!detail.data.attempts.length ? (
                <p className="text-[12px] text-slate-500">No attempts recorded.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {detail.data.attempts.slice(0, 10).map((attempt) => (
                    <li key={attempt.id} className="flex items-center justify-between gap-2 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-medium">{attempt.examTitle}</p>
                        <p className="text-[10.5px] text-slate-500">{formatDateTime(attempt.submittedAt ?? attempt.startedAt)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge tone={attempt.status === 'evaluated' || attempt.status === 'submitted' ? 'success' : 'warning'}>{attempt.status.replace('_', ' ')}</Badge>
                        {attempt.score !== null ? <p className="mt-0.5 text-[11px] tabular-nums">{attempt.score}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              {hasPermission('students.suspend') ? (
                <Button
                  size="sm"
                  variant={detail.data.student.status === 'active' ? 'secondary' : 'primary'}
                  icon={detail.data.student.status === 'active' ? <Ban className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => setStatusTarget({ row: detail.data!.student, next: detail.data!.student.status === 'active' ? 'suspended' : 'active' })}
                >
                  {detail.data.student.status === 'active' ? 'Suspend account' : 'Reactivate account'}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={statusTarget?.next === 'suspended' ? 'Suspend this student?' : 'Reactivate this student?'}
        description={
          statusTarget?.next === 'suspended'
            ? `${statusTarget.row.email} will not be able to sign in or start new attempts. Existing results are kept.`
            : `${statusTarget?.row.email} will regain access immediately.`
        }
        confirmLabel={statusTarget?.next === 'suspended' ? 'Suspend' : 'Reactivate'}
        tone={statusTarget?.next === 'suspended' ? 'danger' : 'primary'}
        loading={busy}
        onCancel={() => setStatusTarget(null)}
        onClose={() => setStatusTarget(null)}
        onConfirm={applyStatus}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this student account?"
        description={`${deleteTarget?.email ?? ''} will be soft-deleted: they can no longer sign in, but historical results remain for audit and analytics.`}
        confirmLabel="Delete account"
        loading={busy}
        onCancel={() => setDeleteTarget(null)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </div>
  );
}
