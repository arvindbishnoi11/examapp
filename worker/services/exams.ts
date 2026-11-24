// =============================================================================
// Examination engine
// =============================================================================
// Security invariants enforced here:
//   * Answer keys are NEVER included in the student-facing session payload.
//   * The attempt deadline (`expires_at_ms`) is computed and stored server-side
//     at start time; the browser clock is never trusted. Late submissions are
//     accepted inside a small grace window, anything later is auto-submitted
//     and evaluated with whatever was saved.
//   * Only one live attempt per (exam, student) — a partial unique index makes
//     concurrent starts race-safe; the loser is returned the winner's attempt.
//   * Evaluation happens on the server from `attempt_answers`, never from a
//     client-supplied score.
//   * Answer writes after submission are rejected by status checks, and every
//     write is idempotent (upsert keyed on attempt+question).
// =============================================================================

import type { Env } from '../env';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/http';
import { newId, nowIso, parseJsonArray, roundTo } from '../lib/util';

export const GRACE_SECONDS = 45;

export type ExamRow = {
  id: string;
  title: string;
  instructions: string | null;
  duration_minutes: number;
  total_marks: number;
  total_questions: number;
  marks_per_question: number;
  negative_marks: number;
  negative_marking_enabled: number;
  shuffle_questions: number;
  shuffle_options: number;
  allow_section_navigation: number;
  start_at: string | null;
  end_at: string | null;
  max_attempts: number;
  result_publish_mode: 'immediate' | 'after_window' | 'manual';
  passing_percentage: number;
  rank_enabled: number;
  status: string;
};

