// =============================================================================
// Admin: question bank + answer keys (never exposed to students pre-submit)
// =============================================================================

import type { Router } from '../../lib/router';
import {
  badRequest,
  conflict,
  json,
  notFound,
  parsePage,
  paginated,
  readJson,
  Validator,
} from '../../lib/http';
import { requirePermission } from '../../services/session';
import { writeAudit } from '../../lib/audit';
import { newId, nowIso } from '../../lib/util';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUESTION_TYPES = ['single_correct', 'multiple_correct', 'numerical', 'integer', 'passage', 'image_based'] as const;

function uuidParam(value: string | undefined): string {
  if (!value || !UUID_RE.test(value)) throw badRequest('Invalid identifier.');
  return value;
}

type OptionInput = { key: string; text?: string | null; imageUrl?: string | null; isCorrect?: boolean };

async function writeOptions(
  env: { DB: D1Database },
  questionId: string,
  options: OptionInput[],
  correctKeys: string[],
): Promise<void> {
  const orRegex = /^[A-Z0-9]{1,4}$/;
  const cleaned = options
    .map((o, index) => ({
      key: String(o.key ?? '').trim().toUpperCase(),
      text: o.text ?? null,
      imageUrl: o.imageUrl ?? null,
      sortOrder: index,
      isCorrect: correctKeys.includes(String(o.key ?? '').trim().toUpperCase()),
    }))
    .filter((o) => orRegex.test(o.key));

  if (cleaned.length < 2) throw badRequest('At least two options are required.');

  await env.DB.prepare('DELETE FROM question_options WHERE question_id = ?1').bind(questionId).run();
  const statements = cleaned.map((o) =>
    env.DB.prepare(
      `INSERT INTO question_options (id, question_id, option_key, option_text, option_image_url, is_correct, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(newId(), questionId, o.key, o.text, o.imageUrl, o.isCorrect ? 1 : 0, o.sortOrder),
  );
  if (statements.length) await env.DB.batch(statements);
}

async function writeAnswerKey(
  env: { DB: D1Database },
  questionId: string,
  questionType: string,
  correctKeys: string[],
  numericAnswer: number | null,
  numericTolerance: number,
): Promise<void> {
  const answerType =
    questionType === 'multiple_correct' ? 'multiple' : questionType === 'numerical' ? 'numeric' : questionType === 'integer' ? 'integer' : 'single';

  await env.DB.prepare(
    `INSERT INTO answer_keys (id, question_id, answer_type, correct_options, numeric_answer, numeric_tolerance, integer_answer)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(question_id) DO UPDATE SET answer_type = excluded.answer_type, correct_options = excluded.correct_options,
       numeric_answer = excluded.numeric_answer, numeric_tolerance = excluded.numeric_tolerance, integer_answer = excluded.integer_answer`,
  )
    .bind(
      newId(),
      questionId,
      answerType,
      correctKeys.length ? JSON.stringify(correctKeys) : null,
      answerType === 'numeric' ? numericAnswer : null,
      numericTolerance,
      answerType === 'integer' && numericAnswer !== null ? Math.round(numericAnswer) : null,
    )
    .run();
}

export function registerAdminQuestionRoutes(router: Router): void {
  router.get('/api/admin/questions', async (ctx) => {
    await requirePermission(ctx, 'questions.view');
    const page = parsePage(ctx.url, { pageSize: 25, maxPageSize: 100 });
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const subjectId = ctx.url.searchParams.get('subjectId');
    const chapterId = ctx.url.searchParams.get('chapterId');
    const type = ctx.url.searchParams.get('type');
    const difficulty = ctx.url.searchParams.get('difficulty');
    const status = ctx.url.searchParams.get('status');

    const where: string[] = [];
    const binds: unknown[] = [];
    if (q) {
      binds.push(`%${q}%`);
      where.push(`q.question_text LIKE ?${binds.length}`);
    }
    if (subjectId) {
      binds.push(subjectId);
      where.push(`q.subject_id = ?${binds.length}`);
    }
    if (chapterId) {
      binds.push(chapterId);
      where.push(`q.chapter_id = ?${binds.length}`);
    }
    if (type) {
      binds.push(type);
      where.push(`q.question_type = ?${binds.length}`);
    }
    if (difficulty) {
      binds.push(difficulty);
      where.push(`q.difficulty = ?${binds.length}`);
    }
    if (status) {
      binds.push(status);
      where.push(`q.status = ?${binds.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM questions q ${whereSql}`).bind(...binds).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT q.id, q.question_text AS questionText, q.question_type AS questionType, q.difficulty, q.marks,
                q.negative_marks AS negativeMarks, q.status, q.created_at AS createdAt, q.updated_at AS updatedAt,
                q.source, q.year, q.tags,
                s.name AS subjectName, ch.name AS chapterName, s.id AS subjectId, ch.id AS chapterId,
                (SELECT COUNT(*) FROM question_options qo WHERE qo.question_id = q.id) AS optionCount,
                (SELECT COUNT(*) FROM exam_questions eq WHERE eq.question_id = q.id) AS usageCount
           FROM questions q
           LEFT JOIN subjects s ON s.id = q.subject_id
           LEFT JOIN chapters ch ON ch.id = q.chapter_id
           ${whereSql}
          ORDER BY q.created_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    return json(paginated(rows.results ?? [], Number(count?.n ?? 0), page));
  });

  router.get('/api/admin/questions/:id', async (ctx) => {
    await requirePermission(ctx, 'questions.view');
    const id = uuidParam(ctx.params.id);
    const [question, options, key, explanation] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare('SELECT * FROM questions WHERE id = ?1').bind(id),
      ctx.env.DB.prepare('SELECT id, option_key AS key, option_text AS text, option_image_url AS imageUrl, is_correct AS isCorrect, sort_order AS sortOrder FROM question_options WHERE question_id = ?1 ORDER BY sort_order ASC').bind(id),
      ctx.env.DB.prepare('SELECT * FROM answer_keys WHERE question_id = ?1').bind(id),
      ctx.env.DB.prepare('SELECT * FROM explanations WHERE question_id = ?1').bind(id),
    ]);
    if (!question.results?.length) throw notFound('Question not found.');
    return json({
      question: question.results[0],
      options: (options.results ?? []).map((o) => ({ ...o, isCorrect: Boolean(o.isCorrect) })),
      answerKey: key.results?.[0] ?? null,
      explanation: explanation.results?.[0] ?? null,
    });
  });

  router.post('/api/admin/questions', async (ctx) => {
    const auth = await requirePermission(ctx, 'questions.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const questionText = v.string('questionText', { required: true, max: 8000 })!;
    const questionType = v.enum('questionType', QUESTION_TYPES, { fallback: 'single_correct' })!;
    const difficulty = v.enum('difficulty', ['easy', 'medium', 'hard'] as const, { fallback: 'medium' })!;
    const subjectId = v.string('subjectId', { max: 64 });
    const chapterId = v.string('chapterId', { max: 64 });
    const courseId = v.string('courseId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const questionImageUrl = v.string('questionImageUrl', { max: 512 });
    const passageText = v.string('passageText', { max: 8000 });
    const passageImageUrl = v.string('passageImageUrl', { max: 512 });
    const explanationText = v.string('explanation', { max: 8000 });
    const marks = v.number('marks', { min: 0, max: 100 }) ?? 4;
    const negativeMarks = v.number('negativeMarks', { min: 0, max: 100 }) ?? 1;
    const source = v.string('source', { max: 200 });
    const year = v.number('year', { min: 1990, max: 2100, integer: true });
    const status = v.enum('status', ['draft', 'published', 'archived'] as const, { fallback: 'published' })!;
    const correctOptionsRaw = v.array('correctOptions', { maxItems: 10 });
    const numericAnswer = v.number('numericAnswer', { min: -1e9, max: 1e9 });
    const numericTolerance = v.number('numericTolerance', { min: 0, max: 1e6 }) ?? 0;
    const options = v.array('options', { maxItems: 10 });
    v.throwIfInvalid();

    const correctKeys = (correctOptionsRaw ?? []).map((k) => String(k).toUpperCase());
    const isNumeric = questionType === 'numerical' || questionType === 'integer';

    if (!isNumeric) {
      if (!options || options.length < 2) throw badRequest('Provide at least two options.');
      if (!correctKeys.length) throw badRequest('Select the correct option(s).');
    } else {
      if (numericAnswer === undefined) throw badRequest('Numeric/integer questions require an answer value.');
    }

    const id = newId();
    await ctx.env.DB.prepare(
      `INSERT INTO questions (id, subject_id, chapter_id, course_id, exam_type_id, question_type, difficulty, question_text,
          question_image_url, passage_text, passage_image_url, marks, negative_marks, source, year, status, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)`,
    )
      .bind(
        id,
        subjectId ?? null,
        chapterId ?? null,
        courseId ?? null,
        examTypeId ?? null,
        questionType,
        difficulty,
        questionText,
        questionImageUrl ?? null,
        passageText ?? null,
        passageImageUrl ?? null,
        marks,
        negativeMarks,
        source ?? null,
        year ?? null,
        status,
        auth.user.id,
        nowIso(),
      )
      .run();

    if (!isNumeric) await writeOptions(ctx.env, id, options as OptionInput[], correctKeys);
    await writeAnswerKey(ctx.env, id, questionType, correctKeys, numericAnswer ?? null, numericTolerance);

    if (explanationText) {
      await ctx.env.DB.prepare('INSERT INTO explanations (id, question_id, explanation_text) VALUES (?1, ?2, ?3)')
        .bind(newId(), id, explanationText)
        .run();
    }

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'question.create',
      entityType: 'question',
      entityId: id,
      after: { questionType, difficulty, status },
    });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/questions/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'questions.manage');
    const id = uuidParam(ctx.params.id);
    const exists = await ctx.env.DB.prepare('SELECT id, question_type FROM questions WHERE id = ?1')
      .bind(id)
      .first<{ id: string; question_type: string }>();
    if (!exists) throw notFound('Question not found.');

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const questionText = v.string('questionText', { max: 8000 });
    const questionType = v.enum('questionType', QUESTION_TYPES);
    const difficulty = v.enum('difficulty', ['easy', 'medium', 'hard'] as const);
    const subjectId = v.string('subjectId', { max: 64 });
    const chapterId = v.string('chapterId', { max: 64 });
    const questionImageUrl = v.string('questionImageUrl', { max: 512 });
    const passageText = v.string('passageText', { max: 8000 });
    const explanationText = v.string('explanation', { max: 8000 });
    const marks = v.number('marks', { min: 0, max: 100 });
    const negativeMarks = v.number('negativeMarks', { min: 0, max: 100 });
    const status = v.enum('status', ['draft', 'published', 'archived'] as const);
    const correctOptionsRaw = v.array('correctOptions', { maxItems: 10 });
    const numericAnswer = v.number('numericAnswer', { min: -1e9, max: 1e9 });
    const numericTolerance = v.number('numericTolerance', { min: 0, max: 1e6 });
    const options = v.array('options', { maxItems: 10 });
    v.throwIfInvalid();

    const fields: Record<string, unknown> = {
      question_text: questionText ?? undefined,
      question_type: questionType ?? undefined,
      difficulty: difficulty ?? undefined,
      subject_id: subjectId ?? undefined,
      chapter_id: chapterId ?? undefined,
      question_image_url: questionImageUrl ?? undefined,
      passage_text: passageText ?? undefined,
      marks: marks ?? undefined,
      negative_marks: negativeMarks ?? undefined,
      status: status ?? undefined,
      updated_by: auth.user.id,
    };
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (keys.length) {
      await ctx.env.DB.prepare(`UPDATE questions SET ${keys.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
        .bind(id, ...keys.map((k) => fields[k]))
        .run();
    }

    const effectiveType = questionType ?? exists.question_type;
    const correctKeys = (correctOptionsRaw ?? []).map((k) => String(k).toUpperCase());

    if (options && options.length) {
      await writeOptions(ctx.env, id, options as OptionInput[], correctKeys);
    } else if (correctKeys.length) {
      // Update only the correctness flags of existing options.
      await ctx.env.DB.prepare('UPDATE question_options SET is_correct = 0 WHERE question_id = ?1').bind(id).run();
      for (const key of correctKeys) {
        await ctx.env.DB.prepare('UPDATE question_options SET is_correct = 1 WHERE question_id = ?1 AND option_key = ?2')
          .bind(id, key)
          .run();
      }
    }

    if (correctKeys.length || numericAnswer !== undefined) {
      await writeAnswerKey(ctx.env, id, effectiveType, correctKeys, numericAnswer ?? null, numericTolerance ?? 0);
    }

    if (explanationText !== undefined) {
      await ctx.env.DB.prepare(
        `INSERT INTO explanations (id, question_id, explanation_text) VALUES (?1, ?2, ?3)
         ON CONFLICT(question_id) DO UPDATE SET explanation_text = excluded.explanation_text`,
      )
        .bind(newId(), id, explanationText)
        .run();
    }

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'question.update',
      entityType: 'question',
      entityId: id,
      after: { questionType, difficulty, status },
    });
    return json({ ok: true });
  });

  router.delete('/api/admin/questions/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'questions.manage');
    const id = uuidParam(ctx.params.id);
    const usage = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM exam_questions WHERE question_id = ?1').bind(id).first<{ n: number }>();
    if (Number(usage?.n ?? 0) > 0) {
      throw conflict('This question is used by an examination. Remove it from the exam first, or archive it.');
    }
    await ctx.env.DB.prepare('DELETE FROM questions WHERE id = ?1').bind(id).run();
    await writeAudit(ctx.env, ctx.request, auth, { action: 'question.delete', entityType: 'question', entityId: id });
    return json({ ok: true });
  });

  // Bulk import of questions into an examination by ids
  router.post('/api/admin/questions/bulk-status', async (ctx) => {
    const auth = await requirePermission(ctx, 'questions.manage');
    const body = await readJson(ctx.request);
    const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string' && UUID_RE.test(i)) : [];
    const status = body.status === 'archived' ? 'archived' : body.status === 'draft' ? 'draft' : 'published';
    if (!ids.length) throw badRequest('No valid question ids supplied.');
    const statements = ids.map((id) => ctx.env.DB.prepare('UPDATE questions SET status = ?2 WHERE id = ?1').bind(id, status));
    await ctx.env.DB.batch(statements);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'questions.bulk_status',
      entityType: 'question',
      meta: { count: ids.length, status },
    });
    return json({ ok: true, updated: ids.length });
  });
}
