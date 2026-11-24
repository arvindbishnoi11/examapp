import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { errorMessage } from '@/lib/api';
import { Badge, Modal } from '@/components/ui';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { ExportButton, FilterSelect, PageHeader, SearchInput, downloadExport } from '@/components/admin/AdminUI';
import { formatDateTime } from '@/lib/format';
import type { Paginated } from '@shared/types';

type AuditRow = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  beforeJson: string | null;
  afterJson: string | null;
  metaJson: string | null;
  ipHash: string | null;
  createdAt: string;
};

function pretty(json: string | null): string {
  if (!json) return '—';
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export default function AdminAuditPage() {
  useDocumentTitle('Audit log');
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [status, setStatus] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const logs = useApiQuery<Paginated<AuditRow> & { actions: string[] }>(
    '/api/admin/audit-logs',
    { action: action || undefined, actor: actor || undefined, status: status || undefined, entityType: entityType || undefined, page },
    { deps: [action, actor, status, entityType, page] },
  );

  const canExport = hasPermission('audit.view');

  const columns: Column<AuditRow>[] = [
    { key: 'when', header: 'When', render: (row) => <span className="text-[10.5px] text-slate-500">{formatDateTime(row.createdAt)}</span> },
    {
      key: 'action',
      header: 'Action',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] font-semibold">{row.action}</p>
          <p className="truncate text-[10px] text-slate-500">{row.entityType ?? '—'}{row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ''}</p>
        </div>
      ),
    },
    { key: 'actor', header: 'Actor', hideOnMobile: true, render: (row) => <span className="text-[11px]">{row.actorEmail ?? row.actorId?.slice(0, 8) ?? 'system'}</span> },
    { key: 'status', header: 'Result', render: (row) => <Badge tone={row.status === 'success' ? 'success' : row.status === 'failure' ? 'danger' : 'warning'}>{row.status}</Badge> },
    { key: 'ip', header: 'IP hash', hideOnMobile: true, render: (row) => <span className="font-mono text-[10px] text-slate-400">{row.ipHash ? row.ipHash.slice(0, 10) : '—'}</span> },
    {
      key: 'open',
      header: '',
      className: 'text-right',
      render: (row) => (
        <button type="button" onClick={() => setDetail(row)} className="rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
          Inspect
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every privileged action — content changes, permissions, settings, syncs and exports — is recorded with before/after state."
        onRefresh={logs.refetch}
        refreshing={logs.loading}
        actions={
          canExport ? (
            <ExportButton
              label="Export CSV"
              onClick={async () => {
                try {
                  await downloadExport('/api/admin/audit-logs/export', `prepsetu-audit-${new Date().toISOString().slice(0, 10)}.csv`);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            />
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={actor} onChange={(value) => { setActor(value); setPage(1); }} placeholder="Actor email" className="min-w-[150px] flex-1 sm:max-w-[220px]" />
        <FilterSelect label="Action" value={action} onChange={(value) => { setAction(value); setPage(1); }} options={[{ value: '', label: 'All actions' }, ...(logs.data?.actions ?? []).map((item) => ({ value: item, label: item }))]} />
        <FilterSelect label="Status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: '', label: 'All results' }, { value: 'success', label: 'Success' }, { value: 'failure', label: 'Failure' }, { value: 'denied', label: 'Denied' }]} />
        <FilterSelect label="Entity" value={entityType} onChange={(value) => { setEntityType(value); setPage(1); }} options={[{ value: '', label: 'All entities' }, { value: 'user', label: 'User' }, { value: 'course', label: 'Course' }, { value: 'exam', label: 'Exam' }, { value: 'question', label: 'Question' }, { value: 'lecture', label: 'Lecture' }, { value: 'test_paper', label: 'Test paper' }, { value: 'result', label: 'Result' }, { value: 'sync', label: 'Sync' }, { value: 'platform_settings', label: 'Settings' }]} />
      </div>

      <DataTable
        rows={logs.data?.items ?? []}
        columns={columns}
        loading={logs.loading && !logs.data}
        error={logs.error}
        rowKey={(row) => row.id}
        page={logs.data?.page}
        totalPages={logs.data?.totalPages}
        total={logs.data?.total}
        onPage={setPage}
        emptyMessage="No audit entries match these filters."
      />

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Audit entry" size="lg">
        {detail ? (
          <div className="space-y-2.5 text-[12px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={detail.status === 'success' ? 'success' : detail.status === 'failure' ? 'danger' : 'warning'}>{detail.status}</Badge>
              <span className="font-mono text-[11px] font-semibold">{detail.action}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">{formatDateTime(detail.createdAt)}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-slate-500">Actor</dt><dd>{detail.actorEmail ?? '—'}</dd>
              <dt className="text-slate-500">Actor ID</dt><dd className="font-mono text-[10.5px]">{detail.actorId ?? '—'}</dd>
              <dt className="text-slate-500">Entity</dt><dd>{detail.entityType ?? '—'} · <span className="font-mono text-[10.5px]">{detail.entityId ?? '—'}</span></dd>
              <dt className="text-slate-500">IP hash</dt><dd className="font-mono text-[10.5px]">{detail.ipHash ?? '—'}</dd>
            </dl>
            {detail.beforeJson ? (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400"><ScrollText className="h-3 w-3" aria-hidden /> Before</p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-2 text-[10.5px] leading-relaxed dark:bg-slate-800/70">{pretty(detail.beforeJson)}</pre>
              </div>
            ) : null}
            {detail.afterJson ? (
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">After</p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-2 text-[10.5px] leading-relaxed dark:bg-slate-800/70">{pretty(detail.afterJson)}</pre>
              </div>
            ) : null}
            {detail.metaJson ? (
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Metadata</p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-2 text-[10.5px] leading-relaxed dark:bg-slate-800/70">{pretty(detail.metaJson)}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