export type AttemptRow = {
  id: string;
  exam_id: string;
  user_id: string;
  attempt_number: number;
  status: string;
  started_at: string;
  started_at_ms: number;
  expires_at_ms: number;
  submitted_at: string | null;
  time_spent_seconds: number;
  total_questions: number;
  question_order: string | null;
  option_order: string | null;
  score: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isExamOpen(exam: ExamRow, now = Date.now()): { open: boolean; reason?: string } {
  if (exam.status !== 'published' && exam.status !== 'scheduled') {
    return { open: false, reason: 'This examination is not published.' };
  }
  if (exam.end_at) {
    const end = Date.parse(exam.end_at);
    if (Number.isFinite(end) && now > end) return { open: false, reason: 'This examination window has closed.' };
  }
  return { open: true };
}

function shuffleSeeded<T>(items: T[], seed: string): T[] {
  // Deterministic Fisher–Yates using a small xorshift seeded from the attempt id,
  // so a page refresh reproduces exactly the same order without storing it.
  let state = 0;
  for (let i = 0; i < seed.length; i++) state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  const rand = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function getExam(env: Env, examId: string): Promise<ExamRow> {
  const exam = await env.DB.prepare(
    `SELECT id, title, instructions, duration_minutes, total_marks, total_questions, marks_per_question,
            negative_marks, negative_marking_enabled, shuffle_questions, shuffle_options, allow_section_navigation,
            start_at, end_at, max_attempts, result_publish_mode, passing_percentage, rank_enabled, status
       FROM exams WHERE id = ?1`,
  )
    .bind(examId)
    .first<ExamRow>();
  if (!exam) throw notFound('Examination not found.');
  return exam;
}

// ---------------------------------------------------------------------------
// Start / resume an attempt
// ---------------------------------------------------------------------------

export type StartAttemptResult = {
  attempt: AttemptRow;
  resumed: boolean;
};

export async function startOrResumeAttempt(
  env: Env,
  exam: ExamRow,
  userId: string,
): Promise<StartAttemptResult> {
  const now = Date.now();
  const open = isExamOpen(exam, now);
  if (!open.open) throw conflict(open.reason ?? 'This examination is not available.');

  // 1. Resume an existing live attempt (refresh / second tab / network drop).
  const live = await env.DB.prepare(
    `SELECT id, exam_id, user_id, attempt_number, status, started_at, started_at_ms, expires_at_ms,
            submitted_at, time_spent_seconds, total_questions, question_order, option_order, score
       FROM exam_attempts WHERE exam_id = ?1 AND user_id = ?2 AND status = 'in_progress'`,
  )
    .bind(exam.id, userId)
    .first<AttemptRow>();

  if (live) {
    // Past deadline → auto-submit before returning a session.
    if (now > live.expires_at_ms + GRACE_SECONDS * 1000) {
      await submitAttempt(env, live.id, { channel: 'timer', userId });
      const fresh = await env.DB.prepare('SELECT status FROM exam_attempts WHERE id = ?1').bind(live.id).first<{ status: string }>();
      throw conflict(
        'Time expired for this attempt and it was submitted automatically.',
        { attemptId: live.id, status: fresh?.status ?? 'submitted' },
      );
    }
    return { attempt: live, resumed: true };
  }

  // 2. Enforce attempt counts.
  const used = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM exam_attempts
      WHERE exam_id = ?1 AND user_id = ?2 AND status != 'abandoned'`,
  )
    .bind(exam.id, userId)
    .first<{ n: number }>();
  const usedCount = Number(used?.n ?? 0);
  if (usedCount >= exam.max_attempts) {
    throw conflict('You have used all available attempts for this examination.', {
      maxAttempts: exam.max_attempts,
      attemptsUsed: usedCount,
    });
  }

  // 3. Freeze the question set for this attempt.
  const questions = await env.DB.prepare(
    `SELECT eq.id, eq.question_id, eq.section_id, eq.sort_order
       FROM exam_questions eq
      WHERE eq.exam_id = ?1
      ORDER BY eq.sort_order ASC`,
  )
    .bind(exam.id)
    .all<{ id: string; question_id: string; section_id: string | null; sort_order: number }>();

  if (!questions.results?.length) {
    throw conflict('This examination has no questions yet. Please contact your teacher.');
  }

  const attemptId = newId();
  const expiresAtMs = now + exam.duration_minutes * 60 * 1000;

  let ordered = questions.results.map((q) => q.id);
  if (exam.shuffle_questions) ordered = shuffleSeeded(ordered, attemptId);

  // Persist option orders only when shuffling, mapping question → option keys.
  let optionOrder: Record<string, string[]> | null = null;
  if (exam.shuffle_options) {
    const optionRows = await env.DB.prepare(
      `SELECT qo.question_id, qo.option_key
         FROM question_options qo
        WHERE qo.question_id IN (SELECT question_id FROM exam_questions WHERE exam_id = ?1)`,
    )
      .bind(exam.id)
      .all<{ question_id: string; option_key: string }>();
    optionOrder = {};
    const grouped = new Map<string, string[]>();
    for (const row of optionRows.results ?? []) {
      const list = grouped.get(row.question_id) ?? [];
      list.push(row.option_key);
      grouped.set(row.question_id, list);
    }
    for (const [questionId, keys] of grouped) {
      optionOrder[questionId] = shuffleSeeded(keys.sort(), `${attemptId}:${questionId}`);
    }
  }

  const attemptNumber = usedCount + 1;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO exam_attempts
          (id, exam_id, user_id, attempt_number, status, started_at, started_at_ms, expires_at_ms,
           total_questions, question_order, option_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'in_progress', ?5, ?6, ?7, ?8, ?9, ?10, ?5, ?5)`,
      ).bind(
        attemptId,
        exam.id,
        userId,
        attemptNumber,
        nowIso(),
        now,
        expiresAtMs,
        ordered.length,
        JSON.stringify(ordered),
        optionOrder ? JSON.stringify(optionOrder) : null,
      ),
      // Pre-create empty answer rows so a submit always sees the full set.
      env.DB.prepare(
        `INSERT INTO attempt_answers (id, attempt_id, exam_question_id, question_id, status, created_at, updated_at)
         SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
                ?1, eq.id, eq.question_id, 'not_answered', ?2, ?2
           FROM exam_questions eq WHERE eq.exam_id = ?3`,
      ).bind(attemptId, nowIso(), exam.id),
    ]);
  } catch (err) {
    // Race: another tab created the live attempt first (unique partial index).
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(message)) {
      const winner = await env.DB.prepare(
        `SELECT id, exam_id, user_id, attempt_number, status, started_at, started_at_ms, expires_at_ms,
                submitted_at, time_spent_seconds, total_questions, question_order, option_order, score
           FROM exam_attempts WHERE exam_id = ?1 AND user_id = ?2 AND status = 'in_progress'`,
      )
        .bind(exam.id, userId)
        .first<AttemptRow>();
      if (winner) return { attempt: winner, resumed: true };
    }
    throw err;
  }

  const attempt = await env.DB.prepare(
    `SELECT id, exam_id, user_id, attempt_number, status, started_at, started_at_ms, expires_at_ms,
            submitted_at, time_spent_seconds, total_questions, question_order, option_order, score
       FROM exam_attempts WHERE id = ?1`,
  )
    .bind(attemptId)
    .first<AttemptRow>();

  if (!attempt) throw new HttpError(500, 'attempt_create_failed', 'Could not start the examination.');
  return { attempt, resumed: false };
}

