import { useEffect, useMemo, useState } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, ConfirmDialog, Modal, Spinner } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { FilterSelect, PageHeader, SearchInput } from '@/components/admin/AdminUI';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { formatDate } from '@/lib/format';
import type { Paginated, SubjectRef, ChapterRef } from '@shared/types';

type QuestionRow = {
  id: string;
  questionText: string;
  questionType: string;
  difficulty: string;
  marks: number;
  negativeMarks: number;
  status: string;
  source: string | null;
  year: number | null;
  tags: string | null;
  subjectId: string | null;
  chapterId: string | null;
  subjectName: string | null;
  chapterName: string | null;
  optionCount: number;
  usageCount: number;
  createdAt: string;
};

type QuestionDetail = {
  question: Record<string, unknown> & { id: string; question_text: string; question_type: string; explanation?: string | null; passage_text: string | null };
  options: { key: string; text: string | null; imageUrl: string | null; isCorrect: boolean }[];
  answerKey: { answer_type: string; correct_options: string | null; numeric_answer: number | null; numeric_tolerance: number | null; integer_answer: number | null } | null;
  explanation: { explanation_text: string } | null;
};

const TYPES = [
  { value: 'single_correct', label: 'Single correct' },
  { value: 'multiple_correct', label: 'Multiple correct' },
  { value: 'numerical', label: 'Numerical' },
  { value: 'integer', label: 'Integer' },
  { value: 'passage', label: 'Passage based' },
  { value: 'image_based', label: 'Image based' },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

type OptionDraft = { key: string; text: string; imageUrl: string; isCorrect: boolean };

const emptyOption = (key: string): OptionDraft => ({ key, text: '', imageUrl: '', isCorrect: false });

export default function AdminQuestionsPage() {
  useDocumentTitle('Question bank');
  const toast = useToast();
  const { hasPermission } = useAuth();
  const { examTypes } = useAdminTaxonomy();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [status, setStatus] = useState('');
  const [courseId, setCourseId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<QuestionRow | null>(null);
  const [editing, setEditing] = useState<QuestionDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<QuestionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const manage = hasPermission('questions.manage');
  const courses = useApiQuery<Paginated<{ id: string; name: string }>>('/api/admin/courses', { pageSize: 100 });
  const subjects = useApiQuery<{ items: SubjectRef[] }>('/api/subjects', { courseId: courseId || undefined }, { enabled: Boolean(courseId) });
  const chapters = useApiQuery<{ items: ChapterRef[] }>('/api/chapters', { subjectId: subjectId || undefined }, { enabled: Boolean(subjectId) });
  const detail = useApiQuery<QuestionDetail>(selected ? `/api/admin/questions/${selected.id}` : null, undefined, { enabled: Boolean(selected) });

  const questions = useApiQuery<Paginated<QuestionRow>>(
    '/api/admin/questions',
    {
      q: q || undefined,
      type: type || undefined,
      difficulty: difficulty || undefined,
      status: status || undefined,
      subjectId: subjectId || undefined,
      chapterId: chapterId || undefined,
      page,
      pageSize: 25,
    },
    { deps: [q, type, difficulty, status, subjectId, chapterId, page] },
  );

  const columns: Column<QuestionRow>[] = [
    {
      key: 'text',
      header: 'Question',
      render: (row) => (
        <div className="min-w-0">
          <p className="line-clamp-2 text-[12.5px] leading-snug">{row.questionText || '(no text)'}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {TYPE_LABEL[row.questionType] ?? row.questionType} · {row.difficulty}
            {row.subjectName ? ` · ${row.subjectName}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'marks', header: 'Marks', hideOnMobile: true, render: (row) => <span className="text-[11.5px] tabular-nums">+{row.marks} / −{row.negativeMarks}</span> },
    {
      key: 'usage',
      header: 'Usage',
      hideOnMobile: true,
      render: (row) => (
        <div className="text-[10.5px] text-slate-500">
          <p>{row.optionCount} options</p>
          <p>{row.usageCount} exam(s)</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <Badge tone={row.status === 'published' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'}>{row.status}</Badge> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setSelected(row)} className="rounded border border-slate-200 p-1 text-slate-500 hover:text-brand-600 dark:border-slate-700" aria-label="View question">
            <Eye className="h-3 w-3" aria-hidden />
          </button>
          {manage ? (
            <button type="button" onClick={async () => { setSelected(row); }} className="rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
              Edit
            </button>
          ) : null}
          {manage ? (
            <button type="button" onClick={() => setDeleting(row)} className="rounded border border-rose-200 p-1 text-rose-500 dark:border-rose-900" aria-label="Delete question">
              <Trash2 className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Question bank"
        description="Reusable questions with answer keys and explanations. Keys are never exposed to students before submission."
        onRefresh={questions.refetch}
        refreshing={questions.loading}
        actions={
          manage ? (
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setCreating(true)}>
              New question
            </Button>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search question text" className="min-w-[160px] flex-1 sm:max-w-xs" />
        <FilterSelect label="Type" value={type} onChange={(value) => { setType(value); setPage(1); }} options={[{ value: '', label: 'All types' }, ...TYPES]} />
        <FilterSelect label="Difficulty" value={difficulty} onChange={(value) => { setDifficulty(value); setPage(1); }} options={[{ value: '', label: 'All levels' }, { value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
        <FilterSelect label="Status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: '', label: 'All statuses' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }]} />
        <FilterSelect label="Course" value={courseId} onChange={(value) => { setCourseId(value); setSubjectId(''); setChapterId(''); setPage(1); }} options={[{ value: '', label: 'All courses' }, ...(courses.data?.items ?? []).map((course) => ({ value: course.id, label: course.name }))]} />
        {courseId ? (
          <FilterSelect label="Subject" value={subjectId} onChange={(value) => { setSubjectId(value); setChapterId(''); setPage(1); }} options={[{ value: '', label: 'All subjects' }, ...(subjects.data?.items ?? []).map((subject) => ({ value: subject.id, label: subject.name }))]} />
        ) : null}
        {subjectId ? (
          <FilterSelect label="Chapter" value={chapterId} onChange={(value) => { setChapterId(value); setPage(1); }} options={[{ value: '', label: 'All chapters' }, ...(chapters.data?.items ?? []).map((chapter) => ({ value: chapter.id, label: chapter.name }))]} />
        ) : null}
      </div>

      <DataTable
        rows={questions.data?.items ?? []}
        columns={columns}
        loading={questions.loading && !questions.data}
        error={questions.error}
        rowKey={(row) => row.id}
        page={questions.data?.page}
        totalPages={questions.data?.totalPages}
        total={questions.data?.total}
        onPage={setPage}
        emptyMessage="No questions match. Create one to get started."
      />

      {/* ---- Detail / edit ---------------------------------------------- */}
      <QuestionViewer
        open={Boolean(selected)}
        detail={detail.data}
        loading={detail.loading}
        canEdit={manage}
        onClose={() => setSelected(null)}
        onEdit={() => setEditing(detail.data ?? null)}
        onChanged={() => { questions.refetch(); setSelected(null); }}
      />

      <QuestionEditor
        open={creating || Boolean(editing)}
        detail={editing}
        examTypes={examTypes}
        courses={courses.data?.items ?? []}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); setSelected(null); questions.refetch(); }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this question?"
        description={deleting?.usageCount ? `It is used in ${deleting.usageCount} examination(s). Deleting will remove it from those exams.` : 'The question and its answer key will be removed permanently.'}
        confirmLabel="Delete question"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await api.delete(`/api/admin/questions/${deleting.id}`, { confirm: 'DELETE' });
            toast.success('Question deleted');
            setDeleting(null);
            questions.refetch();
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}

function QuestionViewer({
  open,
  detail,
  loading,
  canEdit,
  onClose,
  onEdit,
  onChanged,
}: {
  open: boolean;
  detail: QuestionDetail | null | undefined;
  loading: boolean;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [statusBusy, setStatusBusy] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Question" size="lg"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {canEdit && detail ? (
            <Button size="sm" onClick={onEdit}>Edit question</Button>
          ) : null}
        </>
      }
    >
      {loading || !detail ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="brand">{TYPE_LABEL[detail.question.question_type] ?? detail.question.question_type}</Badge>
            <Badge tone="neutral">{String(detail.question.difficulty)}</Badge>
            <Badge tone={detail.question.status === 'published' ? 'success' : 'warning'}>{String(detail.question.status)}</Badge>
            <Badge tone="neutral">+{String(detail.question.marks)} / −{String(detail.question.negative_marks)}</Badge>
          </div>
          {detail.question.passage_text ? (
            <div className="rounded-lg bg-slate-50 p-2.5 text-[12.5px] dark:bg-slate-800/60">{detail.question.passage_text}</div>
          ) : null}
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{detail.question.question_text}</p>

          {detail.options.length ? (
            <ul className="space-y-1.5">
              {detail.options.map((option) => (
                <li key={option.key} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] ${option.isCorrect ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40' : 'border-slate-200 dark:border-slate-800'}`}>
                  <span className="font-bold">{option.key}.</span>
                  <span className="min-w-0 flex-1">{option.text}{option.imageUrl ? <img src={option.imageUrl} alt="" className="mt-1 max-h-28 rounded" /> : null}</span>
                  {option.isCorrect ? <Badge tone="success">correct</Badge> : null}
                </li>
              ))}
            </ul>
          ) : detail.answerKey ? (
            <p className="text-[12.5px]">
              <span className="text-slate-500">Correct answer: </span>
              <strong>{detail.answerKey.integer_answer ?? detail.answerKey.numeric_answer}
                {detail.answerKey.numeric_tolerance ? ` ± ${detail.answerKey.numeric_tolerance}` : ''}
              </strong>
            </p>
          ) : null}

          {detail.explanation?.explanation_text ? (
            <div className="rounded-lg bg-slate-50 p-2.5 text-[12.5px] dark:bg-slate-800/60">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Explanation (shown after submission)</p>
              <p className="whitespace-pre-wrap">{detail.explanation.explanation_text}</p>
            </div>
          ) : null}

          {canEdit ? (
            <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
              {['published', 'draft', 'archived'].map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={statusBusy || String(detail.question.status) === status}
                  onClick={async () => {
                    setStatusBusy(true);
                    try {
                      await api.put(`/api/admin/questions/${detail.question.id}`, { status });
                      toast.success(`Question ${status}`);
                      onChanged();
                    } catch (err) { toast.error(errorMessage(err)); } finally { setStatusBusy(false); }
                  }}
                  className="rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                >
                  Mark {status}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function QuestionEditor({
  open,
  detail,
  examTypes,
  courses,
  onClose,
  onSaved,
}: {
  open: boolean;
  detail: QuestionDetail | null | undefined;
  examTypes: { id: string; name: string }[];
  courses: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    questionText: '',
    questionType: 'single_correct',
    difficulty: 'medium',
    subjectId: '',
    chapterId: '',
    courseId: '',
    examTypeId: '',
    questionImageUrl: '',
    passageText: '',
    passageImageUrl: '',
    explanation: '',
    marks: 4,
    negativeMarks: 1,
    source: '',
    year: '',
    status: 'published',
    numericAnswer: '',
    numericTolerance: 0,
  });
  const [options, setOptions] = useState<OptionDraft[]>([emptyOption('A'), emptyOption('B'), emptyOption('C'), emptyOption('D')]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjects = useApiQuery<{ items: SubjectRef[] }>('/api/subjects', { courseId: form.courseId || undefined }, { enabled: Boolean(form.courseId) });
  const chapters = useApiQuery<{ items: ChapterRef[] }>('/api/chapters', { subjectId: form.subjectId || undefined }, { enabled: Boolean(form.subjectId) });

  useEffect(() => {
    if (!open) return;
    if (detail) {
      const question = detail.question;
      setForm({
        questionText: String(question.question_text ?? ''),
        questionType: String(question.question_type ?? 'single_correct'),
        difficulty: String(question.difficulty ?? 'medium'),
        subjectId: String(question.subject_id ?? ''),
        chapterId: String(question.chapter_id ?? ''),
        courseId: String(question.course_id ?? ''),
        examTypeId: String(question.exam_type_id ?? ''),
        questionImageUrl: String(question.question_image_url ?? ''),
        passageText: String(question.passage_text ?? ''),
        passageImageUrl: String(question.passage_image_url ?? ''),
        explanation: detail.explanation?.explanation_text ?? '',
        marks: Number(question.marks ?? 4),
        negativeMarks: Number(question.negative_marks ?? 1),
        source: String(question.source ?? ''),
        year: question.year ? String(question.year) : '',
        status: String(question.status ?? 'published'),
        numericAnswer: detail.answerKey?.numeric_answer !== null && detail.answerKey?.numeric_answer !== undefined
          ? String(detail.answerKey.integer_answer ?? detail.answerKey.numeric_answer)
          : '',
        numericTolerance: Number(detail.answerKey?.numeric_tolerance ?? 0),
      });
      const opts = detail.options.map((option) => ({ key: option.key, text: option.text ?? '', imageUrl: option.imageUrl ?? '', isCorrect: option.isCorrect }));
      setOptions(opts.length ? opts : [emptyOption('A'), emptyOption('B'), emptyOption('C'), emptyOption('D')]);
    } else {
      setForm({
        questionText: '', questionType: 'single_correct', difficulty: 'medium', subjectId: '', chapterId: '', courseId: '', examTypeId: '',
        questionImageUrl: '', passageText: '', passageImageUrl: '', explanation: '', marks: 4, negativeMarks: 1, source: '', year: '',
        status: 'published', numericAnswer: '', numericTolerance: 0,
      });
      setOptions([emptyOption('A'), emptyOption('B'), emptyOption('C'), emptyOption('D')]);
    }
    setError(null);
  }, [open, detail]);

  const isNumeric = form.questionType === 'numerical' || form.questionType === 'integer';

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        questionText: form.questionText.trim(),
        questionType: form.questionType,
        difficulty: form.difficulty,
        subjectId: form.subjectId || undefined,
        chapterId: form.chapterId || undefined,
        courseId: form.courseId || undefined,
        examTypeId: form.examTypeId || undefined,
        questionImageUrl: form.questionImageUrl || undefined,
        passageText: form.passageText || undefined,
        passageImageUrl: form.passageImageUrl || undefined,
        explanation: form.explanation || undefined,
        marks: Number(form.marks) || 0,
        negativeMarks: Number(form.negativeMarks) || 0,
        source: form.source || undefined,
        year: form.year ? Number(form.year) : undefined,
        status: form.status,
      };
      if (isNumeric) {
        payload.numericAnswer = Number(form.numericAnswer);
        payload.numericTolerance = Number(form.numericTolerance) || 0;
        payload.correctOptions = [];
      } else {
        payload.options = options.filter((option) => option.text.trim() || option.imageUrl).map((option) => ({ key: option.key, text: option.text.trim() || null, imageUrl: option.imageUrl || null }));
        payload.correctOptions = options.filter((option) => option.isCorrect).map((option) => option.key);
      }

      if (detail) await api.put(`/api/admin/questions/${detail.question.id}`, payload);
      else await api.post('/api/admin/questions', payload);
      toast.success(detail ? 'Question updated' : 'Question created');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const correctCount = options.filter((option) => option.isCorrect).length;

  return (
    <Modal open={open} onClose={onClose} title={detail ? 'Edit question' : 'New question'} size="xl"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={busy} onClick={save}>{detail ? 'Save changes' : 'Create question'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="q-type">Question type</label>
            <select id="q-type" className="input" value={form.questionType} onChange={(event) => setForm({ ...form, questionType: event.target.value })}>
              {TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="q-diff">Difficulty</label>
            <select id="q-diff" className="input" value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="q-status">Status</label>
            <select id="q-status" className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="q-text">Question text</label>
          <textarea id="q-text" className="input min-h-[90px]" value={form.questionText} onChange={(event) => setForm({ ...form, questionText: event.target.value })} placeholder="Use plain text or simple HTML-free formatting. LaTeX is rendered as written." />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="q-course">Course</label>
            <select id="q-course" className="input" value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value, subjectId: '', chapterId: '' })}>
              <option value="">—</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="q-exam">Exam type</label>
            <select id="q-exam" className="input" value={form.examTypeId} onChange={(event) => setForm({ ...form, examTypeId: event.target.value })}>
              <option value="">—</option>
              {examTypes.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
            </select>
          </div>
          {form.courseId ? (
            <div>
              <label className="label" htmlFor="q-subject">Subject</label>
              <select id="q-subject" className="input" value={form.subjectId} onChange={(event) => setForm({ ...form, subjectId: event.target.value, chapterId: '' })}>
                <option value="">—</option>
                {(subjects.data?.items ?? []).map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </div>
          ) : null}
          {form.subjectId ? (
            <div>
              <label className="label" htmlFor="q-chapter">Chapter</label>
              <select id="q-chapter" className="input" value={form.chapterId} onChange={(event) => setForm({ ...form, chapterId: event.target.value })}>
                <option value="">—</option>
                {(chapters.data?.items ?? []).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}
              </select>
            </div>
          ) : null}
        </div>

        {isNumeric ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="q-answer">Correct answer</label>
              <input id="q-answer" type="number" className="input" value={form.numericAnswer} onChange={(event) => setForm({ ...form, numericAnswer: event.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="q-tolerance">Tolerance (±)</label>
              <input id="q-tolerance" type="number" min={0} className="input" value={form.numericTolerance} onChange={(event) => setForm({ ...form, numericTolerance: Number(event.target.value) })} />
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between">
              <p className="label mb-1">Options {form.questionType === 'multiple_correct' ? '(select all correct)' : '(mark one correct)'}</p>
              <button type="button" onClick={() => setOptions((current) => [...current, emptyOption(String.fromCharCode(65 + current.length))])} className="text-[11px] font-semibold text-brand-600">+ Add option</button>
            </div>
            <div className="space-y-1.5">
              {options.map((option, index) => (
                <div key={index} className="flex items-start gap-1.5">
                  <span className="mt-2 w-5 text-[12px] font-bold text-slate-400">{option.key}</span>
                  <input className="input" value={option.text} placeholder={`Option ${option.key}`} onChange={(event) => setOptions((current) => current.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />
                  <button
                    type="button"
                    aria-label={`Mark option ${option.key} correct`}
                    onClick={() => setOptions((current) => current.map((item, i) => form.questionType === 'multiple_correct'
                      ? (i === index ? { ...item, isCorrect: !item.isCorrect } : item)
                      : { ...item, isCorrect: i === index }))}
                    className={`mt-1 shrink-0 rounded border px-1.5 py-1 text-[10px] font-bold ${option.isCorrect ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-slate-400'}`}
                  >
                    ✓
                  </button>
                  {options.length > 2 ? (
                    <button type="button" onClick={() => setOptions((current) => current.filter((_, i) => i !== index))} className="mt-1 shrink-0 rounded border border-rose-200 px-1.5 py-1 text-[10px] font-bold text-rose-500" aria-label="Delete option">×</button>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10.5px] text-slate-400">
              {form.questionType === 'multiple_correct' ? `${correctCount} correct option(s) selected` : correctCount === 1 ? 'One correct option selected' : 'Mark the correct option'}
            </p>
          </div>
        )}

        <details className="rounded-lg border border-slate-200 p-2.5 text-[12px] dark:border-slate-800">
          <summary className="cursor-pointer font-semibold text-slate-600 dark:text-slate-300">Passage, image & explanation (optional)</summary>
          <div className="mt-2 space-y-2">
            <input className="input" placeholder="Passage text" value={form.passageText} onChange={(event) => setForm({ ...form, passageText: event.target.value })} />
            <input className="input" placeholder="Passage image URL" value={form.passageImageUrl} onChange={(event) => setForm({ ...form, passageImageUrl: event.target.value })} />
            <input className="input" placeholder="Question image URL" value={form.questionImageUrl} onChange={(event) => setForm({ ...form, questionImageUrl: event.target.value })} />
            <textarea className="input min-h-[60px]" placeholder="Explanation — shown to students only after the result is released" value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} />
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder="Source (e.g. JEE Main 2024)" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} />
              <input className="input" placeholder="Year" value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} />
            </div>
          </div>
        </details>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="q-marks">Marks</label>
            <input id="q-marks" type="number" min={0} className="input" value={form.marks} onChange={(event) => setForm({ ...form, marks: Number(event.target.value) })} />
          </div>
          <div>
            <label className="label" htmlFor="q-neg">Negative marks</label>
            <input id="q-neg" type="number" min={0} className="input" value={form.negativeMarks} onChange={(event) => setForm({ ...form, negativeMarks: Number(event.target.value) })} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
