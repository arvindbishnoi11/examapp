import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, ConfirmDialog } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { FilterSelect, PageHeader, SearchInput } from '@/components/admin/AdminUI';
import { ResourceForm } from '@/components/admin/ResourceManager';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { formatBytes, formatDateTime } from '@/lib/format';
import type { Paginated } from '@shared/types';

type TestPaper = {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  fileKey: string | null;
  storageProvider: string;
  fileSizeBytes: number | null;
  className: string | null;
  classId: string | null;
  examTypeId: string | null;
  examTypeName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  year: number | null;
  category: string | null;
  coverImageUrl: string | null;
  answerKeyUrl: string | null;
  solutionUrl: string | null;
  visibility: string;
  isFree: number | boolean;
  status: string;
  downloadCount?: number;
  createdAt: string;
};

const VISIBILITIES = [
  { value: 'public', label: 'Public (anyone)' },
  { value: 'authenticated', label: 'Signed-in students' },
  { value: 'restricted', label: 'Restricted access' },
];

export default function AdminPapersPage() {
  useDocumentTitle('Test papers');
  const toast = useToast();
  const { hasPermission } = useAuth();
  const { classes, examTypes } = useAdminTaxonomy();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [examTypeId, setExamTypeId] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TestPaper | null>(null);
  const [deleting, setDeleting] = useState<TestPaper | null>(null);
  const [busy, setBusy] = useState(false);

  const manage = hasPermission('test_papers.manage');
  const papers = useApiQuery<Paginated<TestPaper>>(
    '/api/admin/test-papers',
    { q: q || undefined, status: status || undefined, examTypeId: examTypeId || undefined, page, pageSize: 25 },
    { deps: [q, status, examTypeId, page] },
  );

  const columns: Column<TestPaper>[] = [
    {
      key: 'title',
      header: 'Paper',
      render: (row) => (
        <div className="flex min-w-0 items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-semibold">{row.title}</p>
            <p className="truncate text-[10.5px] text-slate-500">
              {[row.examTypeName, row.subjectName, row.className, row.year ? String(row.year) : null, row.category].filter(Boolean).join(' · ') || 'Uncategorised'}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'file',
      header: 'File',
      hideOnMobile: true,
      render: (row) => (
        <div className="text-[10.5px] text-slate-500">
          <p>{row.fileSizeBytes ? formatBytes(row.fileSizeBytes) : 'Unknown size'}</p>
          <p className="capitalize">{row.storageProvider}</p>
        </div>
      ),
    },
    { key: 'visibility', header: 'Access', hideOnMobile: true, render: (row) => <div className="flex flex-col gap-1"><Badge tone="neutral">{row.visibility}</Badge>{row.isFree ? <Badge tone="brand">free</Badge> : null}</div> },
    { key: 'status', header: 'Status', render: (row) => <Badge tone={row.status === 'published' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'}>{row.status}</Badge> },
    { key: 'created', header: 'Added', hideOnMobile: true, render: (row) => <span className="text-[10.5px] text-slate-500">{formatDateTime(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <a href={row.fileUrl} target="_blank" rel="noreferrer" className="rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">Open</a>
          {manage ? <button type="button" onClick={() => { setEditing(row); setFormOpen(true); }} className="rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">Edit</button> : null}
          {manage ? <button type="button" onClick={() => setDeleting(row)} className="rounded border border-rose-200 px-2 py-0.5 text-[10.5px] font-semibold text-rose-600 dark:border-rose-900">Delete</button> : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Test papers"
        description="Previous-year papers and PDFs. Upload to Firebase Storage, R2, or register an external https link."
        onRefresh={papers.refetch}
        refreshing={papers.loading}
        actions={
          manage ? (
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => { setEditing(null); setFormOpen(true); }}>
              Register paper
            </Button>
          ) : undefined
        }
      />

      <Alert tone="info" title="How files are stored">
        The browser uploads the PDF directly to Firebase Storage (recommended) or this Worker stores it in R2 when the
        <code> MEDIA</code> binding exists. The metadata is registered here; the Worker validates that the URL is https and
        records the provider. External links keep working even without either binding.
      </Alert>

      <div className="mb-3 mt-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search papers" className="min-w-[160px] flex-1 sm:max-w-xs" />
        <FilterSelect label="Status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: '', label: 'All statuses' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }]} />
        <FilterSelect label="Exam type" value={examTypeId} onChange={(value) => { setExamTypeId(value); setPage(1); }} options={[{ value: '', label: 'All exam types' }, ...examTypes.map((exam) => ({ value: exam.id, label: exam.name }))]} />
      </div>

      <DataTable
        rows={papers.data?.items ?? []}
        columns={columns}
        loading={papers.loading && !papers.data}
        error={papers.error}
        rowKey={(row) => row.id}
        page={papers.data?.page}
        totalPages={papers.data?.totalPages}
        total={papers.data?.total}
        onPage={setPage}
        emptyMessage="No test papers yet."
      />

      <ResourceForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        title={editing ? 'Edit test paper' : 'Register test paper'}
        submitLabel={editing ? 'Save changes' : 'Register paper'}
        initial={{
          title: editing?.title ?? '',
          description: editing?.description ?? '',
          fileUrl: editing?.fileUrl ?? '',
          fileSizeBytes: editing?.fileSizeBytes ?? '',
          classId: editing?.classId ?? '',
          examTypeId: editing?.examTypeId ?? '',
          subjectId: editing?.subjectId ?? '',
          year: editing?.year ?? '',
          category: editing?.category ?? '',
          coverImageUrl: editing?.coverImageUrl ?? '',
          answerKeyUrl: editing?.answerKeyUrl ?? '',
          solutionUrl: editing?.solutionUrl ?? '',
          visibility: editing?.visibility ?? 'authenticated',
          isFree: Boolean(editing?.isFree ?? true),
          status: editing?.status ?? 'published',
        }}
        fields={[
          { name: 'title', label: 'Title', type: 'text', required: true, span: 2, placeholder: 'JEE Main 2025 — Session 1 Paper 1' },
          { name: 'description', label: 'Description', type: 'textarea', span: 2 },
          { name: 'fileUrl', label: 'PDF URL (https)', type: 'text', required: true, span: 2, placeholder: 'https://firebasestorage.googleapis.com/…pdf' },
          { name: 'fileSizeBytes', label: 'File size (bytes)', type: 'number', min: 0 },
          { name: 'category', label: 'Category', type: 'text', placeholder: 'Full paper, answer key…' },
          { name: 'classId', label: 'Class', type: 'select', options: classes.map((item) => ({ value: item.id, label: item.name })) },
          { name: 'examTypeId', label: 'Exam type', type: 'select', options: examTypes.map((item) => ({ value: item.id, label: item.name })) },
          { name: 'subjectId', label: 'Subject ID (optional)', type: 'text' },
          { name: 'year', label: 'Year', type: 'number', min: 1990, max: 2100 },
          { name: 'coverImageUrl', label: 'Cover image URL', type: 'text', span: 2 },
          { name: 'answerKeyUrl', label: 'Answer key URL', type: 'text' },
          { name: 'solutionUrl', label: 'Solutions URL', type: 'text' },
          { name: 'visibility', label: 'Visibility', type: 'select', options: VISIBILITIES },
          { name: 'status', label: 'Status', type: 'select', options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }] },
          { name: 'isFree', label: 'Free for all students', type: 'checkbox' },
        ]}
        submit={async (values) => {
          const payload = {
            ...values,
            fileSizeBytes: values.fileSizeBytes === '' ? undefined : Number(values.fileSizeBytes),
            year: values.year === '' ? undefined : Number(values.year),
            subjectId: values.subjectId || undefined,
          };
          if (editing) await api.put(`/api/admin/test-papers/${editing.id}`, payload);
          else await api.post('/api/admin/test-papers', payload);
          toast.success(editing ? 'Paper updated' : 'Paper registered');
        }}
        onSaved={() => { setFormOpen(false); setEditing(null); papers.refetch(); }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this test paper?"
        description={deleting?.storageProvider === 'r2' ? 'The stored PDF in R2 will also be deleted.' : 'The metadata is removed. Files hosted on Firebase Storage or external hosts stay where they are.'}
        confirmLabel="Delete paper"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await api.delete(`/api/admin/test-papers/${deleting.id}`, { confirm: 'DELETE' });
            toast.success('Paper deleted');
            setDeleting(null);
            papers.refetch();
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}