// ---------------------------------------------------------------------------
// Session payload for the student (NO answer keys)
// ---------------------------------------------------------------------------

export async function buildSession(env: Env, exam: ExamRow, attempt: AttemptRow) {
  const questionIds = parseJsonArray(attempt.question_order);
  if (!questionIds.length) throw new HttpError(500, 'attempt_corrupt', 'Attempt question list is missing.');

  const placeholders = questionIds.map((_, i) => `?${i + 2}`).join(',');
  const [questionRows, optionRows, answerRows, sectionRows] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      `SELECT eq.id AS examQuestionId, eq.question_id AS questionId, eq.section_id AS sectionId,
              eq.marks, eq.negative_marks AS negativeMarks, eq.sort_order AS sortOrder,
              q.question_type AS questionType, q.difficulty, q.question_text AS questionText,
              q.question_image_url AS questionImageUrl, q.passage_text AS passageText,
              q.passage_image_url AS passageImageUrl
         FROM exam_questions eq JOIN questions q ON q.id = eq.question_id
        WHERE eq.id IN (${placeholders})`,
    ).bind(attempt.id, ...questionIds),
    env.DB.prepare(
      `SELECT qo.question_id AS questionId, qo.option_key AS key, qo.option_text AS text,
              qo.option_image_url AS imageUrl, qo.sort_order AS sortOrder
         FROM question_options qo
        WHERE qo.question_id IN (SELECT question_id FROM exam_questions WHERE id IN (${placeholders}))
        ORDER BY qo.sort_order ASC`,
    ).bind(attempt.id, ...questionIds),
    env.DB.prepare(
      `SELECT exam_question_id AS examQuestionId, selected_options AS selectedOptions,
              numeric_answer AS numericAnswer, integer_answer AS integerAnswer, status,
              time_spent_seconds AS timeSpentSeconds
         FROM attempt_answers WHERE attempt_id = ?1`,
    ).bind(attempt.id),
    env.DB.prepare(
      `SELECT es.id, es.title, es.sort_order AS sortOrder, s.name AS subjectName
         FROM exam_sections es LEFT JOIN subjects s ON s.id = es.subject_id
        WHERE es.exam_id = ?1 ORDER BY es.sort_order ASC`,
    ).bind(exam.id),
  ]);

  const questionsById = new Map<string, Record<string, unknown>>();
  for (const row of questionRows.results ?? []) questionsById.set(String(row.examQuestionId), row);

  const optionsByQuestion = new Map<string, { key: string; text: string | null; imageUrl: string | null }[]>();
  for (const row of optionRows.results ?? []) {
    const list = optionsByQuestion.get(String(row.questionId)) ?? [];
    list.push({ key: String(row.key), text: (row.text as string) ?? null, imageUrl: (row.imageUrl as string) ?? null });
    optionsByQuestion.set(String(row.questionId), list);
  }

  const optionOrder: Record<string, string[]> = attempt.option_order ? JSON.parse(attempt.option_order) : {};
  const answersByExamQuestion = new Map<string, Record<string, unknown>>();
  for (const row of answerRows.results ?? []) answersByExamQuestion.set(String(row.examQuestionId), row);

  const sections = (sectionRows.results ?? []).map((s) => ({
    id: String(s.id),
    title: String(s.title),
    subjectName: (s.subjectName as string) ?? null,
    sortOrder: Number(s.sortOrder ?? 0),
  }));

  const questions = questionIds
    .map((examQuestionId) => {
      const q = questionsById.get(examQuestionId);
      if (!q) return null;
      const questionId = String(q.questionId);
      const rawOptions = optionsByQuestion.get(questionId) ?? [];
      const order = optionOrder[questionId];
      const options = order
        ? order
            .map((key) => rawOptions.find((o) => o.key === key))
            .filter((o): o is { key: string; text: string | null; imageUrl: string | null } => Boolean(o))
        : rawOptions;

      return {
        examQuestionId,
        questionId,
        sectionId: (q.sectionId as string) ?? null,
        sectionTitle: sections.find((s) => s.id === q.sectionId)?.title ?? null,
        questionType: q.questionType,
        difficulty: q.difficulty,
        questionText: q.questionText,
        questionImageUrl: (q.questionImageUrl as string) ?? null,
        passageText: (q.passageText as string) ?? null,
        passageImageUrl: (q.passageImageUrl as string) ?? null,
        marks: Number(q.marks ?? exam.marks_per_question),
        negativeMarks: Number(q.negativeMarks ?? exam.negative_marks),
        sortOrder: Number(q.sortOrder ?? 0),
        options,
      };
    })
    .filter(Boolean);

  const answers = (answerRows.results ?? []).map((row) => ({
    examQuestionId: String(row.examQuestionId),
    selectedOptions: parseJsonArray(row.selectedOptions),
    numericAnswer: row.numericAnswer === null ? null : Number(row.numericAnswer),
    integerAnswer: row.integerAnswer === null ? null : Number(row.integerAnswer),
    status: String(row.status),
    timeSpentSeconds: Number(row.timeSpentSeconds ?? 0),
  }));

  return {
    attemptId: attempt.id,
    exam: {
      id: exam.id,
      title: exam.title,
      instructions: exam.instructions,
      durationMinutes: exam.duration_minutes,
      totalMarks: exam.total_marks,
      totalQuestions: questions.length,
      negativeMarkingEnabled: Boolean(exam.negative_marking_enabled),
      allowSectionNavigation: Boolean(exam.allow_section_navigation),
      resultPublishMode: exam.result_publish_mode,
    },
    attemptNumber: attempt.attempt_number,
    startedAt: attempt.started_at,
    expiresAtMs: attempt.expires_at_ms,
    serverNowMs: Date.now(),
    questions,
    answers,
    sections,
  };
}

