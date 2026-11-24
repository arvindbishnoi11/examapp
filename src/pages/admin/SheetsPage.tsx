import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, ConfirmDialog, Skeleton } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { PageHeader, Panel } from '@/components/admin/AdminUI';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { Paginated, SheetsStatus, SyncReport } from '@shared/types';

type Mapping = {
  entity: string;
  acceptedNames: string[];
  present: boolean;
  worksheet: string | null;
  headerSample: string[];
  requiredColumns: string[];
};

type SyncLogRow = {
  id: string;
  mode: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  statsJson: string | null;
  errorMessage: string | null;
  triggeredBy: string | null;
};

export default function AdminSheetsPage() {
  useDocumentTitle('Google Sheets sync');
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SyncReport | null>(null);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const [confirmSync, setConfirmSync] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSync = hasPermission('sheets.sync');
  const status = useApiQuery<SheetsStatus>('/api/admin/sheets/status');
  const mappings = useApiQuery<{ mappings: Mapping[]; message: string | null }>('/api/admin/sheets/mappings');
  const logs = useApiQuery<Paginated<SyncLogRow>>('/api/admin/sheets/logs', { page }, { deps: [page] });

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ report: SyncReport; preview: Record<string, unknown[]> }>('/api/admin/sheets/preview-sync', {});
      setPreview(result.report);
      const total = result.report.sheets.reduce((sum, sheet) => sum + sheet.totalRows, 0);
      toast.info(`Preview read ${total} row(s) — nothing was written`);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  const runSync = async (force = false) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ report: SyncReport }>('/api/admin/sheets/sync', { mode, force });
      setLastReport(result.report);
      const totals = result.report.sheets.reduce((acc, sheet) => ({
        inserted: acc.inserted + sheet.inserted,
        updated: acc.updated + sheet.updated,
        failed: acc.failed + sheet.failed,
      }), { inserted: 0, updated: 0, failed: 0 });
      if (result.report.status === 'failed') toast.error(result.report.errorMessage ?? 'Synchronisation failed');
      else toast.success(`Sync done — ${totals.inserted} inserted, ${totals.updated} updated, ${totals.failed} failed`);
      setConfirmSync(false);
      status.refetch();
      logs.refetch();
      mappings.refetch();
    } catch (err) {
      setError(errorMessage(err));
      setConfirmSync(false);
    } finally { setBusy(false); }
  };

  const configured = status.data?.configured;

  return (
    <div>
      <PageHeader
        title="Google Sheets sync"
        description="Author content in a spreadsheet and publish it to the platform. Syncs are incremental and audited."
        onRefresh={() => { status.refetch(); mappings.refetch(); logs.refetch(); }}
        refreshing={status.loading}
        actions={
          canSync ? (
            <>
              <Button size="sm" variant="secondary" loading={busy} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} onClick={runPreview} disabled={!configured}>
                Preview (dry run)
              </Button>
              <Button size="sm" loading={busy} icon={<UploadCloud className="h-3.5 w-3.5" aria-hidden />} onClick={() => setConfirmSync(true)} disabled={!configured}>
                Run sync
              </Button>
            </>
          ) : undefined
        }
      />

      {error ? <div className="mb-3"><Alert tone="error">{error}</Alert></div> : null}

      {status.loading && !status.data ? (
        <Skeleton className="h-40" />
      ) : !configured ? (
        <Alert tone="warning" title="Google Sheets is not configured">
          Add the <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> secret to this Worker, share the spreadsheet with the service
          account email as an <strong>Editor</strong>, and enable the Google Sheets API. The full setup is in{' '}
          <code>docs/SHEETS.md</code>. {status.data?.message ? <span className="mt-1 block">{status.data.message}</span> : null}
        </Alert>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="Spreadsheet" className="lg:col-span-2">
            <div className="space-y-2 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <Database className="h-4 w-4 text-emerald-600" aria-hidden />
                <span className="font-semibold">{status.data?.spreadsheetTitle ?? 'Untitled spreadsheet'}</span>
                <Badge tone={status.data?.syncInProgress ? 'warning' : 'success'}>{status.data?.syncInProgress ? 'sync running' : 'idle'}</Badge>
                <Badge tone="neutral">cron every 15 min</Badge>
              </div>
              <p className="text-[11px] text-slate-500">
                Spreadsheet ID <code>{status.data?.spreadsheetId}</code>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="py-1 pr-3">Worksheet</th>
                      <th className="py-1 pr-3">Rows</th>
                      <th className="py-1">Mapped to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(status.data?.worksheets ?? []).map((worksheet) => (
                      <tr key={worksheet.title} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1 pr-3 font-medium">{worksheet.title}</td>
                        <td className="py-1 pr-3 tabular-nums text-slate-500">{formatNumber(worksheet.rowCount)}</td>
                        <td className="py-1">
                          {worksheet.mappedEntity ? <Badge tone="brand">{worksheet.mappedEntity}</Badge> : <span className="text-slate-400">ignored</span>}
                        </td>
                      </tr>
                    ))}
                    {!status.data?.worksheets.length ? (
                      <tr><td colSpan={3} className="py-2 text-slate-500">No worksheets found — check the service-account access.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>

          <Panel title="Last sync">
            {!status.data?.lastSync ? (
              <p className="text-[12px] text-slate-500">No synchronisation has run yet.</p>
            ) : (
              <dl className="space-y-1.5 text-[12px]">
                <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd><Badge tone={status.data.lastSync.status === 'success' ? 'success' : status.data.lastSync.status === 'failed' ? 'danger' : 'warning'}>{status.data.lastSync.status}</Badge></dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Mode</dt><dd className="capitalize">{status.data.lastSync.mode}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Started</dt><dd>{formatDateTime(status.data.lastSync.startedAt)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Duration</dt><dd>{status.data.lastSync.durationMs ? `${(status.data.lastSync.durationMs / 1000).toFixed(1)}s` : '—'}</dd></div>
              </dl>
            )}
            {canSync ? (
              <div className="mt-2 space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-500" htmlFor="sync-mode">Sync mode</label>
                <select id="sync-mode" className="input h-9 py-0 text-[12.5px]" value={mode} onChange={(event) => setMode(event.target.value as 'incremental' | 'full')}>
                  <option value="incremental">Incremental — only changed rows</option>
                  <option value="full">Full — re-read every row</option>
                </select>
                <Button size="sm" variant="secondary" loading={busy} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setConfirmPurge(true)}>
                  Purge catalogue cache
                </Button>
              </div>
            ) : null}
          </Panel>
        </div>
      )}

      {preview ? (
        <Panel title="Dry-run preview" className="mt-3" action={<button type="button" onClick={() => setPreview(null)} className="text-[11px] font-semibold text-slate-500">Dismiss</button>}>
          <SyncTable report={preview} />
          <p className="mt-1.5 text-[10.5px] text-slate-400">Preview never writes. Run the sync to apply these changes.</p>
        </Panel>
      ) : null}

      {lastReport ? (
        <Panel title="Last sync result" className="mt-3">
          <SyncTable report={lastReport} />
          {lastReport.errorMessage ? <p className="mt-1.5 text-[11.5px] text-rose-600">{lastReport.errorMessage}</p> : null}
        </Panel>
      ) : null}

      <Panel title="Column mapping" className="mt-3">
        {mappings.loading && !mappings.data ? <Skeleton className="h-24" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-3">Entity</th>
                  <th className="py-1 pr-3">Worksheet</th>
                  <th className="py-1 pr-3">Required columns</th>
                  <th className="py-1">Detected headers</th>
                </tr>
              </thead>
              <tbody>
                {(mappings.data?.mappings ?? []).map((mapping) => (
                  <tr key={mapping.entity} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-3 font-semibold capitalize">{mapping.entity.replace(/_/g, ' ')}</td>
                    <td className="py-1.5 pr-3">
                      {mapping.present ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" aria-hidden />{mapping.worksheet}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" aria-hidden />missing</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">{mapping.requiredColumns.join(', ')}</td>
                    <td className="py-1.5 text-slate-500">{mapping.headerSample.slice(0, 8).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mappings.data?.message ? <p className="mt-1.5 text-[11px] text-amber-600">{mappings.data.message}</p> : null}
      </Panel>

      <Panel title="Sync history" className="mt-3">
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-3">Started</th>
                <th className="py-1 pr-3">Mode</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Duration</th>
                <th className="py-1 pr-3">By</th>
                <th className="py-1">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(logs.data?.items ?? []).map((log) => (
                <tr key={log.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3">{formatDateTime(log.startedAt)}</td>
                  <td className="py-1.5 pr-3 capitalize">{log.mode}</td>
                  <td className="py-1.5 pr-3"><Badge tone={log.status === 'success' ? 'success' : log.status === 'failed' ? 'danger' : 'warning'}>{log.status}</Badge></td>
                  <td className="py-1.5 pr-3 tabular-nums">{log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="py-1.5 pr-3 text-slate-500">{log.triggeredBy ?? 'cron'}</td>
                  <td className="py-1.5 text-slate-500">{log.errorMessage ? <span className="text-rose-600">{log.errorMessage.slice(0, 80)}</span> : log.statsJson ? <span className="font-mono text-[10px]">{log.statsJson.slice(0, 70)}</span> : '—'}</td>
                </tr>
              ))}
              {!logs.data?.items.length ? (
                <tr><td colSpan={6} className="py-2 text-slate-500">No sync runs recorded.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {logs.data && logs.data.totalPages > 1 ? (
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>Page {logs.data.page} of {logs.data.totalPages}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={page >= logs.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <ConfirmDialog
        open={confirmSync}
        title={`Run a ${mode} synchronisation?`}
        description="Rows are validated and upserted into the catalogue. Invalid rows are skipped and reported; nothing is deleted by a sync."
        confirmLabel="Run sync"
        loading={busy}
        onCancel={() => setConfirmSync(false)}
        onClose={() => setConfirmSync(false)}
        onConfirm={() => runSync(false)}
      />

      <ConfirmDialog
        open={confirmPurge}
        title="Purge the catalogue cache?"
        description="Forces the public catalogue to be rebuilt on the next request. Safe to run any time."
        confirmLabel="Purge cache"
        loading={busy}
        onCancel={() => setConfirmPurge(false)}
        onClose={() => setConfirmPurge(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.post('/api/admin/sheets/cache/purge', {});
            toast.success('Catalogue cache purged');
            setConfirmPurge(false);
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}

function SyncTable({ report }: { report: SyncReport }) {
  const totals = report.sheets.reduce((acc, sheet) => ({
    rows: acc.rows + sheet.totalRows,
    inserted: acc.inserted + sheet.inserted,
    updated: acc.updated + sheet.updated,
    failed: acc.failed + sheet.failed,
  }), { rows: 0, inserted: 0, updated: 0, failed: 0 });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
        <Badge tone={report.status === 'success' ? 'success' : report.status === 'failed' ? 'danger' : 'warning'}>{report.status}</Badge>
        <span className="font-semibold capitalize">{report.mode}</span>
        <span className="text-slate-500">{formatNumber(totals.rows)} rows · {totals.inserted} new · {totals.updated} updated · {totals.failed} failed</span>
        {report.durationMs ? <span className="text-slate-400">{(report.durationMs / 1000).toFixed(1)}s</span> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
              <th className="py-1 pr-3">Sheet</th>
              <th className="py-1 pr-3">Entity</th>
              <th className="py-1 pr-3">Rows</th>
              <th className="py-1 pr-3">New</th>
              <th className="py-1 pr-3">Updated</th>
              <th className="py-1 pr-3">Skipped</th>
              <th className="py-1">Errors</th>
            </tr>
          </thead>
          <tbody>
            {report.sheets.map((sheet) => (
              <tr key={sheet.sheet} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-3 font-medium">{sheet.sheet}</td>
                <td className="py-1 pr-3 capitalize">{sheet.entity.replace(/_/g, ' ')}</td>
                <td className="py-1 pr-3 tabular-nums">{sheet.totalRows}</td>
                <td className="py-1 pr-3 tabular-nums text-emerald-600">{sheet.inserted}</td>
                <td className="py-1 pr-3 tabular-nums text-brand-600">{sheet.updated}</td>
                <td className="py-1 pr-3 tabular-nums text-slate-500">{sheet.skipped}</td>
                <td className="py-1 text-rose-600 tabular-nums">{sheet.failed}{sheet.errors.length ? ` (${sheet.errors[0]?.message.slice(0, 40)}…)` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
