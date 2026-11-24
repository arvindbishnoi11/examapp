import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, ListVideo, PlayCircle, Plus, Video } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, ConfirmDialog, Modal, Spinner, Tabs } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { PageHeader, Panel, SearchInput, FilterSelect } from '@/components/admin/AdminUI';
import { ResourceManager } from '@/components/admin/ResourceManager';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { formatDate, formatDurationLabel } from '@/lib/format';
import { parseYouTubeUrl, youtubeThumbnail } from '@shared/youtube';
import type { AdminLecture, Paginated } from '@shared/types';

type SeriesRow = {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  courseId: string;
  courseName: string | null;
  chapterId: string | null;
  chapterName: string | null;
  lectureCount: number;
  totalMinutes: number;
  isFree: number;
  status: string;
  sortOrder: number;
};

export default function AdminLecturesPage() {
  useDocumentTitle('Lecture series & lectures');
  const [tab, setTab] = useState<'lectures' | 'series'>('lectures');
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const { hasPermission } = useAuth();

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'lectures', label: 'Lectures' }, { value: 'series', label: 'Lecture series' }]}
        className="mb-4 max-w-sm"
      />

      {tab === 'lectures' ? (
        <LecturesTab
          canManage={hasPermission('lectures.manage')}
          onImport={() => setYoutubeOpen(true)}
        />
      ) : (
        <SeriesTab canManage={hasPermission('lectures.manage')} />
      )}

      <YouTubeAddModal open={youtubeOpen} onClose={() => setYoutubeOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

function LecturesTab({ canManage, onImport }: { canManage: boolean; onImport: () => void }) {
  useDocumentTitle('Lectures');
  const { classes } = useAdminTaxonomy();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [courseId, setCourseId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<AdminLecture | null>(null);
  const [deleteRow, setDeleteRow] = useState<AdminLecture | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const courses = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/courses', { pageSize: 100 });
  const series = useApiQuery<Paginated<SeriesRow>>('/api/admin/lecture-series', { pageSize: 100 });

  const lectures = useApiQuery<Paginated<AdminLecture>>(
    '/api/admin/lectures',
    { q: q || undefined, status: status || undefined, courseId: courseId || undefined, seriesId: seriesId || undefined, page, pageSize: 30 },
    { deps: [q, status, courseId, seriesId, page] },
  );

  const columns: Column<AdminLecture>[] = useMemo(
    () => [
      {
        key: 'title',
        header: 'Lecture',
        render: (row) => (
          <div className="flex items-center gap-2">
            <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
              {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
              {row.durationSeconds ? (
                <span className="absolute bottom-0 right-0 rounded-tl bg-slate-900/80 px-1 text-[9px] font-semibold text-white">
                  {formatDurationLabel(row.durationSeconds)}
                </span>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{row.title}</p>
              <p className="truncate text-[10.5px] text-slate-500">
                {row.youtubeVideoId}{row.lectureNumber ? ` · #${row.lectureNumber}` : ''}
              </p>
            </div>
          </div>
        ),
      },
      { key: 'taxonomy', header: 'Course / Series', hideOnMobile: true, render: (row) => <span className="text-[11px]">{[row.courseName, row.seriesTitle].filter(Boolean).join(' · ') || 'Unassigned'}</span> },
      { key: 'status', header: 'Status', render: (row) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={row.status === 'published' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'}>{row.status}</Badge>
          {row.isFree ? <Badge tone="brand">free</Badge> : null}
        </div>
      ) },
      { key: 'views', header: 'Views', hideOnMobile: true, render: (row) => <span className="text-[11.5px] tabular-nums">{row.viewCount}</span> },
      {
        key: 'actions',
        header: '',
        className: 'text-right',
        render: (row) => (
          <div className="flex flex-wrap justify-end gap-1">
            <Link to={`/lectures/${row.id}`} target="_blank" className="rounded border border-slate-200 p-1 text-slate-500 dark:border-slate-700" aria-label="Preview">
              <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
            {canManage ? (
              <>
                <button type="button" onClick={() => setEditRow(row)} className="rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">Edit</button>
                <button type="button" onClick={() => setDeleteRow(row)} className="rounded border border-rose-200 px-2 py-0.5 text-[10.5px] font-semibold text-rose-600 dark:border-rose-900">Delete</button>
              </>
            ) : null}
          </div>
        ),
      },
    ],
    [canManage],
  );

  return (
    <div>
      <PageHeader
        title="Lectures"
        description="YouTube lectures are embedded from the original player — never re-hosted."
        onRefresh={lectures.refetch}
        refreshing={lectures.loading}
        actions={
          canManage ? (
            <>
              <Button size="sm" variant="secondary" icon={<Video className="h-3.5 w-3.5 text-rose-600" aria-hidden />} onClick={onImport}>
                Import from YouTube
              </Button>
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setAddOpen(true)}>
                Add lecture
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Title or video ID" className="min-w-[160px] flex-1 sm:max-w-xs" />
        <FilterSelect label="Status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: '', label: 'All statuses' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }]} />
        <FilterSelect label="Course" value={courseId} onChange={(value) => { setCourseId(value); setPage(1); }} options={[{ value: '', label: 'All courses' }, ...(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        <FilterSelect label="Series" value={seriesId} onChange={(value) => { setSeriesId(value); setPage(1); }} options={[{ value: '', label: 'All series' }, ...(series.data?.items ?? []).map((s) => ({ value: s.id, label: s.title }))]} />
      </div>

      <DataTable
        rows={lectures.data?.items ?? []}
        columns={columns}
        loading={lectures.loading && !lectures.data}
        error={lectures.error}
        rowKey={(row) => row.id}
        page={lectures.data?.page}
        totalPages={lectures.data?.totalPages}
        total={lectures.data?.total}
        onPage={setPage}
        emptyMessage="No lectures yet. Add one with a YouTube URL."
      />

      <LectureFormModal
        open={addOpen || Boolean(editRow)}
        row={editRow}
        onClose={() => { setAddOpen(false); setEditRow(null); }}
        onSaved={() => { setAddOpen(false); setEditRow(null); lectures.refetch(); }}
        courses={courses.data?.items ?? []}
        series={series.data?.items ?? []}
        classes={classes}
      />

      <ConfirmDialog
        open={Boolean(deleteRow)}
        title="Delete this lecture?"
        description={`“${deleteRow?.title ?? ''}” will be removed from the catalogue. Student progress rows are kept but orphaned.`}
        confirmLabel="Delete lecture"
        loading={busy}
        onCancel={() => setDeleteRow(null)}
        onClose={() => setDeleteRow(null)}
        onConfirm={async () => {
          if (!deleteRow) return;
          setBusy(true);
          try {
            await api.delete(`/api/admin/lectures/${deleteRow.id}`, { confirm: 'DELETE' });
            toast.success('Lecture deleted');
            setDeleteRow(null);
            lectures.refetch();
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}

function LectureFormModal({
  open,
  row,
  onClose,
  onSaved,
  courses,
  series,
  classes,
}: {
  open: boolean;
  row: AdminLecture | null;
  onClose: () => void;
  onSaved: () => void;
  courses: { id: string; name: string }[];
  series: SeriesRow[];
  classes: { id: string; name: string }[];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [form, setForm] = useState({
    youtubeUrl: '',
    youtubeVideoId: '',
    title: '',
    description: '',
    thumbnailUrl: '',
    courseId: '',
    seriesId: '',
    lectureNumber: '',
    durationSeconds: '',
    language: 'en',
    isFree: false,
    status: 'draft',
    visibility: 'public',
    sortOrder: '0',
  });

  // Reset when the modal opens for a new row.
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    setError(null);
    setWarning(null);
    setForm({
      youtubeUrl: row?.youtubeUrl ?? '',
      youtubeVideoId: row?.youtubeVideoId ?? '',
      title: row?.title ?? '',
      description: row?.description ?? '',
      thumbnailUrl: row?.thumbnailUrl ?? '',
      courseId: row?.courseId ?? '',
      seriesId: row?.seriesId ?? '',
      lectureNumber: row?.lectureNumber ? String(row.lectureNumber) : '',
      durationSeconds: row?.durationSeconds ? String(row.durationSeconds) : '',
      language: row?.language ?? 'en',
      isFree: Boolean(row?.isFree),
      status: row?.status ?? 'draft',
      visibility: row?.visibility ?? 'public',
      sortOrder: String(row?.sortOrder ?? 0),
    });
  }

  const parsed = parseYouTubeUrl(form.youtubeUrl);
  const previewId = form.youtubeVideoId || (parsed.kind === 'video' ? parsed.videoId : parsed.kind === 'playlist' ? parsed.videoId ?? '' : '');

  const save = async () => {
    setBusy(true);
    setError(null);
    setWarning(null);
    const payload: Record<string, unknown> = {
      youtubeUrl: form.youtubeUrl || undefined,
      youtubeVideoId: form.youtubeVideoId || undefined,
      title: form.title || undefined,
      description: form.description || undefined,
      thumbnailUrl: form.thumbnailUrl || undefined,
      courseId: form.courseId || undefined,
      seriesId: form.seriesId || undefined,
      lectureNumber: form.lectureNumber ? Number(form.lectureNumber) : undefined,
      durationSeconds: form.durationSeconds ? Number(form.durationSeconds) : undefined,
      language: form.language,
      isFree: form.isFree,
      status: form.status,
      visibility: form.visibility,
      sortOrder: Number(form.sortOrder) || 0,
      fetchMetadata: !row && !form.title,
    };
    try {
      if (row) {
        await api.put(`/api/admin/lectures/${row.id}`, payload);
        toast.success('Lecture updated');
      } else {
        const result = await api.post<{ id: string; metadataWarning?: string | null }>('/api/admin/lectures', payload);
        if (result.metadataWarning) toast.warning(result.metadataWarning);
        else toast.success('Lecture created');
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      if ((err as { status?: number }).status === 422) {
        setWarning('YouTube metadata could not be fetched. Enter a title manually and save again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={row ? 'Edit lecture' : 'Add lecture'}
      description={row ? `Video ID ${row.youtubeVideoId}` : 'Paste any YouTube watch, youtu.be, shorts or embed link.'}
      size="lg"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={busy} onClick={save}>{row ? 'Save changes' : 'Create lecture'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {warning ? <Alert tone="warning">{warning}</Alert> : null}

        {!row ? (
          <div>
            <label className="label" htmlFor="yt-url">YouTube URL</label>
            <input
              id="yt-url"
              className="input"
              value={form.youtubeUrl}
              onChange={(event) => setForm({ ...form, youtubeUrl: event.target.value })}
              placeholder="https://www.youtube.com/watch?v=… or https://youtu.be/…"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Title, description, thumbnail and duration are fetched automatically when <code>YOUTUBE_API_KEY</code> is configured.
            </p>
          </div>
        ) : null}

        {previewId ? (
          <div className="flex gap-3 rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
            <img src={youtubeThumbnail(previewId, 'medium')} alt="" className="h-16 w-28 rounded object-cover" />
            <div className="min-w-0 text-[11.5px]">
              <p className="font-semibold">Preview</p>
              <p className="truncate text-slate-500">Video ID: {previewId}</p>
              <p className="text-slate-500">Embedded with the official YouTube player.</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="lec-title">Title {row ? '' : '(leave blank to fetch from YouTube)'}</label>
            <input id="lec-title" className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={200} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="lec-desc">Description</label>
            <textarea id="lec-desc" className="input min-h-[70px]" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="lec-course">Course</label>
            <select id="lec-course" className="input" value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })}>
              <option value="">—</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lec-series">Lecture series</label>
            <select id="lec-series" className="input" value={form.seriesId} onChange={(event) => setForm({ ...form, seriesId: event.target.value })}>
              <option value="">—</option>
              {series.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lec-number">Lecture number</label>
            <input id="lec-number" type="number" min={0} className="input" value={form.lectureNumber} onChange={(event) => setForm({ ...form, lectureNumber: event.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="lec-duration">Duration (seconds)</label>
            <input id="lec-duration" type="number" min={0} className="input" value={form.durationSeconds} onChange={(event) => setForm({ ...form, durationSeconds: event.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="lec-status">Status</label>
            <select id="lec-status" className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lec-visibility">Visibility</label>
            <select id="lec-visibility" className="input" value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}>
              <option value="public">Public</option>
              <option value="restricted">Signed-in only</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lec-language">Language</label>
            <select id="lec-language" className="input" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lec-sort">Sort order</label>
            <input id="lec-sort" type="number" min={0} className="input" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px] sm:col-span-2">
            <input type="checkbox" checked={form.isFree} onChange={(event) => setForm({ ...form, isFree: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
            Free lecture (visible to signed-out visitors)
          </label>
        </div>
        <p className="text-[10.5px] text-slate-400">{classes.length} classes available · {courses.length} courses · {series.length} series</p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Lecture series
// ---------------------------------------------------------------------------

function SeriesTab({ canManage }: { canManage: boolean }) {
  const [courseId, setCourseId] = useState('');
  const [detail, setDetail] = useState<SeriesRow | null>(null);
  const courses = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/courses', { pageSize: 100 });

  return (
    <>
      <ResourceManager<SeriesRow>
        title="Lecture series"
        description="A series groups lectures within a chapter, in order."
        listPath="/api/admin/lecture-series"
        updatePath={(row) => `/api/admin/lecture-series/${row.id}`}
        deletePath={(row) => `/api/admin/lecture-series/${row.id}`}
        rowKey={(row) => row.id}
        canCreate={canManage}
        canEdit={canManage}
        canDelete={canManage}
        createLabel="New series"
        searchPlaceholder="Search series"
        query={{ courseId: courseId || undefined }}
        filters={[{ key: 'courseId', label: 'Course', options: [{ value: '', label: 'All courses' }, ...(courses.data?.items ?? []).map((course) => ({ value: course.id, label: course.name }))] }]}
        emptyMessage="No lecture series yet."
        columns={[
          {
            key: 'title',
            header: 'Series',
            render: (row) => (
              <div className="flex items-center gap-2">
                <div className="h-8 w-14 shrink-0 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{row.title}</p>
                  <p className="truncate text-[10.5px] text-slate-500">{row.courseName}{row.chapterName ? ` · ${row.chapterName}` : ''}</p>
                </div>
              </div>
            ),
          },
          { key: 'lectures', header: 'Lectures', render: (row) => <span className="text-[11.5px]">{row.lectureCount} · {Math.round(row.totalMinutes)} min</span> },
          { key: 'status', header: 'Status', render: (row) => <Badge tone={row.status === 'published' ? 'success' : 'warning'}>{row.status}</Badge> },
        ]}
        fields={[
          { name: 'title', label: 'Title', type: 'text', required: true },
          { name: 'courseId', label: 'Course', type: 'select', required: true, options: (courses.data?.items ?? []).map((course) => ({ value: course.id, label: course.name })) },
          { name: 'description', label: 'Description', type: 'textarea', span: 2 },
          { name: 'thumbnailUrl', label: 'Thumbnail URL', type: 'url', span: 2 },
          { name: 'status', label: 'Status', type: 'select', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }] },
          { name: 'isFree', label: 'Free series', type: 'checkbox' },
        ]}
        defaults={{ status: 'draft', isFree: false }}
        toForm={(row) => (row ? { ...row, isFree: Boolean(row.isFree) } : {})}
        prepare={(values) => ({ ...values, isFree: values.isFree ? 1 : 0 })}
        rowActions={(row) => (
          <button type="button" onClick={() => setDetail(row)} className="rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            View series
          </button>
        )}
      />

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.title ?? 'Series'} size="lg">
        {detail ? (
          <>
            <p className="text-[12.5px] text-slate-500">{detail.description ?? 'No description.'}</p>
            <div className="mt-2 flex gap-3">
              <a href={`/series/${detail.id}`} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open student view
              </a>
            </div>
            <SeriesLectureList seriesId={detail.id} />
          </>
        ) : null}
      </Modal>
    </>
  );
}

function SeriesLectureList({ seriesId }: { seriesId: string }) {
  const lectures = useApiQuery<Paginated<AdminLecture>>('/api/admin/lectures', { seriesId, pageSize: 100 });
  if (lectures.loading) return <Spinner />;
  return (
    <div className="mt-3">
      <h3 className="mb-1 text-[13px] font-semibold">Lectures in this series</h3>
      {!lectures.data?.items.length ? (
        <p className="text-[12px] text-slate-500">No lectures assigned yet.</p>
      ) : (
        <ol className="divide-y divide-slate-100 dark:divide-slate-800">
          {lectures.data.items.map((lecture) => (
            <li key={lecture.id} className="flex items-center gap-2 py-1.5">
              <span className="w-6 text-[11px] font-bold text-slate-400">{lecture.lectureNumber ?? '—'}</span>
              <PlayCircle className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{lecture.title}</span>
              <Badge tone={lecture.status === 'published' ? 'success' : 'warning'}>{lecture.status}</Badge>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 flex items-center gap-1 text-[10.5px] text-slate-400"><ListVideo className="h-3 w-3" aria-hidden /> Reorder using each lecture's sort order / lecture number.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// YouTube quick import
// ---------------------------------------------------------------------------

function YouTubeAddModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [meta, setMeta] = useState<{ ok: boolean; title?: string; channelName?: string; durationSeconds?: number; thumbnailUrl?: string; message?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [courseId, setCourseId] = useState('');
  const [status, setStatus] = useState('draft');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleOverride, setTitleOverride] = useState('');
  const courses = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/courses', { pageSize: 100 }, { enabled: open });

  const parsed = parseYouTubeUrl(url);
  const videoId = parsed.kind === 'video' ? parsed.videoId : null;

  const fetchMeta = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<typeof meta>('/api/admin/youtube/metadata', { url });
      setMeta(result);
      if (!result?.ok) setTitleOverride('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!videoId) { setError('Enter a valid YouTube video URL.'); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await api.post<{ id: string; metadataWarning?: string | null }>('/api/admin/lectures', {
        youtubeUrl: url,
        title: titleOverride || undefined,
        courseId: courseId || undefined,
        status,
        fetchMetadata: true,
      });
      if (result.metadataWarning) toast.warning(result.metadataWarning);
      else toast.success('Lecture imported');
      setUrl(''); setMeta(null); setTitleOverride('');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import a lecture from YouTube"
      description="Paste a link, verify the metadata, then save it as a draft."
      size="lg"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="secondary" loading={loading} onClick={fetchMeta} disabled={!videoId}>Fetch metadata</Button>
          <Button size="sm" loading={saving} onClick={save} disabled={!videoId}>Save lecture</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <label className="label" htmlFor="yt-import-url">YouTube URL</label>
          <input id="yt-import-url" className="input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          {url && !videoId ? <p className="mt-1 text-[11px] text-amber-600">{parsed.kind === 'playlist' ? 'This is a playlist link — use the YouTube Manager → Playlists tab to import it.' : 'Not a recognised video URL.'}</p> : null}
        </div>

        {videoId ? (
          <div className="flex gap-3 rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
            <img src={meta?.thumbnailUrl ?? youtubeThumbnail(videoId, 'medium')} alt="" className="h-20 w-36 rounded object-cover" />
            <div className="min-w-0 text-[12px]">
              <p className="line-clamp-2-safe font-semibold">{meta?.title ?? 'Metadata not fetched yet'}</p>
              <p className="text-slate-500">{meta?.channelName ?? '—'}</p>
              <p className="text-slate-500">{meta?.durationSeconds ? formatDurationLabel(meta.durationSeconds) : ''}</p>
              {meta && !meta.ok ? <p className="mt-1 text-[11px] text-amber-600">{meta.message ?? 'YouTube API unavailable — enter the title manually.'}</p> : null}
            </div>
          </div>
        ) : null}

        {meta && !meta.ok ? (
          <div>
            <label className="label" htmlFor="yt-title">Title (required when metadata is unavailable)</label>
            <input id="yt-title" className="input" value={titleOverride} onChange={(event) => setTitleOverride(event.target.value)} />
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="yt-course">Course</label>
            <select id="yt-course" className="input" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
              <option value="">—</option>
              {(courses.data?.items ?? []).map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="yt-status">Status</label>
            <select id="yt-status" className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>
        <p className="text-[10.5px] text-slate-400">Publish date, view counts and video availability are always read from YouTube at playback time.</p>
      </div>
    </Modal>
  );
}