// ---------------------------------------------------------------------------
// Save answers (idempotent, deadline-checked)
// ---------------------------------------------------------------------------

export type AnswerInput = {
  examQuestionId: string;
  selectedOptions?: string[];
  numericAnswer?: number | null;
  integerAnswer?: number | null;
  status?: 'not_answered' | 'answered' | 'marked_for_review' | 'answered_marked';
  timeSpentSeconds?: number;
};

export async function saveAnswers(
  env: Env,
  attempt: AttemptRow,
  exam: ExamRow,
  inputs: AnswerInput[],
): Promise<{ saved: number; expiresAtMs: number; serverNowMs: number }> {
  if (attempt.status !== 'in_progress') throw conflict('This attempt has already been submitted.');
  const now = Date.now();
  if (now > attempt.expires_at_ms + GRACE_SECONDS * 1000) {
    throw new HttpError(409, 'attempt_expired', 'Time is up. Your attempt is being submitted.', {
      expiresAtMs: attempt.expires_at_ms,
      attemptId: attempt.id,
    });
  }

  const allowed = new Set(parseJsonArray(attempt.question_order));

  const valid = inputs.filter((i) => allowed.has(i.examQuestionId));
  if (!valid.length) throw badRequest('No valid answers were supplied.');

  const statements = valid.map((input) => {
    const status = input.status ?? 'answered';
    const selected = Array.isArray(input.selectedOptions)
      ? JSON.stringify(input.selectedOptions.filter((v) => typeof v === 'string').slice(0, 10))
      : null;

    const numeric =
      typeof input.numericAnswer === 'number' && Number.isFinite(input.numericAnswer) ? input.numericAnswer : null;
    const integer =
      typeof input.integerAnswer === 'number' && Number.isInteger(input.integerAnswer) ? input.integerAnswer : null;

    return env.DB.prepare(
      `INSERT INTO attempt_answers
         (id, attempt_id, exam_question_id, question_id, selected_options, numeric_answer, integer_answer, status, time_spent_seconds, created_at, updated_at)
       SELECT ?1, ?2, eq.id, eq.question_id, ?3, ?4, ?5, ?6, ?7, ?8, ?8
         FROM exam_questions eq WHERE eq.id = ?9 AND eq.exam_id = ?10
       ON CONFLICT(attempt_id, question_id) DO UPDATE SET
         selected_options = COALESCE(excluded.selected_options, attempt_answers.selected_options),
         numeric_answer = COALESCE(excluded.numeric_answer, attempt_answers.numeric_answer),
         integer_answer = COALESCE(excluded.integer_answer, attempt_answers.integer_answer),
         status = excluded.status,
         time_spent_seconds = attempt_answers.time_spent_seconds + excluded.time_spent_seconds,
         updated_at = excluded.updated_at`,
    ).bind(
      newId(),
      attempt.id,
      selected,
      numeric,
      integer,
      status,
      Math.max(0, Math.min(3600, Math.round(input.timeSpentSeconds ?? 0))),
      nowIso(),
      input.examQuestionId,
      exam.id,
    );
  });

  await env.DB.batch(statements);

  // Update the aggregate counters + heartbeat time.
  await env.DB.prepare(
    `UPDATE exam_attempts
        SET answered_count = (SELECT COUNT(*) FROM attempt_answers WHERE attempt_id = ?1 AND status IN ('answered','answered_marked')),
            time_spent_seconds = ?2
      WHERE id = ?1`,
  )
    .bind(attempt.id, Math.max(0, Math.round((now - attempt.started_at_ms) / 1000)))
    .run();

  return { saved: statements.length, expiresAtMs: attempt.expires_at_ms, serverNowMs: now };
}

