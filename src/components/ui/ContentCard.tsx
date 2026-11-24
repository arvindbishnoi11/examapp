import { Link } from 'react-router-dom';
import { BookOpen, Clock, FileText, PlayCircle, Users } from 'lucide-react';
import type { CourseCard, ExamCard, LectureCard, TestPaper } from '@shared/types';
import { formatDurationLabel, examWindowLabel } from '@/lib/format';

/** Shared thumbnail with a graceful skeleton + YouTube image fallback. */
export function Thumb({
  src,
  alt,
  className = '',
  aspect = 'video',
  fallbackIcon,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  aspect?: 'video' | 'square' | 'wide';
  fallbackIcon?: React.ReactNode;
}) {
  const aspectClass = aspect === 'square' ? 'aspect-square' : aspect === 'wide' ? 'aspect-[16/7]' : 'aspect-video';
  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br from-brand-100 via-brand-50 to-slate-100 dark:from-brand-950/60 dark:via-slate-900 dark:to-slate-800 ${aspectClass} ${className}`}>
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition duration-300"
          onError={(event) => {
            (event.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      {!src ? (
        <div className="absolute inset-0 grid place-items-center text-brand-400 dark:text-brand-600">
          {fallbackIcon ?? <BookOpen className="h-8 w-8" aria-hidden />}
        </div>
      ) : null}
    </div>
  );
}

export function LectureCardItem({ lecture, progressPercent }: { lecture: LectureCard; progressPercent?: number }) {
  return (
    <Link
      to={`/lectures/${lecture.id}`}
      className="group block overflow-hidden rounded-xl2 border border-slate-200/80 bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="relative">
        <Thumb src={lecture.thumbnailUrl} alt={lecture.title} fallbackIcon={<PlayCircle className="h-8 w-8" aria-hidden />} />
        <div className="absolute inset-0 grid place-items-center bg-slate-900/0 transition group-hover:bg-slate-900/20">
          <PlayCircle className="h-11 w-11 text-white/90 opacity-0 drop-shadow transition group-hover:opacity-100" aria-hidden />
        </div>
        {lecture.durationSeconds ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-slate-900/85 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {formatDurationLabel(lecture.durationSeconds)}
          </span>
        ) : null}
        {lecture.isFree ? (
          <span className="absolute left-2 top-2 rounded-md bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Free
          </span>
        ) : null}
        {progressPercent && progressPercent > 0 ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/40">
            <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, progressPercent)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="p-3">
        <p className="line-clamp-2-safe min-h-[2.5rem] text-[13.5px] font-semibold leading-snug text-slate-900 dark:text-slate-100">{lecture.title}</p>
        <p className="mt-1 truncate text-[11.5px] text-slate-500 dark:text-slate-400">
          {[lecture.subjectName, lecture.chapterName ?? lecture.seriesTitle].filter(Boolean).join(' · ') || lecture.courseName || 'Lecture'}
        </p>
      </div>
    </Link>
  );
}

export function CourseCardItem({ course }: { course: CourseCard }) {
  return (
    <Link
      to={`/courses/${course.id}`}
      className="group flex flex-col overflow-hidden rounded-xl2 border border-slate-200/80 bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900"
    >
      <Thumb src={course.coverImageUrl} alt={course.name} aspect="wide" />
      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {course.className ? <span className="badge-brand">{course.className}</span> : null}
          {course.examTypeName ? <span className="badge-neutral">{course.examTypeName}</span> : null}
          {course.isFree ? <span className="badge-success">Free</span> : null}
        </div>
        <p className="mt-2 line-clamp-2-safe text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">{course.name}</p>
        {course.shortDescription ? (
          <p className="mt-1 line-clamp-2-safe text-xs text-slate-500 dark:text-slate-400">{course.shortDescription}</p>
        ) : null}
        <div className="mt-auto flex items-center gap-3 pt-3 text-[11px] text-slate-500 dark:text-slate-400">
          {course.lectureCount ? (
            <span className="inline-flex items-center gap-1">
              <PlayCircle className="h-3.5 w-3.5" aria-hidden /> {course.lectureCount}
            </span>
          ) : null}
          {course.examCount ? (
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" aria-hidden /> {course.examCount}
            </span>
          ) : null}
          {course.subjectCount ? (
            <span className="inline-flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" aria-hidden /> {course.subjectCount}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

const KIND_LABEL: Record<string, string> = {
  practice: 'Practice',
  chapter: 'Chapter test',
  topic: 'Topic test',
  full_mock: 'Full mock',
  previous_year: 'Previous year',
  board: 'Board',
  custom: 'Custom',
};

export function ExamCardItem({ exam, to }: { exam: ExamCard; to?: string }) {
  const window = examWindowLabel(exam.startAt, exam.endAt);
  return (
    <Link
      to={to ?? `/tests/${exam.id}`}
      className="group flex items-start gap-3 rounded-xl2 border border-slate-200/80 bg-white p-3.5 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
        <FileText className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="badge-brand">{KIND_LABEL[exam.examKind] ?? 'Test'}</span>
          {window.tone === 'live' ? <span className="badge-success">Live</span> : null}
          {window.tone === 'closed' ? <span className="badge-neutral">Closed</span> : null}
        </div>
        <p className="mt-1 line-clamp-2-safe text-[13.5px] font-semibold leading-snug text-slate-900 dark:text-slate-100">{exam.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden /> {exam.durationMinutes} min
          </span>
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3 w-3" aria-hidden /> {exam.totalQuestions} Q
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden /> {exam.totalMarks} marks
          </span>
          {exam.attemptsUsed ? <span>· {exam.attemptsUsed} attempted</span> : null}
        </div>
      </div>
    </Link>
  );
}

export function TestPaperCardItem({ paper }: { paper: TestPaper }) {
  return (
    <Link
      to={`/papers/${paper.id}`}
      className="group flex items-start gap-3 rounded-xl2 border border-slate-200/80 bg-white p-3.5 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
        <FileText className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2-safe text-[13.5px] font-semibold leading-snug text-slate-900 dark:text-slate-100">{paper.title}</p>
        <p className="mt-1 truncate text-[11.5px] text-slate-500 dark:text-slate-400">
          {[paper.examTypeName, paper.subjectName, paper.year].filter(Boolean).join(' · ') || 'PDF paper'}
        </p>
      </div>
    </Link>
  );
}
