import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, ExternalLink, Plus, Send, Settings2 } from 'lucide-react';
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
import { formatDate, formatDateTime } from '@/lib/format';
import type { Paginated } from '@shared/types';

export type AdminExam = {
  id: string;
  title: string;
  description: string | null;
  instructions?: string | null;
  examKind: string;
  status: string;
  durationMinutes: number;
  totalMarks: number;
  totalQuestions: number;
  negativeMarks: number;
  negativeMarkingEnabled: number | boolean;
  marksPerQuestion?: number;
  startAt: string | null;
  endAt: string | null;
  maxAttempts: number;
  resultPublishMode: string;
  isFree: number | boolean;
  shuffleQuestions?: number | boolean;
  shuffleOptions?: number | boolean;
  allowSectionNavigation?: number | boolean;
  passingPercentage?: number;
  courseId?: string | null;
  examTypeId?: string | null;
  subjectId?: string | null;
  chapterId?: string | null;
  testSeriesId?: string | null;
  courseName: string | null;
  examTypeName: string | null;
  testSeriesName: string | null;
  attemptCount: number;
  resultCount: number;
  createdAt: string;
};

const KINDS = [
  { value: 'practice', label: 'Practice' },
  { value: 'chapter', label: 'Chapter test' },
  { value: 'topic', label: 'Topic test' },
  { value: 'full_mock', label: 'Full mock' },
  { value: 'previous_year', label: 'Previous year' },
  { value: 'board', label: 'Board' },
  { value: 'custom', label: 'Custom' },
];