// ---------------------------------------------------------------------------
// Submit + evaluate
// ---------------------------------------------------------------------------

type EvaluationOutcome = {
  isCorrect: 0 | 1 | null;
  marksAwarded: number;
  evaluation: 'correct' | 'wrong' | 'partial' | 'unattempted';
};

function evaluateAnswer(
  answer: { selectedOptions: string[]; numericAnswer: number | null; integerAnswer: number | null },
  key: { answer_type: string; correct_options: string[]; numeric_answer: number | null; numeric_tolerance: number; integer_answer: number | null },
  marks: number,
  negativeMarks: number,
): EvaluationOutcome {
  const attempted =
    answer.selectedOptions.length > 0 || answer.numericAnswer !== null || answer.integerAnswer !== null;
  if (!attempted) return { isCorrect: null, marksAwarded: 0, evaluation: 'unattempted' };

  if (key.answer_type === 'numeric') {
    if (answer.numericAnswer === null || key.numeric_answer === null) {
      return { isCorrect: 0, marksAwarded: -Math.abs(negativeMarks), evaluation: 'wrong' };
    }
    const diff = Math.abs(answer.numericAnswer - key.numeric_answer);
    const tolerance = Math.max(0, key.numeric_tolerance ?? 0);
    return diff <= tolerance
      ? { isCorrect: 1, marksAwarded: marks, evaluation: 'correct' }
      : { isCorrect: 0, marksAwarded: -Math.abs(negativeMarks), evaluation: 'wrong' };
  }

  if (key.answer_type === 'integer') {
    if (answer.integerAnswer === null || key.integer_answer === null) {
      return { isCorrect: 0, marksAwarded: -Math.abs(negativeMarks), evaluation: 'wrong' };
    }
    return answer.integerAnswer === key.integer_answer
      ? { isCorrect: 1, marksAwarded: marks, evaluation: 'correct' }
      : { isCorrect: 0, marksAwarded: -Math.abs(negativeMarks), evaluation: 'wrong' };
  }

  const correct = new Set(key.correct_options);
  const selected = new Set(answer.selectedOptions);
  if (correct.size === 0) {
    return { isCorrect: 0, marksAwarded: 0, evaluation: 'unattempted' };
  }

  if (key.answer_type === 'multiple') {
    // JEE-style: full marks only for an exact match; partial credit when a
    // subset of the correct options is chosen (configurable via marks/negative).
    const allSelectedCorrect = [...selected].every((k) => correct.has(k));
    if (selected.size === correct.size && allSelectedCorrect) {
      return { isCorrect: 1, marksAwarded: marks, evaluation: 'correct' };
    }
    if (allSelectedCorrect && selected.size > 0) {
      return { isCorrect: 0, marksAwarded: roundTo((marks * selected.size) / correct.size, 2), evaluation: 'partial' };
    }
    return { isCorrect: 0, marksAwarded: -Math.abs(negativeMarks), evaluation: 'wrong' };
  }

  // single correct
  const [only] = [...selected];
  if (selected.size === 1 && correct.has(only)) {
    return { isCorrect: 1, marksAwarded: marks, evaluation: 'correct' };
  }
  return { isCorrect: 0, marksAwarded: -Math.abs(negativeMarks), evaluation: 'wrong' };
}

