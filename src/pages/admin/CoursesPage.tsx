import { Link } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { ResourceManager, type FieldDef } from '@/components/admin/ResourceManager';
import { Badge } from '@/components/ui';
import { formatDate } from '@/lib/format';

type AdminCourse = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  coverImageUrl: string | null;
  classId: string | null;
  examTypeId: string | null;
  className: string | null;
  examTypeName: string | null;
  isFree: number | boolean;
  isFeatured: number | boolean;
  status: string;
  visibility: string;
  priceInr: number;
  tags: string | null;
  sortOrder: number;
  subjectCount: number;
  lectureCount: number;
  examCount: number;
  createdAt: string;
};

export default function AdminCoursesPage() {
  useDocumentTitle('Courses');
  const { hasPermission } = useAuth();
  const { classes, examTypes } = useAdminTaxonomy();

  const fields: FieldDef[] = [
    { name: 'name', label: 'Course name', type: 'text', required: true, span: 2, placeholder: 'Class 12 Physics — Complete Course' },
    { name: 'shortDescription', label: 'Short description', type: 'text', span: 2, placeholder: 'One line shown on cards' },
    { name: 'description', label: 'Full description', type: 'textarea', span: 2 },
    { name: 'coverImageUrl', label: 'Cover image URL', type: 'url', span: 2, placeholder: 'https://images.unsplash.com/…' },
    { name: 'classId', label: 'Class', type: 'select', options: classes.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'examTypeId', label: 'Target examination', type: 'select', options: examTypes.map((e) => ({ value: e.id, label: e.name })) },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'draft', label: 'Draft (hidden)' },
        { value: 'published', label: 'Published' },
        { value: 'archived', label: 'Archived' },
      ],
    },
    {
      name: 'visibility',
      label: 'Visibility',
      type: 'select',
      options: [
        { value: 'public', label: 'Public (SEO / anonymous)' },
        { value: 'restricted', label: 'Signed-in students only' },
      ],
    },
    { name: 'isFree', label: 'Free course', type: 'checkbox' },
    { name: 'isFeatured', label: 'Feature on home page', type: 'checkbox' },
    { name: 'priceInr', label: 'Price (INR)', type: 'number', min: 0, hint: 'Display only — payments are not processed in this build.' },
    { name: 'sortOrder', label: 'Sort order', type: 'number', min: 0, hint: 'Lower numbers appear first.' },
    { name: 'tags', label: 'Tags', type: 'tags', span: 2 },
  ];

  return (
    <ResourceManager<AdminCourse>
      title="Courses"
      description="Create and publish courses. Subjects, lectures and tests are added inside each course."
      listPath="/api/admin/courses"
      updatePath={(row) => `/api/admin/courses/${row.id}`}
      deletePath={(row) => `/api/admin/courses/${row.id}`}
      rowKey={(row) => row.id}
      canCreate={hasPermission('courses.manage')}
      canEdit={hasPermission('courses.manage')}
      canDelete={hasPermission('courses.manage')}
      createLabel="New course"
      searchPlaceholder="Search courses"
      emptyMessage="No courses yet. Create your first course to start adding content."
      filters={[
        { key: 'status', label: 'Status', options: [{ value: '', label: 'All statuses' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }] },
        { key: 'classId', label: 'Class', options: [{ value: '', label: 'All classes' }, ...classes.map((c) => ({ value: c.id, label: c.name }))] },
        { key: 'examTypeId', label: 'Exam', options: [{ value: '', label: 'All exams' }, ...examTypes.map((e) => ({ value: e.id, label: e.name }))] },
      ]}
      columns={[
        {
          key: 'name',
          header: 'Course',
          render: (row) => (
            <div className="flex items-center gap-2">
              <div className="h-9 w-14 shrink-0 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                {row.coverImageUrl ? <img src={row.coverImageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
              </div>
              <div className="min-w-0">
                <Link to={`/courses/${row.id}`} className="block truncate text-[13px] font-semibold hover:text-brand-600">{row.name}</Link>
                <p className="truncate text-[10.5px] text-slate-500">{row.subjectCount} subjects · {row.lectureCount} lectures · {row.examCount} tests</p>
              </div>
            </div>
          ),
        },
        {
          key: 'taxonomy',
          header: 'Class / Exam',
          hideOnMobile: true,
          render: (row) => <span className="text-[11.5px]">{[row.className, row.examTypeName].filter(Boolean).join(' · ') || '—'}</span>,
        },
        {
          key: 'status',
          header: 'Status',
          render: (row) => (
            <div className="flex flex-wrap gap-1">
              <Badge tone={row.status === 'published' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'}>{row.status}</Badge>
              {row.isFeatured ? <Badge tone="brand">featured</Badge> : null}
            </div>
          ),
        },
        {
          key: 'created',
          header: 'Created',
          hideOnMobile: true,
          render: (row) => <span className="text-[11px] text-slate-500">{formatDate(row.createdAt)}</span>,
        },
      ]}
      fields={fields}
      defaults={{ status: 'draft', visibility: 'public', isFree: true, isFeatured: false, priceInr: 0, sortOrder: 0 }}
      toForm={(row) =>
        row
          ? {
              ...row,
              isFree: Boolean(row.isFree),
              isFeatured: Boolean(row.isFeatured),
              tags: row.tags ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
            }
          : {}
      }
      prepare={(values) => ({
        ...values,
        tags: Array.isArray(values.tags) ? values.tags : undefined,
        priceInr: values.priceInr === '' ? 0 : values.priceInr,
      })}
    />
  );
}