export default function AdminExamsPage() {
  useDocumentTitle('Examinations');
  const navigate = useNavigate();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const { examTypes } = useAdminTaxonomy();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [courseId, setCourseId] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<AdminExam | null>(null);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const courses = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/courses', { pageSize: 100 });
  const series = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/test-series', { pageSize: 100 });

  const exams = useApiQuery<Paginated<AdminExam>>(
    '/api/admin/exams',
    { q: q || undefined, status: status || undefined, kind: kind || undefined, courseId: courseId || undefined, page, pageSize: 25 },
    { deps: [q, status, kind, courseId, page] },
  );

  const manage = hasPermission('exams.manage');
  const canPublish = hasPermission('exams.publish');

  const columns: Column<AdminExam>[] = [
    {
      key: 'title',
      header: 'Examination',
      render: (row) => (
        <div className="min-w-0">
          <Link to={`/admin/exams/${row.id}`} className="block truncate text-[13px] font-semibold hover:text-brand-600">{row.title}</Link>
          <p className="truncate text-[10.5px] text-slate-500">
            {KINDS.find((k) => k.value === row.examKind)?.label ?? row.examKind}
            {row.examTypeName ? ` · ${row.examTypeName}` : ''}
            {row.courseName ? ` · ${row.courseName}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'config',
      header: 'Config',
      hideOnMobile: true,
      render: (row) => (
        <div className="text-[11px]">
          <p>{row.totalQuestions} Q · {row.totalMarks} marks</p>
          <p className="text-slate-500">{row.durationMinutes} min · {row.maxAttempts} attempt(s)</p>
        </div>
      ),
    },
    {
      key: 'window',
      header: 'Window',
      hideOnMobile: true,
      render: (row) =>
        row.startAt || row.endAt ? (
          <span className="text-[11px] text-slate-600 dark:text-slate-400">
            {row.startAt ? formatDateTime(row.startAt) : 'open'} → {row.endAt ? formatDateTime(row.endAt) : 'open'}
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">Always open</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={row.status === 'published' ? 'success' : row.status === 'scheduled' ? 'brand' : row.status === 'draft' ? 'warning' : 'neutral'}>{row.status}</Badge>
          <span className="text-[10px] text-slate-500">{row.attemptCount} attempts</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Link to={`/admin/exams/${row.id}`} className="rounded border border-slate-200 p-1 text-slate-500 hover:text-brand-600 dark:border-slate-700" aria-label="Open builder">
            <Settings2 className="h-3 w-3" aria-hidden />
          </Link>
          <Link to={`/tests/${row.id}`} target="_blank" className="rounded border border-slate-200 p-1 text-slate-500 dark:border-slate-700" aria-label="Student preview">
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
          <Link to={`/admin/analytics?examId=${row.id}`} className="rounded border border-slate-200 p-1 text-slate-500 dark:border-slate-700" aria-label="Analytics">
            <BarChart3 className="h-3 w-3" aria-hidden />
          </Link>
          {canPublish ? (
            <button
              type="button"
              onClick={() => setPublishTarget(row)}
              className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${row.status === 'published' ? 'border-amber-200 text-amber-700 dark:border-amber-900' : 'border-emerald-200 text-emerald-700 dark:border-emerald-900'}`}
            >
              <Send className="h-2.5 w-2.5" aria-hidden /> {row.status === 'published' ? 'Unpublish' : 'Publish'}
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Examination manager"
        description="Create tests, configure marking, attach questions and control result release."
        onRefresh={exams.refetch}
        refreshing={exams.loading}
        actions={
          manage ? (
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setCreateOpen(true)}>
              New examination
            </Button>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search examinations" className="min-w-[160px] flex-1 sm:max-w-xs" />
        <FilterSelect label="Status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: '', label: 'All statuses' }, { value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'archived', label: 'Archived' }]} />
        <FilterSelect label="Type" value={kind} onChange={(value) => { setKind(value); setPage(1); }} options={[{ value: '', label: 'All types' }, ...KINDS]} />
        <FilterSelect label="Course" value={courseId} onChange={(value) => { setCourseId(value); setPage(1); }} options={[{ value: '', label: 'All courses' }, ...(courses.data?.items ?? []).map((course) => ({ value: course.id, label: course.name }))]} />
      </div>

      <DataTable
        rows={exams.data?.items ?? []}
        columns={columns}
        loading={exams.loading && !exams.data}
        error={exams.error}
        rowKey={(row) => row.id}
        page={exams.data?.page}
        totalPages={exams.data?.totalPages}
        total={exams.data?.total}
        onPage={setPage}
        onRowClick={(row) => navigate(`/admin/exams/${row.id}`)}
        emptyMessage="No examinations yet. Create your first test."
      />

      <ResourceForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New examination"
        submitLabel="Create & add questions"
        initial={{
          title: '',
          description: '',
          instructions: '',
          examKind: 'practice',
          courseId: '',
          examTypeId: '',
          testSeriesId: '',
          durationMinutes: 60,
          marksPerQuestion: 4,
          negativeMarks: 1,
          negativeMarkingEnabled: true,
          shuffleQuestions: false,
          shuffleOptions: false,
          allowSectionNavigation: true,
          maxAttempts: 1,
          resultPublishMode: 'immediate',
          passingPercentage: 0,
          isFree: true,
          status: 'draft',
          startAt: '',
          endAt: '',
        }}
        fields={[
          { name: 'title', label: 'Title', type: 'text', required: true, span: 2, placeholder: 'JEE Main 2026 — Full Mock 1' },
          { name: 'description', label: 'Description', type: 'textarea', span: 2 },
          { name: 'instructions', label: 'Instructions shown before the test', type: 'textarea', span: 2 },
          { name: 'examKind', label: 'Test type', type: 'select', options: KINDS },
          { name: 'examTypeId', label: 'Examination type', type: 'select', options: examTypes.map((exam) => ({ value: exam.id, label: exam.name })) },
          { name: 'courseId', label: 'Course', type: 'select', options: (courses.data?.items ?? []).map((course) => ({ value: course.id, label: course.name })) },
          { name: 'testSeriesId', label: 'Test series', type: 'select', options: (series.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })) },
          { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', min: 1, max: 600 },
          { name: 'maxAttempts', label: 'Maximum attempts', type: 'number', min: 1, max: 100 },
          { name: 'marksPerQuestion', label: 'Default marks per question', type: 'number', min: 0 },
          { name: 'negativeMarks', label: 'Negative marks per wrong answer', type: 'number', min: 0 },
          { name: 'passingPercentage', label: 'Passing percentage', type: 'number', min: 0, max: 100 },
          {
            name: 'resultPublishMode',
            label: 'Result release',
            type: 'select',
            options: [
              { value: 'immediate', label: 'Immediately after submission' },
              { value: 'after_window', label: 'After the exam window closes' },
              { value: 'manual', label: 'Manually by admin' },
            ],
          },
          { name: 'status', label: 'Status', type: 'select', options: [{ value: 'draft', label: 'Draft' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'published', label: 'Published' }] },
          { name: 'startAt', label: 'Opens at', type: 'date' },
          { name: 'endAt', label: 'Closes at', type: 'date' },
          { name: 'negativeMarkingEnabled', label: 'Negative marking enabled', type: 'checkbox' },
          { name: 'shuffleQuestions', label: 'Shuffle questions per student', type: 'checkbox' },
          { name: 'shuffleOptions', label: 'Shuffle options per student', type: 'checkbox' },
          { name: 'allowSectionNavigation', label: 'Allow moving between sections', type: 'checkbox' },
          { name: 'isFree', label: 'Free test', type: 'checkbox' },
        ]}
        submit={async (values) => {
          setCreateError(null);
          try {
            const payload = {
              ...values,
              startAt: values.startAt ? new Date(`${String(values.startAt)}T00:00:00.000Z`).toISOString() : null,
              endAt: values.endAt ? new Date(`${String(values.endAt)}T23:59:59.000Z`).toISOString() : null,
              status: values.status === 'scheduled' && !values.startAt ? 'draft' : values.status,
            };
            const result = await api.post<{ id: string }>('/api/admin/exams', payload);
            toast.success('Examination created — add questions next');
            setCreateOpen(false);
            navigate(`/admin/exams/${result.id}`);
          } catch (err) {
            setCreateError(errorMessage(err));
            throw err;
          }
        }}
        onSaved={() => exams.refetch()}
      />
      {createError ? <div className="mt-2"><Alert tone="error">{createError}</Alert></div> : null}

      <ConfirmDialog
        open={Boolean(publishTarget)}
        title={publishTarget?.status === 'published' ? 'Unpublish this examination?' : 'Publish this examination?'}
        description={
          publishTarget?.status === 'published'
            ? 'Students will no longer see or start the test. Existing results stay published.'
            : `“${publishTarget?.title ?? ''}” will appear on the student Tests page${publishTarget?.startAt ? ` and open at ${formatDate(publishTarget.startAt)}` : ''}. Publishing requires at least one question.`
        }
        confirmLabel={publishTarget?.status === 'published' ? 'Unpublish' : 'Publish'}
        tone={publishTarget?.status === 'published' ? 'danger' : 'primary'}
        loading={busy}
        onCancel={() => setPublishTarget(null)}
        onClose={() => setPublishTarget(null)}
        onConfirm={async () => {
          if (!publishTarget) return;
          setBusy(true);
          try {
            await api.post(`/api/admin/exams/${publishTarget.id}/publish`, { publish: publishTarget.status !== 'published' });
            toast.success(publishTarget.status === 'published' ? 'Examination unpublished' : 'Examination published');
            setPublishTarget(null);
            exams.refetch();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