export async function submitAttempt(
  env: Env,
  attemptId: string,
  options: { channel: 'manual' | 'timer' | 'admin' | 'cron'; userId?: string; reason?: string } = { channel: 'manual' },
): Promise<{ attemptId: string; status: string; resultId: string | null; alreadySubmitted: boolean }> {
  const attempt = await env.DB.prepare(
    `SELECT id, exam_id, user_id, attempt_number, status, started_at, started_at_ms, expires_at_ms,
            submitted_at, time_spent_seconds, total_questions, question_order, option_order, score
       FROM exam_attempts WHERE id = ?1`,
  )
    .bind(attemptId)
    .first<AttemptRow>();
  if (!attempt) throw notFound('Attempt not found.');
  if (options.userId && attempt.user_id !== options.userId) throw forbidden('This attempt belongs to another student.');

  if (attempt.status !== 'in_progress') {
    const existing = await env.DB.prepare('SELECT id FROM results WHERE attempt_id = ?1').bind(attemptId).first<{ id: string }>();
    return { attemptId, status: attempt.status, resultId: existing?.id ?? null, alreadySubmitted: true };
  }

  const exam = await getExam(env, attempt.exam_id);
  const now = Date.now();

  // Server-authoritative closing: a manual submit after the grace window is
  // recorded as timer-expired, and the elapsed time is capped at the duration.
  const elapsedSeconds = Math.max(0, Math.round((now - attempt.started_at_ms) / 1000));
  const hardDeadline = attempt.expires_at_ms + GRACE_SECONDS * 1000;
  const isLate = now > hardDeadline;
  const durationCap = exam.duration_minutes * 60;
  const timeSpent = Math.min(elapsedSeconds, durationCap + GRACE_SECONDS);
  const finalStatus = isLate || options.channel === 'timer' || options.channel === 'cron'
    ? 'auto_submitted'
    : 'submitted';

  // Load answers and keys in one shot.
  const [answerRows, keyRows, questionRows] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      `SELECT aa.exam_question_id AS examQuestionId, aa.question_id AS questionId,
              aa.selected_options AS selectedOptions, aa.numeric_answer AS numericAnswer,
              aa.integer_answer AS integerAnswer, aa.status, aa.time_spent_seconds AS timeSpentSeconds
         FROM attempt_answers aa WHERE aa.attempt_id = ?1`,
    ).bind(attemptId),
    env.DB.prepare(
      `SELECT ak.question_id AS questionId, ak.answer_type AS answerType, ak.correct_options AS correctOptions,
              ak.numeric_answer AS numericAnswer, ak.numeric_tolerance AS numericTolerance, ak.integer_answer AS integerAnswer
         FROM answer_keys ak
        WHERE ak.question_id IN (SELECT question_id FROM exam_questions WHERE exam_id = ?1)`,
    ).bind(exam.id),
    env.DB.prepare(
      `SELECT eq.id AS examQuestionId, eq.question_id AS questionId, eq.marks, eq.negative_marks AS negativeMarks,
              q.subject_id AS subjectId, q.chapter_id AS chapterId,
              COALESCE(s.name, 'General') AS subjectName, COALESCE(ch.name, 'Unassigned') AS chapterName
         FROM exam_questions eq
         JOIN questions q ON q.id = eq.question_id
         LEFT JOIN subjects s ON s.id = q.subject_id
         LEFT JOIN chapters ch ON ch.id = q.chapter_id
        WHERE eq.exam_id = ?1`,
    ).bind(exam.id),
  ]);

  const keyByQuestion = new Map<string, Record<string, unknown>>();
  for (const row of keyRows.results ?? []) keyByQuestion.set(String(row.questionId), row);

  const questionMeta = new Map<string, Record<string, unknown>>();
  for (const row of questionRows.results ?? []) questionMeta.set(String(row.examQuestionId), row);

  const answersByExamQuestion = new Map<string, Record<string, unknown>>();
  for (const row of answerRows.results ?? []) answersByExamQuestion.set(String(row.examQuestionId), row);

  const orderedIds = parseJsonArray(attempt.question_order);
  const perSubject = new Map<string, { total: number; correct: number; wrong: number; unattempted: number; score: number; maxScore: number }>();
  const perChapter = new Map<string, { total: number; correct: number; wrong: number; unattempted: number; score: number; maxScore: number; subject: string }>();

  let score = 0;
  let maxScore = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;

  const updates: D1PreparedStatement[] = [];

  for (const examQuestionId of orderedIds) {
    const meta = questionMeta.get(examQuestionId);
    if (!meta) continue;
    const questionId = String(meta.questionId);
    const answer = answersByExamQuestion.get(examQuestionId);
    const key = keyByQuestion.get(questionId);

    const marks = Number(meta.marks ?? exam.marks_per_question);
    const negativeMarks = exam.negative_marking_enabled ? Number(meta.negativeMarks ?? exam.negative_marks) : 0;
    maxScore += marks;

    const selected = parseJsonArray(answer?.selectedOptions);
    const numericAnswer = answer?.numericAnswer === null || answer?.numericAnswer === undefined ? null : Number(answer.numericAnswer);
    const integerAnswer = answer?.integerAnswer === null || answer?.integerAnswer === undefined ? null : Number(answer.integerAnswer);

    const outcome = key
      ? evaluateAnswer(
          { selectedOptions: selected, numericAnswer, integerAnswer },
          {
            answer_type: String(key.answerType ?? 'single'),
            correct_options: parseJsonArray(key.correctOptions),
            numeric_answer: key.numericAnswer === null || key.numericAnswer === undefined ? null : Number(key.numericAnswer),
            numeric_tolerance: Number(key.numericTolerance ?? 0),
            integer_answer: key.integerAnswer === null || key.integerAnswer === undefined ? null : Number(key.integerAnswer),
          },
          marks,
          negativeMarks,
        )
      : { isCorrect: null, marksAwarded: 0, evaluation: 'unattempted' as const };

    score += outcome.marksAwarded;
    if (outcome.evaluation === 'correct') correctCount++;
    else if (outcome.evaluation === 'wrong') wrongCount++;
    else if (outcome.evaluation === 'unattempted') unattemptedCount++;
    else correctCount += 0; // partial counted separately in accuracy below

    updates.push(
      env.DB.prepare(
        `UPDATE attempt_answers SET is_correct = ?2, marks_awarded = ?3, evaluation = ?4
          WHERE attempt_id = ?1 AND exam_question_id = ?5`,
      ).bind(attemptId, outcome.isCorrect, outcome.marksAwarded, outcome.evaluation, examQuestionId),
    );

    const subjectKey = String(meta.subjectName ?? 'General');
    const subjectAgg = perSubject.get(subjectKey) ?? { total: 0, correct: 0, wrong: 0, unattempted: 0, score: 0, maxScore: 0 };
    subjectAgg.total++;
    subjectAgg.maxScore += marks;
    subjectAgg.score += outcome.marksAwarded;
    if (outcome.evaluation === 'correct') subjectAgg.correct++;
    else if (outcome.evaluation === 'wrong') subjectAgg.wrong++;
    else if (outcome.evaluation === 'unattempted') subjectAgg.unattempted++;
    perSubject.set(subjectKey, subjectAgg);

    const chapterKey = `${String(meta.chapterName ?? 'Unassigned')}`;
    const chapterAgg = perChapter.get(chapterKey) ?? {
      total: 0, correct: 0, wrong: 0, unattempted: 0, score: 0, maxScore: 0, subject: subjectKey,
    };
    chapterAgg.total++;
    chapterAgg.maxScore += marks;
    chapterAgg.score += outcome.marksAwarded;
    if (outcome.evaluation === 'correct') chapterAgg.correct++;
    else if (outcome.evaluation === 'wrong') chapterAgg.wrong++;
    else if (outcome.evaluation === 'unattempted') chapterAgg.unattempted++;
    perChapter.set(chapterKey, chapterAgg);
  }

  // Chunked updates keep each batch well within D1 limits.
  for (let i = 0; i < updates.length; i += 60) {
    await env.DB.batch(updates.slice(i, i + 60));
  }

  const attemptedCount = orderedIds.length - unattemptedCount;
  const accuracy = attemptedCount > 0 ? roundTo((correctCount / attemptedCount) * 100, 2) : 0;
  const percentage = maxScore > 0 ? roundTo((score / maxScore) * 100, 2) : 0;
  const passed = percentage >= exam.passing_percentage ? 1 : 0;

  const subjectBreakdown = [...perSubject.entries()].map(([subject, v]) => ({
    subject,
    total: v.total,
    correct: v.correct,
    wrong: v.wrong,
    unattempted: v.unattempted,
    score: roundTo(v.score, 2),
    maxScore: roundTo(v.maxScore, 2),
    accuracy: v.total - v.unattempted > 0 ? roundTo((v.correct / (v.total - v.unattempted)) * 100, 2) : 0,
  }));

  const chapterBreakdown = [...perChapter.entries()].map(([chapter, v]) => ({
    chapter,
    subject: v.subject,
    total: v.total,
    correct: v.correct,
    wrong: v.wrong,
    unattempted: v.unattempted,
    score: roundTo(v.score, 2),
    maxScore: roundTo(v.maxScore, 2),
    accuracy: v.total - v.unattempted > 0 ? roundTo((v.correct / (v.total - v.unattempted)) * 100, 2) : 0,
  }));

  const publishNow = exam.result_publish_mode === 'immediate';

  // Atomic-ish submit: update the attempt, then upsert the result.
  await env.DB.prepare(
    `UPDATE exam_attempts SET
        status = ?2, submitted_at = ?3, submitted_at_ms = ?4, duration_seconds = ?5, time_spent_seconds = ?5,
        answered_count = ?6, score = ?7, correct_count = ?8, wrong_count = ?9, unattempted_count = ?10,
        accuracy = ?11, percentage = ?12, submit_channel = ?13
      WHERE id = ?1 AND status = 'in_progress'`,
  )
    .bind(
      attemptId,
      finalStatus,
      nowIso(),
      now,
      timeSpent,
      attemptedCount,
      roundTo(score, 2),
      correctCount,
      wrongCount,
      unattemptedCount,
      accuracy,
      percentage,
      options.channel,
    )
    .run();

  const resultId = newId();
  await env.DB.prepare(
    `INSERT INTO results
      (id, attempt_id, exam_id, user_id, score, max_score, percentage, accuracy, correct_count, wrong_count,
       unattempted_count, time_spent_seconds, subject_breakdown, chapter_breakdown, passed, is_published, published_at, computed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
     ON CONFLICT(attempt_id) DO NOTHING`,
  )
    .bind(
      resultId,
      attemptId,
      exam.id,
      attempt.user_id,
      roundTo(score, 2),
      roundTo(maxScore, 2),
      percentage,
      accuracy,
      correctCount,
      wrongCount,
      unattemptedCount,
      timeSpent,
      JSON.stringify(subjectBreakdown),
      JSON.stringify(chapterBreakdown),
      passed,
      publishNow ? 1 : 0,
      publishNow ? nowIso() : null,
      nowIso(),
    )
    .run();

  const created = await env.DB.prepare('SELECT id FROM results WHERE attempt_id = ?1').bind(attemptId).first<{ id: string }>();

  // Ranking is computed lazily when results are read (see getResult) so the
  // submit path stays fast under concurrent load.

  return {
    attemptId,
    status: finalStatus,
    resultId: created?.id ?? null,
    alreadySubmitted: false,
  };
}

