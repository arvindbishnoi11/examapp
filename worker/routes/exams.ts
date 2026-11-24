// =============================================================================
// Student-facing examination routes
// =============================================================================
//  GET  /api/exams                 list published exams
//  GET  /api/exams/:id             exam overview (NO questions, NO keys)
//  POST /api/exams/:id/start       start or resume an attempt
//  GET  /api/exams/attempts/:id    resume session (questions w/o keys)
//  POST /api/exams/:id/answers     autosave answers
//  POST /api/exams/:id/submit      submit + evaluate on the server
//  GET  /api/results/:id           result (review only when released)
//  GET  /api/exams/attempts        student attempt history
//  GET  /api/exams/attempts/:id    (see above, kept distinct from /:id)
//  POST /api/exams/attempts/:id/heartbeat   deadline sync for flaky networks
// =============================================================================

import type { Router } from '../lib/router';
import {
  badRequest,
  conflict,
  forbidden,
  json,
  notFound,
  parsePage,
  paginated,
  readJson,
  Validator,
} from '../lib/http';
import { requireAuth } from '../services/session';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import {
  buildSession,
  computeRanking,
  getExam,
  getResultForUser,
  resultVisibleToStudent,
  saveAnswers,
  startOrResumeAttempt,
  submitAttempt,
  type AnswerInput,
  type AttemptRow,
} from '../services/exams';
import { likePattern, nowIso, parseJsonArray } from '../lib/util';
import { writeAudit } from '../lib/audit';

function publicExam(row: Record<string, unknown>) {
  const toBool = (v: unknown) => Boolean(Number(v ?? 0));
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    examKind: row.examKind,
    courseId: row.courseId,
    courseName: row.courseName ?? null,
    examTypeName: row.examTypeName ?? null,
    subjectName: row.subjectName ?? null,
    durationMinutes: Number(row.durationMinutes ?? 0),
    totalMarks: Number(row.totalMarks ?? 0),
    totalQuestions: Number(row.totalQuestions ?? 0),
    negativeMarks: Number(row.negativeMarks ?? 0),
    negativeMarkingEnabled: toBool(row.negativeMarkingEnabled),
    startAt: row.startAt ?? null,
    endAt: row.endAt ?? null,
    maxAttempts: Number(row.maxAttempts ?? 1),
    isFree: toBool(row.isFree),
    status: row.status,
    attemptsUsed: row.attemptsUsed === undefined || row.attemptsUsed === null ? undefined : Number(row.attemptsUsed),
    bestScore: row.bestScore === undefined || row.bestScore === null ? null : Number(row.bestScore),
  };
}

async function loadOwnedAttempt(ctx: Parameters<Parameters<Router['post']>[1]>[0], attemptId: string, userId: string): Promise<AttemptRow> {
  const attempt = await ctx.env.DB.prepare(
    `SELECT id, exam_id, user_id, attempt_number, status, started_at, started_at_ms, expires_at_ms,
            submitted_at, time_spent_seconds, total_questions, question_order, option_order, score
       FROM exam_attempts WHERE id = ?1`,
  )
    .bind(attemptId)
    .first<AttemptRow>();
  if (!attempt) throw notFound('Attempt not found.');
  if (attempt.user_id !== userId) throw forbidden('This attempt belongs to another student.');
  return attempt;
}

