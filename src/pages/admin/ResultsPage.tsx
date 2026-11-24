import { useState } from 'react';
import { BookOpenCheck, Download, Send, ShieldCheck } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Badge, ConfirmDialog } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { ExportButton, FilterSelect, PageHeader, SearchInput, downloadExport } from '@/components/admin/AdminUI';
import { formatDateTime } from '@/lib/format';
import type { Paginated } from '@shared/types';

type ResultRow = {
  id: string;
  attemptId: string;
  examId: string;
  examTitle: string;
  studentEmail: string;
  studentName: string | null;
  score: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  rank: number | null;
  percentile: number | null;
  passed: boolean;
  isPublished: boolean;
  computedAt: string;
};

export default function AdminResultsPage() {
  useDocumentTitle('Results');
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [q, setQ] = useState('');
  const [published, setPublished] = useState('');
  const [examId, setExamId] = useState('');
  const [page, setPage] = useState(1);
  const [publishAll, setPublishAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const exams = useApiQuery<Paginated<{ id: string; title: string }>>('/api/admin/exams', { pageSize: 100 });
  const results = useApiQuery<Paginated<ResultRow>>(
    '/api/admin/results',
    { q: q || undefined, published: published || undefined, examId: examId || undefined, page, pageSize: 25 },
    { deps: [q, published, examId, page] },
  );

  const canPublish = hasPermission('results.publish');

  const columns: Column<ResultRow>[] = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold">{row.studentName ?? row.studentEmail}</p>
          <p className="truncate text-[10.5px] text-slate-500">{row.studentEmail}</p>
        </div>
      ),
    },
    {
      key: 'exam',
      header: 'Examination',
      render: (row) => <p className="line-clamp-2 text-[12px]">{row.examTitle}</p>,
    },
    {
      key: 'score',
      header: 'Score',
      render: (row) => (
        <div className="text-[11.5px] tabular-nums">
          <p className="font-semibold">{row.score}/{row.maxScore}</p>
          <p className="text-slate-500">{Number(row.percentage).toFixed(1)}% · {Number(row.accuracy ?? 0).toFixed(0)}% acc</p>
        </div>
      ),
    },
    {
      key: 'rank',
      header: 'Rank',
      hideOnMobile: true,
      render: (row) => (row.rank == null ? <span className="text-[11px] text-slate-400">—</span> : (
        <div className="text-[11.5px]">
          <p className="font-semibold">#{row.rank}</p>
          <p className="text-slate-500">{row.percentile != null ? `${Number(row.percentile).toFixed(1)}ile` : ''}</p>
        </div>
      )),
    },
    {
      key: 'flags',
      header: 'Flags',
      hideOnMobile: true,
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={row.isPublished ? 'success' : 'warning'}>{row.isPublished ? 'published' : 'hidden'}</Badge>
          {row.passed ? <Badge tone="brand">pass</Badge> : null}
        </div>
      ),
    },
    {
      key: 'when',
      header: 'Computed',
      hideOnMobile: true,
      render: (row) => <span className="text-[10.5px] text-slate-500">{formatDateTime(row.computedAt)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Results"
        description="Server-evaluated scores, ranks and percentile. Students only see results once published."
        onRefresh={results.refetch}
        refreshing={results.loading}
        actions={
          <>
            {canPublish ? (
              <Button size="sm" variant="secondary" icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />} onClick={() => { setExamId(examId); setPublishAll(true); }} disabled={!examId}>
                Publish for filtered exam
              </Button>
            ) : null}
            <ExportButton
              label="Export CSV"
              onClick={() => downloadExport(`/api/admin/results/export${examId ? `?examId=${examId}` : ''}`, `results-${new Date().toISOString().slice(0, 10)}.csv`)}
            />
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search student or exam" className="min-w-[160px] flex-1 sm:max-w-xs" />
        <FilterSelect label="Examination" value={examId} onChange={(value) => { setExamId(value); setPage(1); }} options={[{ value: '', label: 'All examinations' }, ...(exams.data?.items ?? []).map((exam) => ({ value: exam.id, label: exam.title }))]} />
        <FilterSelect label="Visibility" value={published} onChange={(value) => { setPublished(value); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'true', label: 'Published' }, { value: 'false', label: 'Hidden' }]} />
      </div>

      {!examId ? (
        <p className="mb-2 text-[11.5px] text-slate-500">
          Select an examination to publish results in bulk or export its CSV.
        </p>
      ) : null}

      <DataTable
        rows={results.data?.items ?? []}
        columns={columns}
        loading={results.loading && !results.data}
        error={results.error}
        rowKey={(row) => row.id}
        page={results.data?.page}
        totalPages={results.data?.totalPages}
        total={results.data?.total}
        onPage={setPage}
        emptyMessage="No results yet. Results appear here after students submit examinations."
      />

      <div className="mt-4 rounded-xl2 border border-slate-200 bg-white p-3.5 text-[12px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
          <BookOpenCheck className="h-3.5 w-3.5" aria-hidden /> How result release works
        </p>
        Results are precomputed at submission and ranked across published attempts (rank requires at least five published
        results and <code>rank_enabled</code>). Publishing updates <code>is_published</code>; until then the student API
        returns only the attempt status. Use <strong>after_window</strong> mode for scheduled tests so ranks settle after
        the window closes.
        <p className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1"><Download className="h-3 w-3" aria-hidden /> CSV export includes score, rank and visibility.</span>
          <span className="inline-flex items-center gap-1"><Send className="h-3 w-3" aria-hidden /> Bulk publish never re-scores; it only flips visibility.</span>
        </p>
      </div>

      <ConfirmDialog
        open={publishAll}
        title="Publish all results for this examination?"
        description={`Every result for “${exams.data?.items.find((e) => e.id === examId)?.title ?? 'the selected exam'}” becomes visible to its student. You can hide them again later.`}
        confirmLabel="Publish results"
        loading={busy}
        onCancel={() => setPublishAll(false)}
        onClose={() => setPublishAll(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            const response = await api.post<{ updated: number }>('/api/admin/results/publish', { examId, publish: true });
            toast.success(`${response.updated} result(s) published`);
            setPublishAll(false);
            results.refetch();
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}