// ---------------------------------------------------------------------------
// Result access
// ---------------------------------------------------------------------------

export function resultVisibleToStudent(exam: Pick<ExamRow, 'result_publish_mode' | 'end_at'>, result: { is_published: number }, attemptStatus: string): boolean {
  if (result.is_published) return true;
  if (exam.result_publish_mode === 'immediate') return true;
  if (attemptStatus !== 'submitted' && attemptStatus !== 'auto_submitted' && attemptStatus !== 'evaluated') return false;
  if (exam.result_publish_mode === 'after_window') {
    if (!exam.end_at) return false;
    return Date.now() > Date.parse(exam.end_at);
  }
  return false;
}

export async function getResultForUser(env: Env, resultId: string, userId: string, isStaff: boolean) {
  const row = await env.DB.prepare(
    `SELECT r.id, r.attempt_id AS attemptId, r.exam_id AS examId, r.user_id AS userId, r.score, r.max_score AS maxScore,
            r.percentage, r.accuracy, r.correct_count AS correctCount, r.wrong_count AS wrongCount,
            r.unattempted_count AS unattemptedCount, r.time_spent_seconds AS timeSpentSeconds,
            r.subject_breakdown AS subjectBreakdown, r.chapter_breakdown AS chapterBreakdown,
            r.rank, r.percentile, r.passed, r.is_published AS isPublished, r.computed_at AS computedAt,
            e.title AS examTitle, e.result_publish_mode AS publishMode, e.end_at AS endAt,
            e.rank_enabled AS rankEnabled, e.passing_percentage AS passingPercentage,
            a.status AS attemptStatus
       FROM results r
       JOIN exams e ON e.id = r.exam_id
       JOIN exam_attempts a ON a.id = r.attempt_id
      WHERE r.id = ?1`,
  )
    .bind(resultId)
    .first<Record<string, unknown>>();

  if (!row) throw notFound('Result not found.');
  if (!isStaff && row.userId !== userId) throw forbidden('You can only view your own results.');
  return row;
}

/**
 * Rank + percentile, computed on demand from evaluated results for the exam.
 * Only exposed when the exam enables ranking and at least 5 results exist, so a
 * "rank" can never identify another student in a tiny cohort.
 */
export async function computeRanking(env: Env, examId: string, resultId: string) {
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN score > (SELECT score FROM results WHERE id = ?2) THEN 1 ELSE 0 END) AS better,
            AVG(score) AS avgScore
       FROM results WHERE exam_id = ?1 AND is_published = 1`,
  )
    .bind(examId, resultId)
    .first<{ total: number; better: number | null; avgScore: number | null }>();

  const total = Number(stats?.total ?? 0);
  if (total < 5) return { rank: null as number | null, percentile: null as number | null, cohort: total };
  const rank = Number(stats?.better ?? 0) + 1;
  const percentile = roundTo(((total - rank + 0.5) / total) * 100, 2);
  return { rank, percentile, cohort: total };
}
