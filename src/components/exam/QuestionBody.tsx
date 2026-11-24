import type { ExamQuestionView } from '@shared/types';
import { Badge } from '@/components/ui';

export type DraftAnswer = {
  selectedOptions: string[];
  numericAnswer: number | null;
  integerAnswer: number | null;
  status: 'not_answered' | 'answered' | 'marked_for_review' | 'answered_marked';
};

const DIFFICULTY_TONE = { easy: 'success', medium: 'warning', hard: 'danger' } as const;

/**
 * Renders one question exactly as delivered by the server.
 * There is no correctness information in this component's data by design.
 */
export function QuestionBody({
  question,
  index,
  total,
  draft,
  onChange,
  readOnly = false,
}: {
  question: ExamQuestionView;
  index: number;
  total: number;
  draft: DraftAnswer;
  onChange: (patch: Partial<DraftAnswer>) => void;
  readOnly?: boolean;
}) {
  const multiple = question.questionType === 'multiple_correct';
  const numeric = question.questionType === 'numeric';
  const integer = question.questionType === 'integer';

  const toggleOption = (key: string) => {
    if (readOnly) return;
    if (multiple) {
      const has = draft.selectedOptions.includes(key);
      const selectedOptions = has ? draft.selectedOptions.filter((k) => k !== key) : [...draft.selectedOptions, key].sort();
      onChange({ selectedOptions, status: draft.status === 'marked_for_review' ? 'answered_marked' : 'answered' });
    } else {
      onChange({ selectedOptions: [key], status: draft.status === 'marked_for_review' ? 'answered_marked' : 'answered' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Question {index + 1} of {total}
        </span>
        <Badge tone={DIFFICULTY_TONE[question.difficulty] ?? 'neutral'}>{question.difficulty}</Badge>
        <Badge tone="neutral">{question.marks} mark{question.marks === 1 ? '' : 's'}</Badge>
        {question.negativeMarks > 0 ? <Badge tone="danger">−{question.negativeMarks} if wrong</Badge> : null}
        {multiple ? <Badge tone="brand">Select all correct options</Badge> : null}
      </div>

      {question.passageText || question.passageImageUrl ? (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-[13px] leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
          {question.passageText ? <p className="whitespace-pre-wrap">{question.passageText}</p> : null}
          {question.passageImageUrl ? (
            <img src={question.passageImageUrl} alt="Passage" loading="lazy" className="mt-2 max-h-72 rounded-lg object-contain" />
          ) : null}
        </div>
      ) : null}

      <p className="prose-explanation whitespace-pre-wrap text-[15.5px] font-medium leading-relaxed text-slate-900 dark:text-slate-50">
        {question.questionText}
      </p>

      {question.questionImageUrl ? (
        <img
          src={question.questionImageUrl}
          alt="Question figure"
          loading="lazy"
          className="max-h-80 rounded-lg border border-slate-200 object-contain dark:border-slate-800"
        />
      ) : null}

      {numeric || integer ? (
        <div className="space-y-1.5">
          <label className="label" htmlFor={`numeric-${question.examQuestionId}`}>
            {integer ? 'Enter your integer answer' : 'Enter your numerical answer'}
          </label>
          <input
            id={`numeric-${question.examQuestionId}`}
            type="number"
            inputMode={integer ? 'numeric' : 'decimal'}
            step={integer ? 1 : 'any'}
            readOnly={readOnly}
            value={integer ? (draft.integerAnswer ?? '') : (draft.numericAnswer ?? '')}
            onChange={(event) => {
              if (readOnly) return;
              const raw = event.target.value;
              if (raw === '') {
                onChange({ integerAnswer: null, numericAnswer: null, status: draft.status === 'answered_marked' ? 'answered_marked' : 'not_answered' });
                return;
              }
              const parsed = Number(raw);
              if (!Number.isFinite(parsed)) return;
              onChange({
                integerAnswer: integer ? Math.trunc(parsed) : null,
                numericAnswer: integer ? null : parsed,
                status: draft.status === 'marked_for_review' ? 'answered_marked' : 'answered',
              });
            }}
            className="input max-w-xs text-lg font-semibold tabular-nums"
            placeholder={integer ? 'e.g. 42' : 'e.g. 3.14'}
          />
          <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
            {integer ? 'Whole numbers only (may be negative).' : 'Decimals allowed. Use a minus sign for negative values.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2" role={multiple ? 'group' : 'radiogroup'} aria-label="Answer options">
          {question.options.map((option) => {
            const selected = draft.selectedOptions.includes(option.key);
            return (
              <li key={option.key}>
                <button
                  type="button"
                  role={multiple ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                  disabled={readOnly}
                  onClick={() => toggleOption(option.key)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                    selected
                      ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500 dark:bg-brand-950/40'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
                  } ${readOnly ? 'cursor-default opacity-80' : ''}`}
                >
                  <span
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center text-[12px] font-bold ${
                      multiple ? 'rounded-md' : 'rounded-full'
                    } ${selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                  >
                    {option.key}
                  </span>
                  <span className="min-w-0 flex-1">
                    {option.text ? <span className="block text-[14px] leading-relaxed">{option.text}</span> : null}
                    {option.imageUrl ? (
                      <img src={option.imageUrl} alt={`Option ${option.key}`} loading="lazy" className="mt-1.5 max-h-40 rounded-lg object-contain" />
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly ? (
        <button
          type="button"
          onClick={() =>
            onChange({
              selectedOptions: [],
              numericAnswer: null,
              integerAnswer: null,
              status: draft.status === 'answered_marked' ? 'answered_marked' : draft.status === 'marked_for_review' ? 'marked_for_review' : 'not_answered',
            })
          }
          className="text-[12px] font-semibold text-slate-500 underline-offset-2 hover:text-rose-600 hover:underline dark:text-slate-400"
        >
          Clear response
        </button>
      ) : null}
    </div>
  );
}
