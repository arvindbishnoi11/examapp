import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { ResourceManager } from '@/components/admin/ResourceManager';
import { Badge } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApi';
import type { Paginated } from '@shared/types';

type TestSeries = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  courseId: string | null;
  courseName: string | null;
  examTypeId: string | null;
  examTypeName: string | null;
  isFree: number;
  status: string;
  sortOrder: number;
};

export default function AdminTestSeriesPage() {
  useDocumentTitle('Test series');
  const { hasPermission } = useAuth();
  const { examTypes } = useAdminTaxonomy();
  const courses = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/courses', { pageSize: 100 });
  const manage = hasPermission('test_series.manage');

  return (
    <ResourceManager<TestSeries>
      title="Test series"
      description="Group examinations into a series (e.g. “JEE Main 2026 Full Mocks”)."
      listPath="/api/admin/test-series"
      updatePath={(row) => `/api/admin/test-series/${row.id}`}
      deletePath={(row) => `/api/admin/test-series/${row.id}`}
      rowKey={(row) => row.id}
      canCreate={manage}
      canEdit={manage}
      canDelete={manage}
      createLabel="New test series"
      searchPlaceholder="Search test series"
      emptyMessage="No test series yet."
      columns={[
        { key: 'name', header: 'Series', render: (row) => <div><p className="text-[13px] font-semibold">{row.name}</p><p className="text-[10.5px] text-slate-500">{[row.courseName, row.examTypeName].filter(Boolean).join(' · ') || 'Unassigned'}</p></div> },
        { key: 'status', header: 'Status', render: (row) => <div className="flex gap-1"><Badge tone={row.status === 'published' ? 'success' : 'warning'}>{row.status}</Badge>{row.isFree ? <Badge tone="brand">free</Badge> : null}</div> },
        { key: 'sort', header: 'Order', hideOnMobile: true, render: (row) => <span className="text-[11.5px]">{row.sortOrder}</span> },
      ]}
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'description', label: 'Description', type: 'textarea', span: 2 },
        { name: 'courseId', label: 'Course', type: 'select', options: (courses.data?.items ?? []).map((course) => ({ value: course.id, label: course.name })) },
        { name: 'examTypeId', label: 'Examination type', type: 'select', options: examTypes.map((exam) => ({ value: exam.id, label: exam.name })) },
        { name: 'status', label: 'Status', type: 'select', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }] },
        { name: 'isFree', label: 'Free series', type: 'checkbox' },
        { name: 'sortOrder', label: 'Sort order', type: 'number', min: 0 },
      ]}
      defaults={{ status: 'draft', isFree: false, sortOrder: 0 }}
      toForm={(row) => (row ? { ...row, isFree: Boolean(row.isFree) } : {})}
      prepare={(values) => ({ ...values, isFree: values.isFree ? 1 : 0 })}
    />
  );
}
