import { useState } from 'react';
import { BellRing, Radio, Send, Users } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { PageHeader, Panel } from '@/components/admin/AdminUI';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { formatDateTime } from '@/lib/format';
import type { Paginated } from '@shared/types';

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  deepLink: string | null;
  targetType: string;
  targetValue: string | null;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  successCount: number;
  failedCount: number;
  deliveredCount: number;
  errorMessage: string | null;
  createdAt: string;
};

type Health = { configured?: boolean; tokenCount?: number; error?: string; serviceAccountEmail?: string | null; [key: string]: unknown };
type Preview = { recipients: number; description: string; devices: number };

const TARGETS = [
  { value: 'all', label: 'Everyone' },
  { value: 'class', label: 'A class' },
  { value: 'exam_type', label: 'A target exam' },
  { value: 'course', label: 'A course' },
];

export default function AdminNotificationsPage() {
  useDocumentTitle('Push notifications');
  const toast = useToast();
  const { hasPermission } = useAuth();
  const { classes, examTypes } = useAdminTaxonomy();
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ title: '', body: '', imageUrl: '', deepLink: '', targetType: 'all', targetValue: '', scheduledAt: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = hasPermission('notifications.send');
  const history = useApiQuery<Paginated<NotificationRow> & { configured: boolean }>('/api/admin/notifications', { page }, { deps: [page] });
  const health = useApiQuery<Health>('/api/admin/notifications/health');
  const courses = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/courses', { pageSize: 100 });

  const targetOptions =
    form.targetType === 'class'
      ? classes.map((item) => ({ value: item.id, label: item.name }))
      : form.targetType === 'exam_type'
        ? examTypes.map((item) => ({ value: item.id, label: item.name }))
        : form.targetType === 'course'
          ? (courses.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }))
          : [];

  const columns: Column<NotificationRow>[] = [
    {
      key: 'title',
      header: 'Notification',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold">{row.title}</p>
          <p className="line-clamp-2 text-[11px] text-slate-500">{row.body}</p>
        </div>
      ),
    },
    {
      key: 'audience',
      header: 'Audience',
      hideOnMobile: true,
      render: (row) => <span className="text-[11px] capitalize">{row.targetType.replace(/_/g, ' ')}</span>,
    },
    {
      key: 'delivery',
      header: 'Delivery',
      render: (row) => (
        <div className="text-[11px] tabular-nums">
          <p>{row.deliveredCount ?? 0} delivered · {(row.failedCount ?? 0)} failed</p>
          <p className="text-slate-500">{row.sentAt ? formatDateTime(row.sentAt) : row.scheduledAt ? `scheduled ${formatDateTime(row.scheduledAt)}` : '—'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : row.status === 'scheduled' ? 'brand' : 'warning'}>{row.status}</Badge>
          {row.errorMessage ? <span className="max-w-[160px] truncate text-[10px] text-rose-500" title={row.errorMessage}>{row.errorMessage}</span> : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Push notifications"
        description="Send targeted notifications through Firebase Cloud Messaging to students who allowed notifications."
        onRefresh={() => { history.refetch(); health.refetch(); }}
        refreshing={history.loading}
      />

      {!health.data?.configured ? (
        <Alert tone="warning" title="Firebase Admin is not configured">
          Notifications cannot be delivered yet. Set the <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> secret so the Worker can
          sign OAuth tokens for FCM v1. You can still compose and schedule messages — they will be queued but delivery will
          fail until credentials exist.
        </Alert>
      ) : (
        <Alert tone="success" title={`FCM ready · ${health.data?.tokenCount ?? 0} active device(1) token(s)`}>
          Messages deliver to students who installed the PWA and granted notification permission.
        </Alert>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Panel title="Compose" action={<Radio className="h-3.5 w-3.5 text-brand-600" aria-hidden />}>
          <div className="space-y-2.5">
            {error ? <Alert tone="error">{error}</Alert> : null}
            <div>
              <label className="label" htmlFor="n-title">Title</label>
              <input id="n-title" className="input" maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Tomorrow's mock starts at 10 AM" />
            </div>
            <div>
              <label className="label" htmlFor="n-body">Message</label>
              <textarea id="n-body" className="input min-h-[82px]" maxLength={1000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="Your JEE Main full mock 2 opens tomorrow. Revisions done?" />
              <p className="mt-0.5 text-right text-[10px] text-slate-400">{form.body.length}/1000</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="n-target">Audience</label>
                <select id="n-target" className="input" value={form.targetType} onChange={(event) => setForm({ ...form, targetType: event.target.value, targetValue: '' })}>
                  {TARGETS.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
                </select>
              </div>
              {form.targetType !== 'all' ? (
                <div>
                  <label className="label" htmlFor="n-target-value">{form.targetType === 'class' ? 'Class' : form.targetType === 'exam_type' ? 'Target exam' : 'Course'}</label>
                  <select id="n-target-value" className="input" value={form.targetValue} onChange={(event) => setForm({ ...form, targetValue: event.target.value })}>
                    <option value="">Select…</option>
                    {targetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="n-link">Deep link (optional)</label>
                <input id="n-link" className="input" value={form.deepLink} onChange={(event) => setForm({ ...form, deepLink: event.target.value })} placeholder="/tests or https://…" />
              </div>
              <div>
                <label className="label" htmlFor="n-image">Image URL (optional)</label>
                <input id="n-image" className="input" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} placeholder="https://…" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="n-schedule">Schedule (optional)</label>
              <input id="n-schedule" type="datetime-local" className="input" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} />
              <p className="mt-0.5 text-[10.5px] text-slate-400">Leave empty to send immediately. Scheduled messages are delivered by the 15-minute cron.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="secondary"
                icon={<Users className="h-3.5 w-3.5" aria-hidden />}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const result = await api.post<Preview>('/api/admin/notifications/audience-preview', { targetType: form.targetType, targetValue: form.targetValue || null });
                    setPreview(result);
                    toast.info(`${result.recipients} student(s) match`);
                  } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
                }}
              >
                Preview audience
              </Button>
              <Button
                size="sm"
                disabled={!canSend}
                loading={busy}
                icon={form.scheduledAt ? <BellRing className="h-3.5 w-3.5" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.post('/api/admin/notifications/send', {
                      title: form.title.trim(),
                      body: form.body.trim(),
                      imageUrl: form.imageUrl || undefined,
                      deepLink: form.deepLink || undefined,
                      targetType: form.targetType,
                      targetValue: form.targetType === 'all' ? undefined : form.targetValue,
                      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
                    });
                    toast.success(form.scheduledAt ? 'Notification scheduled' : 'Notification sent');
                    setForm({ ...form, title: '', body: '', imageUrl: '', deepLink: '', scheduledAt: '' });
                    history.refetch();
                  } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
                }}
              >
                {form.scheduledAt ? 'Schedule' : 'Send now'}
              </Button>
              {!canSend ? <span className="text-[11px] text-slate-500">You need the notifications.send permission.</span> : null}
            </div>

            {preview ? (
              <div className="rounded-lg bg-slate-50 p-2.5 text-[11.5px] dark:bg-slate-800/60">
                <p className="font-semibold">{preview.recipients} students · {preview.devices} active devices</p>
                <p className="text-slate-500">{preview.description}</p>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Recent notifications">
          <DataTable
            rows={history.data?.items ?? []}
            columns={columns}
            loading={history.loading && !history.data}
            error={history.error}
            rowKey={(row) => row.id}
            page={history.data?.page}
            totalPages={history.data?.totalPages}
            total={history.data?.total}
            onPage={setPage}
            emptyMessage="No notifications sent yet."
          />
        </Panel>
      </div>

      <div className="mt-4 rounded-xl2 border border-slate-200 bg-white p-3.5 text-[11.5px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <p className="mb-1 font-semibold text-slate-800 dark:text-slate-200">Delivery notes</p>
        In-app notifications are always recorded for the recipient; push uses FCM v1 with the service-account JWT.
        Audience targeting is resolved server-side (class, exam type, course or everyone) and respects suspended accounts.
        Failed sends record the provider error on the row so you can retry.
      </div>
    </div>
  );
}
