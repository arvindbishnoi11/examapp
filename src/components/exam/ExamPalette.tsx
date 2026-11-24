import { Check, Circle, Flag, Minus } from 'lucide-react';
import type { SavedAnswer } from '@shared/types';

export type PaletteStatus = 'answered' | 'not_answered' | 'marked' | 'answered_marked' | 'not_visited';

const STYLES: Record<PaletteStatus, { className: string; label: string; icon: typeof Check }> = {
  answered: {
    className: 'bg-emerald-500 text-white border-emerald-500',
    label: 'Answered',
    icon: Check,
  },
  not_answered: {
    className: 'bg-rose-500 text-white border-rose-500',
    label: 'Not answered',
    icon: Minus,
  },
  marked: {
    className: 'bg-violet-500 text-white border-violet-500',
    label: 'Marked for review',
    icon: Flag,
  },
  answered_marked: {
    className: 'bg-violet-500 text-white border-violet-500 ring-2 ring-emerald-400',
    label: 'Answered & marked',
    icon: Flag,
  },
  not_visited: {
    className: 'bg-white text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
    label: 'Not visited',
    icon: Circle,
  },
};

export function statusFor(answer: SavedAnswer | undefined, visited: boolean): PaletteStatus {
  if (!answer) return visited ? 'not_answered' : 'not_visited';
  if (answer.status === 'answered_marked') return 'answered_marked';
  if (answer.status === 'marked_for_review') return 'marked';
  const hasValue =
    answer.selectedOptions.length > 0 || answer.numericAnswer !== null || answer.integerAnswer !== null;
  if (hasValue || answer.status === 'answered') return 'answered';
  return 'not_answered';
}

export function ExamPalette({
  questions,
  answers,
  visited,
  currentIndex,
  onJump,
  sections,
}: {
  questions: { examQuestionId: string; questionNumber: number; sectionId: string | null }[];
  answers: Record<string, SavedAnswer>;
  visited: Set<string>;
  currentIndex: number;
  onJump: (index: number) => void;
  sections: { id: string; title: string }[];
}) {
  const counts = {
    answered: 0,
    not_answered: 0,
    marked: 0,
    answered_marked: 0,
    not_visited: 0,
  } as Record<PaletteStatus, number>;
  for (const question of questions) {
    counts[statusFor(answers[question.examQuestionId], visited.has(question.examQuestionId))] += 1;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        {(Object.keys(STYLES) as PaletteStatus[]).map((status) => {
          const Icon = STYLES[status].icon;
          return (
            <div key={status} className="flex items-center gap-1.5">
              <span className={`grid h-5 w-5 place-items-center rounded ${STYLES[status].className}`}>
                <Icon className="h-3 w-3" aria-hidden />
              </span>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                {STYLES[status].label} <strong>{counts[status]}</strong>
              </span>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
        {sections.length > 1 ? (
          sections.map((section) => {
            const items = questions.filter((q) => q.sectionId === section.id);
            if (!items.length) return null;
            return (
              <div key={section.id} className="mb-3 last:mb-0">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{section.title}</p>
                <div className="flex flex-wrap gap-1.5">{items.map((q) => renderCell(q))}</div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-wrap gap-1.5">{questions.map((q) => renderCell(q))}</div>
        )}
      </div>
    </div>
  );

  function renderCell(q: { examQuestionId: string; questionNumber: number }) {
    const index = questions.findIndex((item) => item.examQuestionId === q.examQuestionId);
    const status = statusFor(answers[q.examQuestionId], visited.has(q.examQuestionId));
    return (
      <button
        key={q.examQuestionId}
        type="button"
        onClick={() => onJump(index)}
        aria-current={index === currentIndex ? 'true' : undefined}
        aria-label={`Question ${q.questionNumber}, ${STYLES[status].label}`}
        className={`grid h-8 w-8 place-items-center rounded-md border text-[12px] font-bold tabular-nums transition hover:scale-105 ${STYLES[status].className} ${
          index === currentIndex ? 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900' : ''
        }`}
      >
        {q.questionNumber}
      </button>
    );
  }
}
