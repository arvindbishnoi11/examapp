import { useState } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { ResourceManager, type FieldDef } from '@/components/admin/ResourceManager';
import { Badge, Tabs } from '@/components/ui';
import type { Paginated } from '@shared/types';

type ClassRow = { id: string; name: string; slug: string; level: number; description: string | null; color: string | null; icon: string | null; sortOrder: number; isActive: number; courseCount: number };
type ExamTypeRow = { id: string; name: string; slug: string; shortName: string | null; description: string | null; color: string | null; sortOrder: number; isActive: number };
type CourseOption = { id: string; name: string };
type SubjectRow = { id: string; courseId: string; courseName: string | null; name: string; slug: string; color: string | null; description: string | null; sortOrder: number; isActive: number; chapterCount: number };
type ChapterRow = { id: string; subjectId: string; courseId: string; subjectName: string | null; courseName: string | null; name: string; description: string | null; sortOrder: number; isActive: number; lectureCount: number; questionCount: number; weightage: number | null };

export default function AdminTaxonomyPage() {
  useDocumentTitle('Classes, subjects & chapters');
  const { hasPermission } = useAuth();
  const { classes, examTypes } = useAdminTaxonomy();
  const [tab, setTab] = useState<'classes' | 'exams' | 'subjects' | 'chapters'>('classes');
  const [courseFilter, setCourseFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  const manage = hasPermission('courses.manage');
  const courses = useApiQuery<Paginated<CourseOption>>('/api/admin/courses', { pageSize: 100 });
  const subjects = useApiQuery<{ items: SubjectRow[] }>('/api/admin/subjects', { courseId: courseFilter || undefined }, { deps: [courseFilter] });

  const courseField: FieldDef = {
    name: 'courseId',
    label: 'Course',
    type: 'select',
    required: true,
    options: (courses.data?.items ?? []).map((course) => ({ value: course.id, label: course.name })),
  };
  const subjectField: FieldDef = {
    name: 'subjectId',
    label: 'Subject',
    type: 'select',
    required: true,
    options: (subjects.data?.items ?? []).map((subject) => ({ value: subject.id, label: `${subject.name}${subject.courseName ? ` (${subject.courseName})` : ''}` })),
  };

  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'classes', label: 'Classes', count: classes.length },
          { value: 'exams', label: 'Exam types', count: examTypes.length },
          { value: 'subjects', label: 'Subjects' },
          { value: 'chapters', label: 'Chapters' },
        ]}
        className="mb-4 max-w-xl"
      />

      {tab === 'classes' ? (
        <ResourceManager<ClassRow>
          title="Classes"
          description="Class 11, Class 12 and any custom batch. Used everywhere content is filtered by class."
          listPath="/api/admin/classes"
          updatePath={(row) => `/api/admin/classes/${row.id}`}
          deletePath={(row) => `/api/admin/classes/${row.id}`}
          rowKey={(row) => row.id}
          canCreate={manage}
          canEdit={manage}
          canDelete={manage}
          createLabel="New class"
          emptyMessage="No classes defined."
          columns={[
            { key: 'name', header: 'Class', render: (row) => <div><p className="text-[13px] font-semibold">{row.name}</p><p className="text-[10.5px] text-slate-500">{row.courseCount} courses</p></div> },
            { key: 'level', header: 'Level', render: (row) => <Badge tone="neutral">{row.level}</Badge> },
            { key: 'active', header: 'Active', hideOnMobile: true, render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'active' : 'hidden'}</Badge> },
          ]}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'level', label: 'Level', type: 'number', min: 0, max: 20, hint: '11 or 12 for standard classes.' },
            { name: 'description', label: 'Description', type: 'textarea', span: 2 },
            { name: 'color', label: 'Colour', type: 'text', placeholder: '#4f46e5' },
            { name: 'icon', label: 'Icon key', type: 'text', placeholder: 'graduation-cap' },
            { name: 'sortOrder', label: 'Sort order', type: 'number', min: 0 },
            { name: 'isActive', label: 'Active', type: 'checkbox' },
          ]}
          defaults={{ level: 11, sortOrder: 0, isActive: true }}
          toForm={(row) => (row ? { ...row, isActive: Boolean(row.isActive) } : {})}
          prepare={(values) => ({ ...values, isActive: values.isActive ? 1 : 0 })}
        />
      ) : null}

      {tab === 'exams' ? (
        <ResourceManager<ExamTypeRow>
          title="Exam types"
          description="JEE Main, JEE Advanced, NEET, Board and any custom examination you add."
          listPath="/api/admin/exam-types"
          updatePath={(row) => `/api/admin/exam-types/${row.id}`}
          deletePath={(row) => `/api/admin/exam-types/${row.id}`}
          rowKey={(row) => row.id}
          canCreate={manage}
          canEdit={manage}
          canDelete={manage}
          createLabel="New exam type"
          emptyMessage="No examination types defined."
          columns={[
            { key: 'name', header: 'Examination', render: (row) => <div><p className="text-[13px] font-semibold">{row.name}</p><p className="text-[10.5px] text-slate-500">{row.shortName ?? row.slug}</p></div> },
            { key: 'active', header: 'Active', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'active' : 'hidden'}</Badge> },
          ]}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'shortName', label: 'Short name', type: 'text', placeholder: 'JEE Main' },
            { name: 'description', label: 'Description', type: 'textarea', span: 2 },
            { name: 'color', label: 'Colour', type: 'text', placeholder: '#0ea5e9' },
            { name: 'sortOrder', label: 'Sort order', type: 'number', min: 0 },
            { name: 'isActive', label: 'Active', type: 'checkbox' },
          ]}
          defaults={{ sortOrder: 0, isActive: true }}
          toForm={(row) => (row ? { ...row, isActive: Boolean(row.isActive) } : {})}
          prepare={(values) => ({ ...values, isActive: values.isActive ? 1 : 0 })}
        />
      ) : null}

      {tab === 'subjects' ? (
        <>
          <div className="mb-2">
            <select className="input h-9 w-auto py-0 text-[13px]" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} aria-label="Filter by course">
              <option value="">All courses</option>
              {(courses.data?.items ?? []).map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </div>
          <ResourceManager<SubjectRow>
            title="Subjects"
            description="Subjects belong to a course; chapters belong to a subject."
            listPath="/api/admin/subjects"
            updatePath={(row) => `/api/admin/subjects/${row.id}`}
            deletePath={(row) => `/api/admin/subjects/${row.id}`}
            rowKey={(row) => row.id}
            canCreate={manage}
            canEdit={manage}
            canDelete={manage}
            createLabel="New subject"
            query={{ courseId: courseFilter || undefined }}
            emptyMessage="No subjects yet for this course."
            columns={[
              { key: 'name', header: 'Subject', render: (row) => <div><p className="text-[13px] font-semibold">{row.name}</p><p className="text-[10.5px] text-slate-500">{row.courseName} · {row.chapterCount} chapters</p></div> },
              { key: 'sort', header: 'Order', hideOnMobile: true, render: (row) => <span className="text-[11.5px]">{row.sortOrder}</span> },
              { key: 'active', header: 'Active', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'active' : 'hidden'}</Badge> },
            ]}
            fields={[
              courseField,
              { name: 'name', label: 'Subject name', type: 'text', required: true },
              { name: 'description', label: 'Description', type: 'textarea', span: 2 },
              { name: 'color', label: 'Colour', type: 'text', placeholder: '#4f46e5' },
              { name: 'icon', label: 'Icon key', type: 'text' },
              { name: 'sortOrder', label: 'Sort order', type: 'number', min: 0 },
              { name: 'isActive', label: 'Active', type: 'checkbox' },
            ]}
            defaults={{ sortOrder: 0, isActive: true }}
            toForm={(row) => (row ? { ...row, isActive: Boolean(row.isActive) } : { courseId: courseFilter || '' })}
            prepare={(values) => ({ ...values, isActive: values.isActive ? 1 : 0 })}
          />
        </>
      ) : null}

      {tab === 'chapters' ? (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            <select className="input h-9 w-auto py-0 text-[13px]" value={courseFilter} onChange={(event) => { setCourseFilter(event.target.value); setSubjectFilter(''); }} aria-label="Filter by course">
              <option value="">All courses</option>
              {(courses.data?.items ?? []).map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
            <select className="input h-9 w-auto py-0 text-[13px]" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label="Filter by subject">
              <option value="">All subjects</option>
              {(subjects.data?.items ?? []).map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </div>
          <ResourceManager<ChapterRow>
            title="Chapters"
            description="Chapters group lectures, questions and tests. Keep names aligned with NCERT."
            listPath="/api/admin/chapters"
            updatePath={(row) => `/api/admin/chapters/${row.id}`}
            deletePath={(row) => `/api/admin/chapters/${row.id}`}
            rowKey={(row) => row.id}
            canCreate={manage}
            canEdit={manage}
            canDelete={manage}
            createLabel="New chapter"
            query={{ courseId: courseFilter || undefined, subjectId: subjectFilter || undefined }}
            emptyMessage="No chapters yet."
            columns={[
              { key: 'name', header: 'Chapter', render: (row) => <div><p className="text-[13px] font-semibold">{row.name}</p><p className="text-[10.5px] text-slate-500">{[row.subjectName, row.courseName].filter(Boolean).join(' · ')}</p></div> },
              { key: 'content', header: 'Content', hideOnMobile: true, render: (row) => <span className="text-[11px]">{row.lectureCount} lectures · {row.questionCount} questions</span> },
              { key: 'active', header: 'Active', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'active' : 'hidden'}</Badge> },
            ]}
            fields={[
              subjectField,
              { name: 'name', label: 'Chapter name', type: 'text', required: true },
              { name: 'description', label: 'Description', type: 'textarea', span: 2 },
              { name: 'weightage', label: 'Exam weightage (%)', type: 'number', min: 0, max: 100 },
              { name: 'estimatedMinutes', label: 'Estimated study minutes', type: 'number', min: 0 },
              { name: 'sortOrder', label: 'Sort order', type: 'number', min: 0 },
              { name: 'isActive', label: 'Active', type: 'checkbox' },
            ]}
            defaults={{ sortOrder: 0, isActive: true }}
            toForm={(row) => (row ? { ...row, isActive: Boolean(row.isActive) } : { subjectId: subjectFilter || '' })}
            prepare={(values) => ({ ...values, isActive: values.isActive ? 1 : 0 })}
          />
        </>
      ) : null}
    </div>
  );
}
