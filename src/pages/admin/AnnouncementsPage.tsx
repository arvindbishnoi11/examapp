import { useState } from 'react';
import { CalendarClock, Megaphone, Pin, Plus, Trash2 } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Badge, ConfirmDialog } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { PageHeader } from '@/components/admin/AdminUI';
import { ResourceForm } from '@/components/admin/ResourceManager';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { formatDateTime } from '@/lib/format';
import type { Paginated } from '@shared/types';

type Announcement = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
  priority: string;
  isPinned: boolean;
  targetAudience: string;
  classId: string | null;
  examTypeId: string | null;
  className: string | null;
  examTypeName: string | null;
  status: string;
  publishAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const AUDIENCES = [
  { value: 'all', label: 'All students' },
  { value: 'class', label: 'A class' },
  { value: 'exam_type', label: 'A target exam' },
];

const PRIORITY_TONE: Record<string, 'neutral' | 'brand' | 'warning' | 'danger'> = {
  low: 'neutral',
  normal: 'brand',
  high: 'warning',
  urgent: 'danger',
};

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function AdminAnnouncementsPage() {
  useDocumentTitle('Announcements');
  const toast = useToast();
  const { hasPermission } = useAuth();
  const { classes, examTypes } = useAdminTaxonomy();
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);

  const manage = hasPermission('announcements.manage');
  const announcements = useApiQuery<Paginated<Announcement>>('/api/admin/announcements', { page }, { deps: [page] });

  const columns: Column<Announcement>[] = [
    {
      key: 'title',
      header: 'Announcement',
      render: (row) => (
        <div className="flex min-w-0 items-start gap-2">
          <Megaphone className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${row.priority === 'urgent' ? 'text-rose-500' : 'text-brand-500'}`} aria-hidden />
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate text-[12.5px] font-semibold">
              {row.isPinned ? <Pin className="h-3 w-3 shrink-0 text-amber-500" aria-hidden /> : null}
              {row.title}
            </p>
            <p className="line-clamp-2 text-[11px] text-slate-500">{row.body}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'audience',
      header: 'Audience',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-[11px] capitalize">
          {row.targetAudience.replace(/_/g, ' ')}
          {row.className ? ` · ${row.className}` : ''}
          {row.examTypeName ? ` · ${row.examTypeName}` : ''}
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      hideOnMobile: true,
      render: (row) => <Badge tone={PRIORITY_TONE[row.priority] ?? 'neutral'}>{row.priority}</Badge>,
    },
    {
      key: 'schedule',
      header: 'Timing',
      render: (row) => (
        <div className="text-[10.5px] text-slate-500">
          <p className="flex items-center gap-1"><CalendarClock className="h-2.5 w-2.5" aria-hidden />{row.publishAt ? formatDateTime(row.publishAt) : 'Immediately'}</p>
          <p>{row.expiresAt ? `until ${formatDateTime(row.expiresAt)}` : 'no expiry'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={row.status === 'published' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'}>{row.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) =>
        manage ? (
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => { setEditing(row); setFormOpen(true); }} className="rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">Edit</button>
            <button type="button" onClick={() => setDeleting(row)} className="rounded border border-rose-200 p-1 text-rose-500 dark:border-rose-900" aria-label="Delete announcement">
              <Trash2 className="h-3 w-3" aria-hidden />
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Banners shown on the student dashboard and announcements page. Supports pinning, priority and scheduling."
        onRefresh={announcements.refetch}
        refreshing={announcements.loading}
        actions={
          manage ? (
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => { setEditing(null); setFormOpen(true); }}>
              New announcement
            </Button>
          ) : undefined
        }
      />

      <DataTable
        rows={announcements.data?.items ?? []}
        columns={columns}
        loading={announcements.loading && !announcements.data}
        error={announcements.error}
        rowKey={(row) => row.id}
        page={announcements.data?.page}
        totalPages={announcements.data?.totalPages}
        total={announcements.data?.total}
        onPage={setPage}
        emptyMessage="No announcements yet."
      />

      <ResourceForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        title={editing ? 'Edit announcement' : 'New announcement'}
        submitLabel={editing ? 'Save changes' : 'Create announcement'}
        initial={{
          title: editing?.title ?? '',
          body: editing?.body ?? '',
          imageUrl: editing?.imageUrl ?? '',
          linkUrl: editing?.linkUrl ?? '',
          priority: editing?.priority ?? 'normal',
          isPinned: Boolean(editing?.isPinned),
          targetAudience: editing?.targetAudience ?? 'all',
          classId: editing?.classId ?? '',
          examTypeId: editing?.examTypeId ?? '',
          status: editing?.status ?? 'published',
          publishAt: toLocalInput(editing?.publishAt ?? null),
          expiresAt: toLocalInput(editing?.expiresAt ?? null),
        }}
        fields={[
          { name: 'title', label: 'Title', type: 'text', required: true, span: 2 },
          { name: 'body', label: 'Message', type: 'textarea', required: true, span: 2, placeholder: 'Keep it short — two or three sentences work best.' },
          { name: 'targetAudience', label: 'Audience', type: 'select', options: AUDIENCES },
          { name: 'status', label: 'Status', type: 'select', options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }] },
          { name: 'classId', label: 'Class (for class audience)', type: 'select', options: classes.map((item) => ({ value: item.id, label: item.name })) },
          { name: 'examTypeId', label: 'Exam type (for exam audience)', type: 'select', options: examTypes.map((item) => ({ value: item.id, label: item.name })) },
          { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES },
          { name: 'publishAt', label: 'Publish at (optional)', type: 'datetime' },
          { name: 'expiresAt', label: 'Expires at (optional)', type: 'datetime' },
          { name: 'imageUrl', label: 'Banner image URL', type: 'text', span: 2 },
          { name: 'linkUrl', label: 'Link URL', type: 'text', span: 2 },
          { name: 'isPinned', label: 'Pin to top', type: 'checkbox' },
        ]}
        submit={async (values) => {
          const payload = {
            title: values.title,
            body: values.body,
            imageUrl: values.imageUrl || undefined,
            linkUrl: values.linkUrl || undefined,
            priority: values.priority,
            isPinned: Boolean(values.isPinned),
            status: values.status,
            publishAt: isoOrUndefined(values.publishAt),
            expiresAt: isoOrUndefined(values.expiresAt),
            ...(editing
              ? {}
              : {
                  target_audience: values.targetAudience,
                  classId: values.targetAudience === 'class' ? values.classId || undefined : undefined,
                  examTypeId: values.targetAudience === 'exam_type' ? values.examTypeId || undefined : undefined,
                }),
          };
          if (editing) await api.put(`/api/admin/announcements/${editing.id}`, payload);
          else await api.post('/api/admin/announcements', payload);
          toast.success(editing ? 'Announcement updated' : 'Announcement published');
        }}
        onSaved={() => { setFormOpen(false); setEditing(null); announcements.refetch(); }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this announcement?"
        description="It disappears from student dashboards immediately."
        confirmLabel="Delete"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await api.delete(`/api/admin/announcements/${deleting.id}`, { confirm: 'DELETE' });
            toast.success('Announcement deleted');
            setDeleting(null);
            announcements.refetch();
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}
