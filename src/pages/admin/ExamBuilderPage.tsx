import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Layers,
  Plus,
  Search,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, ConfirmDialog, ErrorState, Modal, Spinner } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { PageHeader, Panel } from '@/components/admin/AdminUI';
import { ResourceForm } from '@/components/admin/ResourceManager';
import { useAdminTaxonomy } from '@/components/admin/AdminContext';
import { formatDateTime } from '@/lib/format';
import type { Paginated } from '@shared/types';

type ExamRow = Record<string, unknown> & {
  id: string;
  title: string;
  status: string;
  description: string | null;
  instructions: string | null;
  exam_kind: string;
  duration_minutes: number;
  marks_per_question: number;
  negative_marks: number;
  negative_marking_enabled: number;
  shuffle_questions: number;
  shuffle_options: number;
  allow_section_navigation: number;
  max_attempts: number;
  result_publish_mode: string;
  passing_percentage: number;
  is_free: number;
  start_at: string | null;
  end_at: string | null;
  total_questions: number;
  total_marks: number;
  exam_type_id: string | null;
  course_id: string | null;
  test_series_id: string | null;
  examTypeName?: string | null;
  courseName?: string | null;
};

type Section = { id: string; title: string; subjectId: string | null; chapterId: string | null; instructions: string | null; isOptional: number; maxQuestions: number | null; sortOrder: number };
type ExamQuestion = { examQuestionId: string; questionId: string; sectionId: string | null; marks: number; negativeMarks: number; sortOrder: number; questionText: string; questionType: string; difficulty: string; subjectName: string | null };

type Bundle = { exam: ExamRow; sections: Section[]; questions: ExamQuestion[]; stats: { attempts?: number; students?: number; avgPercentage?: number | null; bestPercentage?: number | null } };

const KINDS = ['practice', 'chapter', 'topic', 'full_mock', 'previous_year', 'board', 'custom'];

function toDateInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export default function AdminExamBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const { examTypes } = useAdminTaxonomy();

  const bundle = useApiQuery<Bundle>(id ? `/api/admin/exams/${id}` : null);
  const [editOpen, setEditOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [addQuestionsOpen, setAddQuestionsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ExamQuestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeSectionTarget, setRemoveSectionTarget] = useState<Section | null>(null);

  const manage = hasPermission('exams.manage');
  const canPublish = hasPermission('exams.publish');

  useDocumentTitle(bundle.data?.exam.title ?? 'Examination builder');

  const grouped = useMemo(() => {
    const data = bundle.data;
    if (!data) return [];
    const sections = [...data.sections].sort((a, b) => a.sortOrder - b.sortOrder);
    const result = sections.map((section) => ({ section, questions: data.questions.filter((q) => q.sectionId === section.id) }));
    const unsectioned = data.questions.filter((q) => !q.sectionId || !sections.some((s) => s.id === q.sectionId));
    if (unsectioned.length) result.push({ section: null as unknown as Section, questions: unsectioned });
    return result;
  }, [bundle.data]);

  if (bundle.error) return <ErrorState message={bundle.error} onRetry={bundle.refetch} />;
  if (bundle.loading && !bundle.data) return <div className="grid place-items-center py-20"><Spinner /></div>;
  if (!bundle.data) return null;

  const { exam } = bundle.data;
  const marksSum = bundle.data.questions.reduce((sum, question) => sum + Number(question.marks || 0), 0);

  const removeQuestion = async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/exams/${id}/questions/${removeTarget.questionId}`);
      toast.success('Question removed');
      setRemoveTarget(null);
      bundle.refetch();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Link to="/admin/exams" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All examinations
      </Link>

      <PageHeader
        title={exam.title}
        description={`${exam.exam_kind.replace(/_/g, ' ')} · ${exam.duration_minutes} min · ${bundle.data.questions.length} questions · ${marksSum} marks`}
        onRefresh={bundle.refetch}
        refreshing={bundle.loading}
        actions={
          <>
            <Link to={`/tests/${exam.id}`} target="_blank" className="btn-secondary btn-sm">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Preview
            </Link>
            {canPublish ? (
              <Button size="sm" icon={<Send className="h-3.5 w-3.5" aria-hidden />} onClick={() => setPublishOpen(true)}>
                {exam.status === 'published' ? 'Unpublish' : 'Publish'}
              </Button>
            ) : null}
            {manage ? (
              <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>Edit settings</Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: 'Status', value: exam.status },
          { label: 'Total questions', value: bundle.data.questions.length },
          { label: 'Total marks', value: marksSum },
          { label: 'Attempts', value: bundle.data.stats.attempts ?? 0 },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl2 border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{tile.label}</p>
            <p className="mt-0.5 text-[16px] font-bold capitalize tabular-nums">{String(tile.value)}</p>
          </div>
        ))}
      </div>

      {exam.status === 'draft' ? (
        <Alert tone="info" title="This examination is still a draft">
          Students cannot see it. Add questions, configure sections and marking, then publish.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-3">
          <Panel
            title="Questions"
            action={
              manage ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" icon={<Layers className="h-3.5 w-3.5" aria-hidden />} onClick={() => setSectionOpen(true)}>Add section</Button>
                  <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setAddQuestionsOpen(true)}>Add questions</Button>
                </div>
              ) : undefined
            }
          >
            {!bundle.data.questions.length ? (
              <p className="text-[12.5px] text-slate-500">No questions attached. Use “Add questions” to pick from the question bank.</p>
            ) : (
              <div className="space-y-4">
                {grouped.map(({ section, questions }) => (
                  <div key={section?.id ?? 'unsectioned'}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        {section ? section.title : 'Unsectioned'} <span className="font-normal normal-case">({questions.length})</span>
                      </p>
                      {section && manage ? (
                        <button type="button" onClick={() => setRemoveSectionTarget(section)} className="text-[10.5px] font-semibold text-rose-600">Delete section</button>
                      ) : null}
                    </div>
                    <ol className="space-y-1.5">
                      {questions.map((question, index) => (
                        <li key={question.examQuestionId} className="flex items-start gap-2 rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-800">
                          <span className="w-6 shrink-0 text-[11px] font-bold text-slate-400">{index + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-[12.5px] leading-snug">{question.questionText}</p>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {question.questionType.replace(/_/g, ' ')} · {question.difficulty} · +{question.marks}/−{question.negativeMarks}{question.subjectName ? ` · ${question.subjectName}` : ''}
                            </p>
                          </div>
                          {manage ? (
                            <button type="button" onClick={() => setRemoveTarget(question)} className="shrink-0 rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40" aria-label="Remove question">
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="Configuration">
            <dl className="space-y-1.5 text-[12px]">
              {[
                ['Type', exam.exam_kind.replace(/_/g, ' ')],
                ['Subject / exam', exam.examTypeName ?? '—'],
                ['Course', exam.courseName ?? '—'],
                ['Duration', `${exam.duration_minutes} minutes`],
                ['Marks per question', exam.marks_per_question],
                ['Negative marking', exam.negative_marking_enabled ? `−${exam.negative_marks} per wrong answer` : 'Disabled'],
                ['Shuffle questions', exam.shuffle_questions ? 'On' : 'Off'],
                ['Shuffle options', exam.shuffle_options ? 'On' : 'Off'],
                ['Max attempts', exam.max_attempts],
                ['Result release', exam.result_publish_mode.replace(/_/g, ' ')],
                ['Passing', `${exam.passing_percentage}%`],
                ['Opens', exam.start_at ? formatDateTime(exam.start_at) : 'Anytime'],
                ['Closes', exam.end_at ? formatDateTime(exam.end_at) : 'No deadline'],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                  <dd className="text-right font-medium capitalize">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Performance">
            {!bundle.data.stats.attempts ? (
              <p className="text-[12px] text-slate-500">No student attempts yet.</p>
            ) : (
              <dl className="space-y-1.5 text-[12px]">
                <div className="flex justify-between"><dt className="text-slate-500">Attempts</dt><dd className="font-semibold">{bundle.data.stats.attempts}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Unique students</dt><dd className="font-semibold flex items-center gap-1"><Users className="h-3 w-3" aria-hidden />{bundle.data.stats.students}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Average score</dt><dd className="font-semibold">{bundle.data.stats.avgPercentage ?? 0}%</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Best score</dt><dd className="font-semibold">{bundle.data.stats.bestPercentage ?? 0}%</dd></div>
              </dl>
            )}
            <Link to={`/admin/analytics?examId=${exam.id}`} className="mt-2 inline-block text-[11.5px] font-semibold text-brand-600">Detailed analytics →</Link>
          </Panel>

          <Panel title="Answer-key safety">
            <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-400">
              Correct answers are never sent to the student app before submission. The exam session API strips all key
              fields, evaluation runs server-side, and deadlines are enforced by the Worker — not the browser clock.
            </p>
          </Panel>
        </div>
      </div>

      {/* ---- Edit settings --------------------------------------------- */}
      <ResourceForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Examination settings"
        initial={{
          title: exam.title,
          description: exam.description ?? '',
          instructions: exam.instructions ?? '',
          examKind: exam.exam_kind,
          examTypeId: exam.exam_type_id ?? '',
          courseId: exam.course_id ?? '',
          durationMinutes: exam.duration_minutes,
          marksPerQuestion: exam.marks_per_question,
          negativeMarks: exam.negative_marks,
          negativeMarkingEnabled: Boolean(exam.negative_marking_enabled),
          shuffleQuestions: Boolean(exam.shuffle_questions),
          shuffleOptions: Boolean(exam.shuffle_options),
          allowSectionNavigation: Boolean(exam.allow_section_navigation),
          maxAttempts: exam.max_attempts,
          resultPublishMode: exam.result_publish_mode,
          passingPercentage: exam.passing_percentage,
          isFree: Boolean(exam.is_free),
          startAt: toDateInput(exam.start_at),
          endAt: toDateInput(exam.end_at),
        }}
        fields={[
          { name: 'title', label: 'Title', type: 'text', required: true, span: 2 },
          { name: 'description', label: 'Description', type: 'textarea', span: 2 },
          { name: 'instructions', label: 'Instructions', type: 'textarea', span: 2 },
          { name: 'examKind', label: 'Test type', type: 'select', options: KINDS.map((kind) => ({ value: kind, label: kind.replace(/_/g, ' ') })) },
          { name: 'examTypeId', label: 'Exam type', type: 'select', options: examTypes.map((item) => ({ value: item.id, label: item.name })) },
          { name: 'durationMinutes', label: 'Duration (min)', type: 'number', min: 1, max: 600 },
          { name: 'maxAttempts', label: 'Max attempts', type: 'number', min: 1, max: 100 },
          { name: 'marksPerQuestion', label: 'Marks per question', type: 'number', min: 0 },
          { name: 'negativeMarks', label: 'Negative marks', type: 'number', min: 0 },
          { name: 'passingPercentage', label: 'Passing %', type: 'number', min: 0, max: 100 },
          { name: 'resultPublishMode', label: 'Result release', type: 'select', options: [{ value: 'immediate', label: 'Immediate' }, { value: 'after_window', label: 'After window' }, { value: 'manual', label: 'Manual' }] },
          { name: 'startAt', label: 'Opens (date)', type: 'date' },
          { name: 'endAt', label: 'Closes (date)', type: 'date' },
          { name: 'negativeMarkingEnabled', label: 'Negative marking', type: 'checkbox' },
          { name: 'shuffleQuestions', label: 'Shuffle questions', type: 'checkbox' },
          { name: 'shuffleOptions', label: 'Shuffle options', type: 'checkbox' },
          { name: 'allowSectionNavigation', label: 'Section navigation', type: 'checkbox' },
          { name: 'isFree', label: 'Free test', type: 'checkbox' },
        ]}
        submit={async (values) => {
          await api.put(`/api/admin/exams/${exam.id}`, {
            ...values,
            startAt: values.startAt ? new Date(`${String(values.startAt)}T00:00:00.000Z`).toISOString() : null,
            endAt: values.endAt ? new Date(`${String(values.endAt)}T23:59:59.000Z`).toISOString() : null,
          });
          toast.success('Examination updated');
        }}
        onSaved={() => bundle.refetch()}
      />

      {/* ---- Add section ------------------------------------------------ */}
      <ResourceForm
        open={sectionOpen}
        onClose={() => setSectionOpen(false)}
        title="Add section"
        initial={{ title: '', instructions: '', isOptional: false, sortOrder: bundle.data.sections.length }}
        fields={[
          { name: 'title', label: 'Section title', type: 'text', required: true, span: 2, placeholder: 'Physics — Section A' },
          { name: 'instructions', label: 'Section instructions', type: 'textarea', span: 2 },
          { name: 'sortOrder', label: 'Order', type: 'number', min: 0 },
          { name: 'isOptional', label: 'Optional section', type: 'checkbox' },
        ]}
        submit={async (values) => {
          await api.post(`/api/admin/exams/${exam.id}/sections`, values);
          toast.success('Section added');
        }}
        onSaved={() => bundle.refetch()}
      />

      <AddQuestionsModal
        open={addQuestionsOpen}
        examId={exam.id}
        sections={bundle.data.sections}
        existingQuestionIds={bundle.data.questions.map((q) => q.questionId)}
        onClose={() => setAddQuestionsOpen(false)}
        onAdded={() => bundle.refetch()}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove this question from the exam?"
        description="The question stays in the question bank and other exams."
        confirmLabel="Remove"
        loading={busy}
        onCancel={() => setRemoveTarget(null)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={removeQuestion}
      />

      <ConfirmDialog
        open={removeSectionTarget !== null}
        title="Delete this section?"
        description="Questions in the section move to “Unsectioned” — they are not deleted."
        confirmLabel="Delete section"
        loading={busy}
        onCancel={() => setRemoveSectionTarget(null)}
        onClose={() => setRemoveSectionTarget(null)}
        onConfirm={async () => {
          if (!removeSectionTarget) return;
          setBusy(true);
          try {
            await api.delete(`/api/admin/exam-sections/${removeSectionTarget.id}`);
            toast.success('Section deleted');
            setRemoveSectionTarget(null);
            bundle.refetch();
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
      />

      <ConfirmDialog
        open={publishOpen}
        title={exam.status === 'published' ? 'Unpublish examination?' : 'Publish examination?'}
        description={
          exam.status === 'published'
            ? 'Students will no longer see this test.'
            : bundle.data.questions.length
              ? `Students will see it immediately${exam.start_at ? ` and it opens on ${formatDateTime(exam.start_at)}` : ''}.`
              : 'Add at least one question first.'
        }
        confirmLabel={exam.status === 'published' ? 'Unpublish' : 'Publish'}
        tone={exam.status === 'published' ? 'danger' : 'primary'}
        loading={busy}
        onCancel={() => setPublishOpen(false)}
        onClose={() => setPublishOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.post(`/api/admin/exams/${exam.id}/publish`, { publish: exam.status !== 'published' });
            toast.success(exam.status === 'published' ? 'Unpublished' : 'Published');
            setPublishOpen(false);
            bundle.refetch();
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}

function AddQuestionsModal({
  open,
  examId,
  sections,
  existingQuestionIds,
  onClose,
  onAdded,
}: {
  open: boolean;
  examId: string;
  sections: Section[];
  existingQuestionIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const questions = useApiQuery<Paginated<{ id: string; questionText: string; questionType: string; difficulty: string; subjectName: string | null; chapterName: string | null; status: string }>>(
    open ? '/api/admin/questions' : null,
    { q: query || undefined, page, pageSize: 25, status: 'published' },
    { enabled: open, deps: [query, page] },
  );

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add questions from the bank"
      size="xl"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            loading={busy}
            disabled={!selected.size}
            icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api.post<{ added: number; skipped: number }>(`/api/admin/exams/${examId}/questions`, {
                  questionIds: Array.from(selected),
                  sectionId: sectionId || undefined,
                });
                toast.success(`${result.added} added${result.skipped ? `, ${result.skipped} already present` : ''}`);
                setSelected(new Set());
                onAdded();
                onClose();
              } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
            }}
          >
            Add {selected.size || ''} question{selected.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input className="input h-9 py-0 pl-8 text-[13px]" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search question text" aria-label="Search questions" />
          </div>
          <select className="input h-9 w-auto py-0 text-[13px]" value={sectionId} onChange={(event) => setSectionId(event.target.value)} aria-label="Assign to section">
            <option value="">Unsectioned</option>
            {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
          </select>
        </div>

        {questions.loading ? <Spinner /> : !questions.data?.items.length ? (
          <p className="text-[12.5px] text-slate-500">No published questions match. Create questions in the Question Bank first.</p>
        ) : (
          <>
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {questions.data.items.map((question) => {
                const disabled = existingQuestionIds.includes(question.id);
                return (
                  <li key={question.id} className="flex items-start gap-2 py-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                      checked={selected.has(question.id) || disabled}
                      disabled={disabled}
                      onChange={() => toggle(question.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[12.5px] leading-snug">{question.questionText}</p>
                      <p className="text-[10px] text-slate-500">
                        {question.questionType.replace(/_/g, ' ')} · {question.difficulty}
                        {question.subjectName ? ` · ${question.subjectName}` : ''}
                        {question.chapterName ? ` · ${question.chapterName}` : ''}
                      </p>
                    </div>
                    {disabled ? <Badge tone="success">added</Badge> : null}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Page {questions.data.page} of {questions.data.totalPages} · {questions.data.total} questions</span>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page >= questions.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