export function registerExamRoutes(router: Router): void {
  // ---- Catalogue -----------------------------------------------------------
  router.get('/api/exams', async (ctx) => {
    const page = parsePage(ctx.url, { pageSize: 20 });
    const kind = ctx.url.searchParams.get('kind');
    const courseId = ctx.url.searchParams.get('courseId');
    const examTypeId = ctx.url.searchParams.get('examTypeId');
    const subjectId = ctx.url.searchParams.get('subjectId');
    const q = (ctx.url.searchParams.get('q') ?? '').trim();

    const where: string[] = ["e.status IN ('published','scheduled')"];
    const binds: unknown[] = [];
    if (kind) {
      binds.push(kind);
      where.push(`e.exam_kind = ?${binds.length}`);
    }
    if (courseId) {
      binds.push(courseId);
      where.push(`e.course_id = ?${binds.length}`);
    }
    if (examTypeId) {
      binds.push(examTypeId);
      where.push(`e.exam_type_id = ?${binds.length}`);
    }
    if (subjectId) {
      binds.push(subjectId);
      where.push(`e.subject_id = ?${binds.length}`);
    }
    if (q) {
      binds.push(likePattern(q));
      where.push(`e.title LIKE ?${binds.length} ESCAPE '\\'`);
    }

    const whereSql = where.join(' AND ');
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM exams e WHERE ${whereSql}`).bind(...binds).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT e.id, e.title, e.description, e.exam_kind AS examKind, e.course_id AS courseId,
                e.duration_minutes AS durationMinutes, e.total_marks AS totalMarks, e.total_questions AS totalQuestions,
                e.negative_marks AS negativeMarks, e.negative_marking_enabled AS negativeMarkingEnabled,
                e.start_at AS startAt, e.end_at AS endAt, e.max_attempts AS maxAttempts, e.is_free AS isFree, e.status,
                c.name AS courseName, et.name AS examTypeName, s.name AS subjectName
           FROM exams e
           LEFT JOIN courses c ON c.id = e.course_id
           LEFT JOIN exam_types et ON et.id = e.exam_type_id
           LEFT JOIN subjects s ON s.id = e.subject_id
          WHERE ${whereSql}
          ORDER BY COALESCE(e.start_at, e.created_at) DESC
          LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    return json(paginated((rows.results ?? []).map(publicExam), Number(count?.n ?? 0), page));
  });

  // ---- Attempt history (before /:id to avoid shadowing) --------------------
  router.get('/api/exams/attempts', async (ctx) => {
    const auth = await requireAuth(ctx);
    const page = parsePage(ctx.url, { pageSize: 20 });
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM exam_attempts WHERE user_id = ?1').bind(auth.user.id).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT a.id AS attemptId, a.exam_id AS examId, e.title AS examTitle, a.status, a.started_at AS startedAt,
                a.submitted_at AS submittedAt, a.score, a.percentage,
                (SELECT max_score FROM results r WHERE r.attempt_id = a.id) AS maxScore,
                (SELECT id FROM results r WHERE r.attempt_id = a.id) AS resultId,
                COALESCE((SELECT is_published FROM results r WHERE r.attempt_id = a.id), 0) AS resultPublished
           FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
          WHERE a.user_id = ?1
          ORDER BY a.created_at DESC LIMIT ?2 OFFSET ?3`,
      )
        .bind(auth.user.id, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    return json(
      paginated(
        (rows.results ?? []).map((r) => ({
          ...r,
          score: r.score === null ? null : Number(r.score),
          percentage: r.percentage === null ? null : Number(r.percentage),
          maxScore: r.maxScore === null ? null : Number(r.maxScore),
          resultPublished: Boolean(Number(r.resultPublished ?? 0)),
        })),
        Number(count?.n ?? 0),
        page,
      ),
    );
  });

  // ---- Resume an attempt ---------------------------------------------------
  router.get('/api/exams/attempts/:attemptId', async (ctx) => {
    const auth = await requireAuth(ctx);
    const attempt = await loadOwnedAttempt(ctx, ctx.params.attemptId, auth.user.id);

    if (attempt.status !== 'in_progress') {
      const result = await ctx.env.DB.prepare('SELECT id FROM results WHERE attempt_id = ?1')
        .bind(attempt.id)
        .first<{ id: string }>();
      return json({
        submitted: true,
        attemptId: attempt.id,
        status: attempt.status,
        resultId: result?.id ?? null,
      });
    }

    const exam = await getExam(ctx.env, attempt.exam_id);
    if (Date.now() > attempt.expires_at_ms + 45_000) {
      const outcome = await submitAttempt(ctx.env, attempt.id, { channel: 'timer', userId: auth.user.id });
      return json({ submitted: true, attemptId: attempt.id, status: outcome.status, resultId: outcome.resultId });
    }

    const session = await buildSession(ctx.env, exam, attempt);
    return json(session);
  });

  // ---- Heartbeat: authoritative clock sync --------------------------------
  router.post('/api/exams/attempts/:attemptId/heartbeat', async (ctx) => {
    const auth = await requireAuth(ctx);
    const attempt = await loadOwnedAttempt(ctx, ctx.params.attemptId, auth.user.id);
    const now = Date.now();
    return json({
      attemptId: attempt.id,
      status: attempt.status,
      serverNowMs: now,
      expiresAtMs: attempt.expires_at_ms,
      remainingMs: Math.max(0, attempt.expires_at_ms - now),
      shouldSubmit: attempt.status === 'in_progress' && now > attempt.expires_at_ms,
    });
  });

  // ---- Autosave answers ----------------------------------------------------
  router.post('/api/exams/attempts/:attemptId/answers', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.examAnswer, clientIdentity(ctx.request, auth.user.id));
    const attempt = await loadOwnedAttempt(ctx, ctx.params.attemptId, auth.user.id);
    const exam = await getExam(ctx.env, attempt.exam_id);

    const body = await readJson<{ answers?: unknown }>(ctx.request, { maxBytes: 256 * 1024 });
    const v = new Validator(body as Record<string, unknown>);
    const answersRaw = v.array('answers', { maxItems: 300 });
    v.throwIfInvalid();
    if (!answersRaw?.length) throw badRequest('No answers supplied.');

    const inputs: AnswerInput[] = [];
    for (const raw of answersRaw) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.examQuestionId !== 'string') continue;
      const selectedOptions = Array.isArray(item.selectedOptions)
        ? item.selectedOptions.filter((o): o is string => typeof o === 'string' && o.length <= 8).slice(0, 10)
        : undefined;
      const statusRaw = typeof item.status === 'string' ? item.status : 'answered';
      const status = ['not_answered', 'answered', 'marked_for_review', 'answered_marked'].includes(statusRaw)
        ? (statusRaw as AnswerInput['status'])
        : 'answered';
      inputs.push({
        examQuestionId: item.examQuestionId,
        selectedOptions,
        numericAnswer: typeof item.numericAnswer === 'number' && Number.isFinite(item.numericAnswer) ? item.numericAnswer : null,
        integerAnswer: typeof item.integerAnswer === 'number' && Number.isInteger(item.integerAnswer) ? item.integerAnswer : null,
        status,
        timeSpentSeconds: typeof item.timeSpentSeconds === 'number' ? item.timeSpentSeconds : 0,
      });
    }

    const result = await saveAnswers(ctx.env, attempt, exam, inputs);
    return json(result);
  });

  // ---- Submit --------------------------------------------------------------
  router.post('/api/exams/attempts/:attemptId/submit', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.examSubmit, clientIdentity(ctx.request, auth.user.id));
    const attempt = await loadOwnedAttempt(ctx, ctx.params.attemptId, auth.user.id);

    const outcome = await submitAttempt(ctx.env, attempt.id, { channel: 'manual', userId: auth.user.id });
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'exam.submit',
      entityType: 'exam_attempt',
      entityId: attempt.id,
      meta: { examId: attempt.exam_id, alreadySubmitted: outcome.alreadySubmitted },
    });

    const exam = await getExam(ctx.env, attempt.exam_id);
    const visible =
      exam.result_publish_mode === 'immediate'
        ? true
        : exam.result_publish_mode === 'after_window' && exam.end_at
          ? Date.now() > Date.parse(exam.end_at)
          : false;

    return json({
      attemptId: outcome.attemptId,
      status: outcome.status,
      resultId: outcome.resultId,
      resultVisible: visible || exam.result_publish_mode === 'immediate',
      alreadySubmitted: outcome.alreadySubmitted,
    });
  });

  // ---- Convenience aliases matching the published API contract -----------
  router.post('/api/exams/:id/start', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.examStart, clientIdentity(ctx.request, auth.user.id));
    const exam = await getExam(ctx.env, ctx.params.id);
    const { attempt, resumed } = await startOrResumeAttempt(ctx.env, exam, auth.user.id);
    const session = await buildSession(ctx.env, exam, attempt);
    return json({ ...session, resumed });
  });

  router.post('/api/exams/:id/answers', async (ctx) => {
    const auth = await requireAuth(ctx);
    const body = await readJson<{ attemptId?: string; answers?: unknown }>(ctx.request, { maxBytes: 256 * 1024 });
    if (!body.attemptId) throw badRequest('attemptId is required.');
    const attempt = await loadOwnedAttempt(ctx, body.attemptId, auth.user.id);
    if (attempt.exam_id !== ctx.params.id) throw badRequest('Attempt does not belong to this examination.');
    const exam = await getExam(ctx.env, attempt.exam_id);
    const inputs: AnswerInput[] = (Array.isArray(body.answers) ? body.answers : [])
      .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
      .map((a) => ({
        examQuestionId: String(a.examQuestionId ?? ''),
        selectedOptions: Array.isArray(a.selectedOptions) ? a.selectedOptions.map(String).slice(0, 10) : undefined,
        numericAnswer: typeof a.numericAnswer === 'number' ? a.numericAnswer : null,
        integerAnswer: typeof a.integerAnswer === 'number' ? a.integerAnswer : null,
        status: (['not_answered', 'answered', 'marked_for_review', 'answered_marked'] as const).includes(a.status as never)
          ? (a.status as AnswerInput['status'])
          : 'answered',
      }));
    return json(await saveAnswers(ctx.env, attempt, exam, inputs));
  });

  router.post('/api/exams/:id/submit', async (ctx) => {
    const auth = await requireAuth(ctx);
    const body = await readJson<{ attemptId?: string }>(ctx.request);
    if (!body.attemptId) throw badRequest('attemptId is required.');
    const attempt = await loadOwnedAttempt(ctx, body.attemptId, auth.user.id);
    if (attempt.exam_id !== ctx.params.id) throw badRequest('Attempt does not belong to this examination.');
    const outcome = await submitAttempt(ctx.env, attempt.id, { channel: 'manual', userId: auth.user.id });
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'exam.submit',
      entityType: 'exam_attempt',
      entityId: attempt.id,
    });
    return json(outcome);
  });

  // ---- Exam overview -------------------------------------------------------
  router.get('/api/exams/:id', async (ctx) => {
    const exam = await getExam(ctx.env, ctx.params.id);
    const row = await ctx.env.DB.prepare(
      `SELECT e.id, e.title, e.description, e.instructions, e.exam_kind AS examKind, e.course_id AS courseId,
              e.duration_minutes AS durationMinutes, e.total_marks AS totalMarks, e.total_questions AS totalQuestions,
              e.negative_marks AS negativeMarks, e.negative_marking_enabled AS negativeMarkingEnabled,
              e.start_at AS startAt, e.end_at AS endAt, e.max_attempts AS maxAttempts, e.is_free AS isFree, e.status,
              e.result_publish_mode AS resultPublishMode, e.passing_percentage AS passingPercentage,
              c.name AS courseName, et.name AS examTypeName, s.name AS subjectName
         FROM exams e
         LEFT JOIN courses c ON c.id = e.course_id
         LEFT JOIN exam_types et ON et.id = e.exam_type_id
         LEFT JOIN subjects s ON s.id = e.subject_id
        WHERE e.id = ?1`,
    )
      .bind(ctx.params.id)
      .first<Record<string, unknown>>();

    if (!row) throw notFound('Examination not found.');
    if (exam.status !== 'published' && exam.status !== 'scheduled') throw notFound('Examination not found.');

    const sections = await ctx.env.DB.prepare(
      `SELECT es.id, es.title, es.instructions, es.is_optional AS isOptional, es.sort_order AS sortOrder,
              s.name AS subjectName,
              (SELECT COUNT(*) FROM exam_questions eq WHERE eq.section_id = es.id) AS questionCount
         FROM exam_sections es LEFT JOIN subjects s ON s.id = es.subject_id
        WHERE es.exam_id = ?1 ORDER BY es.sort_order ASC`,
    )
      .bind(exam.id)
      .all<Record<string, unknown>>();

    return json({
      exam: {
        ...publicExam(row),
        instructions: row.instructions,
        resultPublishMode: row.resultPublishMode,
        passingPercentage: Number(row.passingPercentage ?? 0),
      },
      sections: (sections.results ?? []).map((s) => ({ ...s, isOptional: Boolean(s.isOptional) })),
    });
  });

  // ---- Results -------------------------------------------------------------
  router.get('/api/results', async (ctx) => {
    const auth = await requireAuth(ctx);
    const page = parsePage(ctx.url, { pageSize: 20 });
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM results WHERE user_id = ?1').bind(auth.user.id).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT r.id, r.attempt_id AS attemptId, r.exam_id AS examId, e.title AS examTitle, r.score, r.max_score AS maxScore,
                r.percentage, r.accuracy, r.correct_count AS correctCount, r.wrong_count AS wrongCount,
                r.unattempted_count AS unattemptedCount, r.time_spent_seconds AS timeSpentSeconds, r.passed,
                r.is_published AS isPublished, r.computed_at AS computedAt, r.rank, r.percentile,
                e.result_publish_mode AS publishMode, e.end_at AS endAt, a.status AS attemptStatus
           FROM results r
           JOIN exams e ON e.id = r.exam_id
           JOIN exam_attempts a ON a.id = r.attempt_id
          WHERE r.user_id = ?1
          ORDER BY r.computed_at DESC LIMIT ?2 OFFSET ?3`,
      )
        .bind(auth.user.id, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    const items = (rows.results ?? []).map((r) => {
      const visible = resultVisibleToStudent(
        { result_publish_mode: r.publishMode as never, end_at: (r.endAt as string) ?? null },
        { is_published: Number(r.isPublished ?? 0) },
        String(r.attemptStatus),
      );
      return {
        ...r,
        score: Number(r.score ?? 0),
        maxScore: Number(r.maxScore ?? 0),
        percentage: Number(r.percentage ?? 0),
        accuracy: Number(r.accuracy ?? 0),
        correctCount: Number(r.correctCount ?? 0),
        wrongCount: Number(r.wrongCount ?? 0),
        unattemptedCount: Number(r.unattemptedCount ?? 0),
        timeSpentSeconds: Number(r.timeSpentSeconds ?? 0),
        passed: Boolean(Number(r.passed ?? 0)),
        isPublished: visible,
        rank: visible ? (r.rank as number) ?? null : null,
        percentile: visible ? (r.percentile as number) ?? null : null,
      };
    });

    return json(paginated(items, Number(count?.n ?? 0), page));
  });

  router.get('/api/results/:id', async (ctx) => {
    const auth = await requireAuth(ctx);
    const row = await getResultForUser(ctx.env, ctx.params.id, auth.user.id, auth.isStaff);

    const visible = resultVisibleToStudent(
      { result_publish_mode: row.publishMode as never, end_at: (row.endAt as string) ?? null },
      { is_published: Number(row.isPublished ?? 0) },
      String(row.attemptStatus),
    );

    if (!visible && !auth.isStaff) {
      return json(
        {
          id: row.id,
          examId: row.examId,
          examTitle: row.examTitle,
          attemptId: row.attemptId,
          isPublished: false,
          message:
            row.publishMode === 'after_window'
              ? 'Your responses were recorded. Results will be released after the examination window closes.'
              : 'Your responses were recorded. Results will be released by your institute shortly.',
          computedAt: row.computedAt,
        },
        { status: 200 },
      );
    }

    // Ranking (only for published results with a large enough cohort).
    let rank: number | null = row.rank ? Number(row.rank) : null;
    let percentile: number | null = row.percentile ? Number(row.percentile) : null;
    if (row.rankEnabled && rank === null && visible) {
      const computed = await computeRanking(ctx.env, String(row.examId), String(row.id));
      rank = computed.rank;
      percentile = computed.percentile;
      if (rank !== null) {
        await ctx.env.DB.prepare('UPDATE results SET rank = ?2, percentile = ?3 WHERE id = ?1')
          .bind(row.id, rank, percentile)
          .run();
      }
    }

    // Per-question review — ONLY after the result is released.
    let review: unknown[] | null = null;
    if (visible) {
      const rows = await ctx.env.DB.prepare(
        `SELECT aa.exam_question_id AS examQuestionId, aa.question_id AS questionId,
                aa.selected_options AS selectedOptions, aa.numeric_answer AS numericAnswer,
                aa.integer_answer AS integerAnswer, aa.evaluation, aa.marks_awarded AS marksAwarded,
                aa.status, q.question_text AS questionText, q.question_type AS questionType,
                ak.correct_options AS correctOptions, ak.numeric_answer AS correctNumeric,
                ak.integer_answer AS correctInteger, ex.explanation_text AS explanation
           FROM attempt_answers aa
           JOIN questions q ON q.id = aa.question_id
           LEFT JOIN answer_keys ak ON ak.question_id = aa.question_id
           LEFT JOIN explanations ex ON ex.question_id = aa.question_id
          WHERE aa.attempt_id = ?1
          ORDER BY aa.rowid ASC`,
      )
        .bind(row.attemptId)
        .all<Record<string, unknown>>();

      const optionRows = await ctx.env.DB.prepare(
        `SELECT qo.question_id AS questionId, qo.option_key AS key, qo.option_text AS text, qo.is_correct AS isCorrect
           FROM question_options qo
          WHERE qo.question_id IN (SELECT question_id FROM attempt_answers WHERE attempt_id = ?1)
          ORDER BY qo.sort_order ASC`,
      )
        .bind(row.attemptId)
        .all<Record<string, unknown>>();

      const optionsByQuestion = new Map<string, { key: string; text: string | null; isCorrect: boolean }[]>();
      for (const o of optionRows.results ?? []) {
        const list = optionsByQuestion.get(String(o.questionId)) ?? [];
        list.push({ key: String(o.key), text: (o.text as string) ?? null, isCorrect: Boolean(Number(o.isCorrect ?? 0)) });
        optionsByQuestion.set(String(o.questionId), list);
      }

      review = (rows.results ?? []).map((r) => ({
        examQuestionId: r.examQuestionId,
        questionId: r.questionId,
        questionText: r.questionText,
        questionType: r.questionType,
        options: optionsByQuestion.get(String(r.questionId)) ?? [],
        selectedOptions: parseJsonArray(r.selectedOptions),
        numericAnswer: r.numericAnswer === null || r.numericAnswer === undefined ? null : Number(r.numericAnswer),
        correctOptions: parseJsonArray(r.correctOptions),
        numericAnswerValue: r.correctNumeric === null || r.correctNumeric === undefined ? null : Number(r.correctNumeric),
        correctInteger: r.correctInteger === undefined || r.correctInteger === null ? null : Number(r.correctInteger),
        explanation: (r.explanation as string) ?? null,
        evaluation: r.evaluation ?? 'unattempted',
        marksAwarded: Number(r.marksAwarded ?? 0),
        status: r.status,
      }));
    }

    return json({
      id: row.id,
      attemptId: row.attemptId,
      examId: row.examId,
      examTitle: row.examTitle,
      score: Number(row.score ?? 0),
      maxScore: Number(row.maxScore ?? 0),
      percentage: Number(row.percentage ?? 0),
      accuracy: Number(row.accuracy ?? 0),
      correctCount: Number(row.correctCount ?? 0),
      wrongCount: Number(row.wrongCount ?? 0),
      unattemptedCount: Number(row.unattemptedCount ?? 0),
      timeSpentSeconds: Number(row.timeSpentSeconds ?? 0),
      passed: Boolean(Number(row.passed ?? 0)),
      isPublished: visible,
      rank,
      percentile,
      subjectBreakdown: JSON.parse(String(row.subjectBreakdown ?? '[]')),
      chapterBreakdown: JSON.parse(String(row.chapterBreakdown ?? '[]')),
      computedAt: row.computedAt,
      review,
    });
  });

  // ---- Bookmarks toggle for exams (guard against duplicates) -------------
  router.post('/api/bookmarks', async (ctx) => {
    const auth = await requireAuth(ctx);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const itemType = v.enum('itemType', ['lecture', 'course', 'exam', 'test_paper', 'series'] as const, { required: true });
    const itemId = v.string('itemId', { required: true, max: 80 });
    v.throwIfInvalid();

    const existing = await ctx.env.DB.prepare(
      'SELECT id FROM bookmarks WHERE user_id = ?1 AND item_type = ?2 AND item_id = ?3',
    )
      .bind(auth.user.id, itemType!, itemId!)
      .first<{ id: string }>();

    if (existing) {
      await ctx.env.DB.prepare('DELETE FROM bookmarks WHERE id = ?1').bind(existing.id).run();
      return json({ bookmarked: false });
    }

    await ctx.env.DB.prepare(
      `INSERT INTO bookmarks (id, user_id, item_type, item_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id, item_type, item_id) DO NOTHING`,
    )
      .bind(crypto.randomUUID(), auth.user.id, itemType!, itemId!, nowIso())
      .run();
    return json({ bookmarked: true });
  });

  router.get('/api/bookmarks', async (ctx) => {
    const auth = await requireAuth(ctx);
    const type = ctx.url.searchParams.get('type');
    const rows = type
      ? await ctx.env.DB.prepare(
          `SELECT id, item_type AS itemType, item_id AS itemId, created_at AS createdAt
             FROM bookmarks WHERE user_id = ?1 AND item_type = ?2 ORDER BY created_at DESC LIMIT 200`,
        )
          .bind(auth.user.id, type)
          .all()
      : await ctx.env.DB.prepare(
          `SELECT id, item_type AS itemType, item_id AS itemId, created_at AS createdAt
             FROM bookmarks WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 200`,
        )
          .bind(auth.user.id)
          .all();

    const items = rows.results ?? [];
    if (!items.length) return json({ items: [] });

    const byType = new Map<string, string[]>();
    for (const item of items) {
      const list = byType.get(String(item.itemType)) ?? [];
      list.push(String(item.itemId));
      byType.set(String(item.itemType), list);
    }

    const detailQueries: D1PreparedStatement[] = [];
    const placeholders = (ids: string[]) => ids.map((_, i) => `?${i + 1}`).join(',');
    if (byType.get('lecture')?.length) {
      detailQueries.push(
        ctx.env.DB.prepare(
          `SELECT id, title, thumbnail_url AS thumbnailUrl, duration_seconds AS durationSeconds, youtube_video_id AS youtubeVideoId
             FROM lectures WHERE id IN (${placeholders(byType.get('lecture')!)}) AND status = 'published'`,
        ).bind(...byType.get('lecture')!),
      );
    }
    if (byType.get('course')?.length) {
      detailQueries.push(
        ctx.env.DB.prepare(
          `SELECT id, name AS title, cover_image_url AS thumbnailUrl FROM courses WHERE id IN (${placeholders(byType.get('course')!)}) AND status = 'published'`,
        ).bind(...byType.get('course')!),
      );
    }
    if (byType.get('exam')?.length) {
      detailQueries.push(
        ctx.env.DB.prepare(
          `SELECT id, title, NULL AS thumbnailUrl, duration_minutes AS durationSeconds FROM exams WHERE id IN (${placeholders(byType.get('exam')!)})`,
        ).bind(...byType.get('exam')!),
      );
    }
    if (byType.get('test_paper')?.length) {
      detailQueries.push(
        ctx.env.DB.prepare(
          `SELECT id, title, cover_image_url AS thumbnailUrl, file_url AS fileUrl FROM test_papers WHERE id IN (${placeholders(byType.get('test_paper')!)})`,
        ).bind(...byType.get('test_paper')!),
      );
    }
    if (byType.get('series')?.length) {
      detailQueries.push(
        ctx.env.DB.prepare(
          `SELECT id, title, thumbnail_url AS thumbnailUrl, lecture_count AS lectureCount FROM lecture_series WHERE id IN (${placeholders(byType.get('series')!)})`,
        ).bind(...byType.get('series')!),
      );
    }

    const details = detailQueries.length ? await ctx.env.DB.batch<Record<string, unknown>>(detailQueries) : [];
    const detailMap = new Map<string, Record<string, unknown>>();
    for (const result of details) for (const row of result.results ?? []) detailMap.set(String(row.id), row);

    return json({
      items: items.map((item) => ({
        ...item,
        detail: detailMap.get(String(item.itemId)) ?? null,
      })),
    });
  });
}
