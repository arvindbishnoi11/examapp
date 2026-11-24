// =============================================================================
// Admin: test series, examinations, sections, exam papers, attempts, results
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
import { invalidateAsync } from '../../lib/cache';
import { newId, nowIso, toCsv } from '../../lib/util';
import { ensureUniqueSlug } from '../../lib/slug';
import { submitAttempt } from '../../services/exams';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidParam(value: string | undefined): string {
  if (!value || !UUID_RE.test(value)) throw badRequest('Invalid identifier.');
  return value;
}

const EXAM_KINDS = ['practice', 'chapter', 'topic', 'full_mock', 'previous_year', 'board', 'custom'] as const;

async function recomputeExam(env: { DB: D1Database }, examId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE exams SET
       total_questions = (SELECT COUNT(*) FROM exam_questions WHERE exam_id = ?1),
       total_marks = (SELECT COALESCE(SUM(marks), 0) FROM exam_questions WHERE exam_id = ?1)
     WHERE id = ?1`,
  )
    .bind(examId)
    .run();
}

export function registerAdminExamRoutes(router: Router): void {
  // ===================== TEST SERIES =====================================
  router.get('/api/admin/test-series', async (ctx) => {
    await requirePermission(ctx, 'exams.view');
    const rows = await ctx.env.DB.prepare(
      `SELECT ts.*, c.name AS courseName, et.name AS examTypeName,
              (SELECT COUNT(*) FROM exams e WHERE e.test_series_id = ts.id) AS examCount
         FROM test_series ts
         LEFT JOIN courses c ON c.id = ts.course_id
         LEFT JOIN exam_types et ON et.id = ts.exam_type_id
        ORDER BY ts.sort_order ASC, ts.created_at DESC LIMIT 200`,
    ).all<Record<string, unknown>>();
    return json({ items: (rows.results ?? []).map((r) => ({ ...r, isFree: Boolean(r.isFree) })) });
  });

  router.post('/api/admin/test-series', async (ctx) => {
    const auth = await requirePermission(ctx, 'test_series.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const name = v.string('name', { required: true, max: 160 })!;
    const description = v.string('description', { max: 2000 });
    const courseId = v.string('courseId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const status = v.enum('status', ['draft', 'published', 'archived'] as const, { fallback: 'draft' })!;
    const isFree = v.boolean('isFree', false)!;
    const sortOrder = v.number('sortOrder', { min: 0, max: 10000, integer: true }) ?? 0;
    v.throwIfInvalid();

    const id = newId();
    await ctx.env.DB.prepare(
      `INSERT INTO test_series (id, name, slug, description, course_id, exam_type_id, is_free, status, sort_order, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
    )
      .bind(id, name, await ensureUniqueSlug(ctx.env.DB, 'test_series', 'slug', name), description ?? null, courseId ?? null, examTypeId ?? null, isFree ? 1 : 0, status, sortOrder, auth.user.id, nowIso())
      .run();
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'test_series.create', entityType: 'test_series', entityId: id, after: { name } });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/test-series/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'test_series.manage');
    const id = uuidParam(ctx.params.id);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const name = v.string('name', { max: 160 });
    const description = v.string('description', { max: 2000 });
    const courseId = v.string('courseId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const status = v.enum('status', ['draft', 'published', 'archived'] as const);
    const isFree = v.boolean('isFree');
    const sortOrder = v.number('sortOrder', { min: 0, max: 10000, integer: true });
    v.throwIfInvalid();
    const exists = await ctx.env.DB.prepare('SELECT id FROM test_series WHERE id = ?1').bind(id).first();
    if (!exists) throw notFound('Test series not found.');

    const fields: Record<string, unknown> = {
      name: name ?? undefined,
      description: description ?? undefined,
      course_id: courseId ?? undefined,
      exam_type_id: examTypeId ?? undefined,
      status: status ?? undefined,
      is_free: isFree === undefined ? undefined : isFree ? 1 : 0,
      sort_order: sortOrder ?? undefined,
    };
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (keys.length) {
      await ctx.env.DB.prepare(`UPDATE test_series SET ${keys.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
        .bind(id, ...keys.map((k) => fields[k]))
        .run();
    }
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'test_series.update', entityType: 'test_series', entityId: id, after: body });
    return json({ ok: true });
  });

  router.delete('/api/admin/test-series/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'test_series.manage');
    const id = uuidParam(ctx.params.id);
    await ctx.env.DB.prepare('UPDATE exams SET test_series_id = NULL WHERE test_series_id = ?1').bind(id).run();
    await ctx.env.DB.prepare('DELETE FROM test_series WHERE id = ?1').bind(id).run();
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'test_series.delete', entityType: 'test_series', entityId: id });
    return json({ ok: true });
  });

  // ===================== EXAMS ===========================================
  router.get('/api/admin/exams', async (ctx) => {
    await requirePermission(ctx, 'exams.view');
    const page = parsePage(ctx.url, { pageSize: 25, maxPageSize: 100 });
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const status = ctx.url.searchParams.get('status');
    const courseId = ctx.url.searchParams.get('courseId');
    const kind = ctx.url.searchParams.get('kind');

    const where: string[] = [];
    const binds: unknown[] = [];
    if (q) {
      binds.push(`%${q}%`);
      where.push(`e.title LIKE ?${binds.length}`);
    }
    if (status) {
      binds.push(status);
      where.push(`e.status = ?${binds.length}`);
    }
    if (courseId) {
      binds.push(courseId);
      where.push(`e.course_id = ?${binds.length}`);
    }
    if (kind) {
      binds.push(kind);
      where.push(`e.exam_kind = ?${binds.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM exams e ${whereSql}`).bind(...binds).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT e.id, e.title, e.description, e.exam_kind AS examKind, e.status, e.duration_minutes AS durationMinutes,
                e.total_marks AS totalMarks, e.total_questions AS totalQuestions, e.negative_marks AS negativeMarks,
                e.negative_marking_enabled AS negativeMarkingEnabled, e.start_at AS startAt, e.end_at AS endAt,
                e.max_attempts AS maxAttempts, e.result_publish_mode AS resultPublishMode, e.is_free AS isFree,
                e.shuffle_questions AS shuffleQuestions, e.shuffle_options AS shuffleOptions,
                e.created_at AS createdAt, e.updated_at AS updatedAt,
                c.name AS courseName, et.name AS examTypeName, ts.name AS testSeriesName,
                (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id) AS attemptCount,
                (SELECT COUNT(*) FROM results r WHERE r.exam_id = e.id) AS resultCount
           FROM exams e
           LEFT JOIN courses c ON c.id = e.course_id
           LEFT JOIN exam_types et ON et.id = e.exam_type_id
           LEFT JOIN test_series ts ON ts.id = e.test_series_id
           ${whereSql}
          ORDER BY e.created_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    return json(
      paginated(
        (rows.results ?? []).map((r) => ({
          ...r,
          isFree: Boolean(r.isFree),
          negativeMarkingEnabled: Boolean(r.negativeMarkingEnabled),
          shuffleQuestions: Boolean(r.shuffleQuestions),
          shuffleOptions: Boolean(r.shuffleOptions),
        })),
        Number(count?.n ?? 0),
        page,
      ),
    );
  });

  router.get('/api/admin/exams/:id', async (ctx) => {
    await requirePermission(ctx, 'exams.view');
    const id = uuidParam(ctx.params.id);
    const [exam, sections, questions, stats] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare('SELECT e.*, et.name AS examTypeName, c.name AS courseName FROM exams e LEFT JOIN exam_types et ON et.id = e.exam_type_id LEFT JOIN courses c ON c.id = e.course_id WHERE e.id = ?1').bind(id),
      ctx.env.DB.prepare('SELECT id, title, subject_id AS subjectId, chapter_id AS chapterId, instructions, is_optional AS isOptional, max_questions AS maxQuestions, sort_order AS sortOrder FROM exam_sections WHERE exam_id = ?1 ORDER BY sort_order ASC').bind(id),
      ctx.env.DB.prepare(
        `SELECT eq.id AS examQuestionId, eq.question_id AS questionId, eq.section_id AS sectionId, eq.marks, eq.negative_marks AS negativeMarks,
                eq.sort_order AS sortOrder, q.question_text AS questionText, q.question_type AS questionType, q.difficulty,
                s.name AS subjectName
           FROM exam_questions eq JOIN questions q ON q.id = eq.question_id LEFT JOIN subjects s ON s.id = q.subject_id
          WHERE eq.exam_id = ?1 ORDER BY eq.sort_order ASC`,
      ).bind(id),
      ctx.env.DB.prepare(
        `SELECT COUNT(*) AS attempts, COUNT(DISTINCT user_id) AS students,
                ROUND(AVG(percentage),1) AS avgPercentage, MAX(percentage) AS bestPercentage
           FROM results WHERE exam_id = ?1`,
      ).bind(id),
    ]);

    if (!exam.results?.length) throw notFound('Examination not found.');
    return json({
      exam: exam.results[0],
      sections: sections.results ?? [],
      questions: questions.results ?? [],
      stats: stats.results?.[0] ?? {},
    });
  });

  router.post('/api/admin/exams', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { required: true, max: 200 })!;
    const description = v.string('description', { max: 4000 });
    const instructions = v.string('instructions', { max: 8000 });
    const examKind = v.enum('examKind', EXAM_KINDS, { fallback: 'practice' })!;
    const courseId = v.string('courseId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const subjectId = v.string('subjectId', { max: 64 });
    const chapterId = v.string('chapterId', { max: 64 });
    const testSeriesId = v.string('testSeriesId', { max: 64 });
    const durationMinutes = v.number('durationMinutes', { min: 1, max: 600, integer: true }) ?? 60;
    const negativeMarks = v.number('negativeMarks', { min: 0, max: 100 }) ?? 1;
    const marksPerQuestion = v.number('marksPerQuestion', { min: 0, max: 100 }) ?? 4;
    const negativeMarkingEnabled = v.boolean('negativeMarkingEnabled', true)!;
    const shuffleQuestions = v.boolean('shuffleQuestions', false)!;
    const shuffleOptions = v.boolean('shuffleOptions', false)!;
    const allowSectionNavigation = v.boolean('allowSectionNavigation', true)!;
    const startAt = v.timestamp('startAt');
    const endAt = v.timestamp('endAt');
    const maxAttempts = v.number('maxAttempts', { min: 1, max: 100, integer: true }) ?? 1;
    const resultPublishMode = v.enum('resultPublishMode', ['immediate', 'after_window', 'manual'] as const, { fallback: 'immediate' })!;
    const passingPercentage = v.number('passingPercentage', { min: 0, max: 100 }) ?? 0;
    const isFree = v.boolean('isFree', true)!;
    const status = v.enum('status', ['draft', 'published', 'scheduled', 'archived'] as const, { fallback: 'draft' })!;
    v.throwIfInvalid();

    if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) {
      throw badRequest('The end time must be after the start time.');
    }
    if (status === 'scheduled' && !startAt) throw badRequest('Scheduled examinations need a start time.');

    const id = newId();
    await ctx.env.DB.prepare(
      `INSERT INTO exams (id, test_series_id, title, slug, description, instructions, exam_kind, course_id, exam_type_id,
          subject_id, chapter_id, duration_minutes, marks_per_question, negative_marks, negative_marking_enabled,
          shuffle_questions, shuffle_options, allow_section_navigation, start_at, end_at, max_attempts, result_publish_mode,
          passing_percentage, is_free, status, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?27)`,
    )
      .bind(
        id,
        testSeriesId ?? null,
        title,
        await ensureUniqueSlug(ctx.env.DB, 'exams', 'slug', title),
        description ?? null,
        instructions ?? null,
        examKind,
        courseId ?? null,
        examTypeId ?? null,
        subjectId ?? null,
        chapterId ?? null,
        durationMinutes,
        marksPerQuestion,
        negativeMarks,
        negativeMarkingEnabled ? 1 : 0,
        shuffleQuestions ? 1 : 0,
        shuffleOptions ? 1 : 0,
        allowSectionNavigation ? 1 : 0,
        startAt ?? null,
        endAt ?? null,
        maxAttempts,
        resultPublishMode,
        passingPercentage,
        isFree ? 1 : 0,
        status,
        auth.user.id,
        nowIso(),
      )
      .run();

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'exam.create',
      entityType: 'exam',
      entityId: id,
      after: { title, examKind, status },
    });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/exams/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.manage');
    const id = uuidParam(ctx.params.id);
    const existing = await ctx.env.DB.prepare('SELECT id, title, status FROM exams WHERE id = ?1')
      .bind(id)
      .first<{ id: string; title: string; status: string }>();
    if (!existing) throw notFound('Examination not found.');

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { max: 200 });
    const description = v.string('description', { max: 4000 });
    const instructions = v.string('instructions', { max: 8000 });
    const examKind = v.enum('examKind', EXAM_KINDS);
    const courseId = v.string('courseId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const subjectId = v.string('subjectId', { max: 64 });
    const chapterId = v.string('chapterId', { max: 64 });
    const testSeriesId = v.string('testSeriesId', { max: 64 });
    const durationMinutes = v.number('durationMinutes', { min: 1, max: 600, integer: true });
    const negativeMarks = v.number('negativeMarks', { min: 0, max: 100 });
    const negativeMarkingEnabled = v.boolean('negativeMarkingEnabled');
    const shuffleQuestions = v.boolean('shuffleQuestions');
    const shuffleOptions = v.boolean('shuffleOptions');
    const allowSectionNavigation = v.boolean('allowSectionNavigation');
    const startAt = v.timestamp('startAt');
    const endAt = v.timestamp('endAt');
    const maxAttempts = v.number('maxAttempts', { min: 1, max: 100, integer: true });
    const resultPublishMode = v.enum('resultPublishMode', ['immediate', 'after_window', 'manual'] as const);
    const passingPercentage = v.number('passingPercentage', { min: 0, max: 100 });
    const isFree = v.boolean('isFree');
    const status = v.enum('status', ['draft', 'published', 'scheduled', 'archived'] as const);
    v.throwIfInvalid();

    const fields: Record<string, unknown> = {
      title: title ?? undefined,
      description: description ?? undefined,
      instructions: instructions ?? undefined,
      exam_kind: examKind ?? undefined,
      course_id: courseId ?? undefined,
      exam_type_id: examTypeId ?? undefined,
      subject_id: subjectId ?? undefined,
      chapter_id: chapterId ?? undefined,
      test_series_id: testSeriesId ?? undefined,
      duration_minutes: durationMinutes ?? undefined,
      negative_marks: negativeMarks ?? undefined,
      negative_marking_enabled: negativeMarkingEnabled === undefined ? undefined : negativeMarkingEnabled ? 1 : 0,
      shuffle_questions: shuffleQuestions === undefined ? undefined : shuffleQuestions ? 1 : 0,
      shuffle_options: shuffleOptions === undefined ? undefined : shuffleOptions ? 1 : 0,
      allow_section_navigation: allowSectionNavigation === undefined ? undefined : allowSectionNavigation ? 1 : 0,
      start_at: startAt === undefined ? undefined : startAt,
      end_at: endAt === undefined ? undefined : endAt,
      max_attempts: maxAttempts ?? undefined,
      result_publish_mode: resultPublishMode ?? undefined,
      passing_percentage: passingPercentage ?? undefined,
      is_free: isFree === undefined ? undefined : isFree ? 1 : 0,
      status: status ?? undefined,
      updated_by: auth.user.id,
    };
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    await ctx.env.DB.prepare(`UPDATE exams SET ${keys.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
      .bind(id, ...keys.map((k) => fields[k]))
      .run();

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'exam.update',
      entityType: 'exam',
      entityId: id,
      before: { title: existing.title, status: existing.status },
      after: { title, status },
    });
    return json({ ok: true });
  });

  router.post('/api/admin/exams/:id/publish', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.publish');
    const id = uuidParam(ctx.params.id);
    const body = await readJson(ctx.request);
    const publish = body.publish !== false;

    const exam = await ctx.env.DB.prepare('SELECT id, title, total_questions, start_at, end_at FROM exams WHERE id = ?1')
      .bind(id)
      .first<{ id: string; title: string; total_questions: number; start_at: string | null; end_at: string | null }>();
    if (!exam) throw notFound('Examination not found.');

    if (publish) {
      await recomputeExam(ctx.env, id);
      const fresh = await ctx.env.DB.prepare('SELECT total_questions FROM exams WHERE id = ?1').bind(id).first<{ total_questions: number }>();
      if (Number(fresh?.total_questions ?? 0) === 0) {
        throw conflict('Add at least one question before publishing this examination.');
      }
    }

    await ctx.env.DB.prepare('UPDATE exams SET status = ?2 WHERE id = ?1')
      .bind(id, publish ? (exam.start_at && Date.parse(exam.start_at) > Date.now() ? 'scheduled' : 'published') : 'draft')
      .run();

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: publish ? 'exam.publish' : 'exam.unpublish',
      entityType: 'exam',
      entityId: id,
      after: { title: exam.title },
    });
    return json({ ok: true });
  });

  router.delete('/api/admin/exams/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.manage');
    const id = uuidParam(ctx.params.id);
    const attempts = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM exam_attempts WHERE exam_id = ?1')
      .bind(id)
      .first<{ n: number }>();
    if (Number(attempts?.n ?? 0) > 0) {
      throw conflict('Students have attempted this examination. Archive it instead of deleting.');
    }
    const exam = await ctx.env.DB.prepare('SELECT title FROM exams WHERE id = ?1').bind(id).first<{ title: string }>();
    if (!exam) throw notFound('Examination not found.');
    await ctx.env.DB.prepare('DELETE FROM exams WHERE id = ?1').bind(id).run();
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'exam.delete',
      entityType: 'exam',
      entityId: id,
      before: { title: exam.title },
    });
    return json({ ok: true });
  });

  // ---- Sections ----------------------------------------------------------
  router.post('/api/admin/exams/:id/sections', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.manage');
    const examId = uuidParam(ctx.params.id);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { required: true, max: 120 })!;
    const subjectId = v.string('subjectId', { max: 64 });
    const instructions = v.string('instructions', { max: 2000 });
    const isOptional = v.boolean('isOptional', false)!;
    const maxQuestions = v.number('maxQuestions', { min: 0, max: 500, integer: true });
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true }) ?? 0;
    v.throwIfInvalid();

    const id = newId();
    await ctx.env.DB.prepare(
      `INSERT INTO exam_sections (id, exam_id, title, subject_id, instructions, is_optional, max_questions, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(id, examId, title, subjectId ?? null, instructions ?? null, isOptional ? 1 : 0, maxQuestions ?? null, sortOrder)
      .run();
    await writeAudit(ctx.env, ctx.request, auth, { action: 'exam_section.create', entityType: 'exam', entityId: examId, after: { title } });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/exam-sections/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.manage');
    const id = uuidParam(ctx.params.id);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { max: 120 });
    const instructions = v.string('instructions', { max: 2000 });
    const isOptional = v.boolean('isOptional');
    const maxQuestions = v.number('maxQuestions', { min: 0, max: 500, integer: true });
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true });
    v.throwIfInvalid();
    const fields: Record<string, unknown> = {
      title: title ?? undefined,
      instructions: instructions ?? undefined,
      is_optional: isOptional === undefined ? undefined : isOptional ? 1 : 0,
      max_questions: maxQuestions ?? undefined,
      sort_order: sortOrder ?? undefined,
    };
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (keys.length) {
      await ctx.env.DB.prepare(`UPDATE exam_sections SET ${keys.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
        .bind(id, ...keys.map((k) => fields[k]))
        .run();
    }
    await writeAudit(ctx.env, ctx.request, auth, { action: 'exam_section.update', entityType: 'exam_section', entityId: id });
    return json({ ok: true });
  });

  router.delete('/api/admin/exam-sections/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.manage');
    const id = uuidParam(ctx.params.id);
    await ctx.env.DB.prepare('UPDATE exam_questions SET section_id = NULL WHERE section_id = ?1').bind(id).run();
    await ctx.env.DB.prepare('DELETE FROM exam_sections WHERE id = ?1').bind(id).run();
    await writeAudit(ctx.env, ctx.request, auth, { action: 'exam_section.delete', entityType: 'exam_section', entityId: id });
    return json({ ok: true });
  });

  // ---- Attach questions ---------------------------------------------------
  router.post('/api/admin/exams/:id/questions', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.manage');
    const examId = uuidParam(ctx.params.id);
    const body = await readJson(ctx.request);
    const questionIdsRaw = Array.isArray(body.questionIds) ? body.questionIds : body.questionId ? [body.questionId] : [];
    const sectionId = typeof body.sectionId === 'string' && UUID_RE.test(body.sectionId) ? body.sectionId : null;

    const ids = questionIdsRaw.filter((i): i is string => typeof i === 'string' && UUID_RE.test(i));
    if (!ids.length) throw badRequest('Provide at least one valid questionId.');

    // Fetch defaults from the questions and assign sequential sort orders.
    const placeholders = ids.map((_, i) => `?${i + 2}`).join(',');
    const questions = await ctx.env.DB.prepare(
      `SELECT q.id, q.marks, q.negative_marks AS negativeMarks FROM questions q
        WHERE q.id IN (${placeholders}) AND q.status != 'archived'`,
    )
      .bind(examId, ...ids)
      .all<{ id: string; marks: number; negativeMarks: number }>();

    const found = questions.results ?? [];
    if (!found.length) throw badRequest('None of the supplied questions could be found.');

    const maxOrderRow = await ctx.env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM exam_questions WHERE exam_id = ?1')
      .bind(examId)
      .first<{ maxOrder: number }>();
    let order = Number(maxOrderRow?.maxOrder ?? -1) + 1;

    let added = 0;
    let skipped = 0;
    for (const q of found) {
      const existing = await ctx.env.DB.prepare('SELECT id FROM exam_questions WHERE exam_id = ?1 AND question_id = ?2')
        .bind(examId, q.id)
        .first<{ id: string }>();
      if (existing) {
        skipped++;
        continue;
      }
      await ctx.env.DB.prepare(
        `INSERT INTO exam_questions (id, exam_id, section_id, question_id, marks, negative_marks, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
        .bind(newId(), examId, sectionId, q.id, Number(q.marks ?? 4), Number(q.negativeMarks ?? 1), order++)
        .run();
      added++;
    }

    await recomputeExam(ctx.env, examId);
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'exam.questions_added',
      entityType: 'exam',
      entityId: examId,
      meta: { added, skipped },
    });
    return json({ added, skipped });
  });

  router.put('/api/admin/exam-questions/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.manage');
    const id = uuidParam(ctx.params.id);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const marks = v.number('marks', { min: 0, max: 100 });
    const negativeMarks = v.number('negativeMarks', { min: 0, max: 100 });
    const sortOrder = v.number('sortOrder', { min: 0, max: 10000, integer: true });
    const sectionId = v.string('sectionId', { max: 64 });
    v.throwIfInvalid();

    const existing = await ctx.env.DB.prepare('SELECT exam_id FROM exam_questions WHERE id = ?1')
      .bind(id)
      .first<{ exam_id: string }>();
    if (!existing) throw notFound('Exam question not found.');

    const fields: Record<string, unknown> = {
      marks: marks ?? undefined,
      negative_marks: negativeMarks ?? undefined,
      sort_order: sortOrder ?? undefined,
      section_id: sectionId === undefined ? undefined : sectionId || null,
    };
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (keys.length) {
      await ctx.env.DB.prepare(`UPDATE exam_questions SET ${keys.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
        .bind(id, ...keys.map((k) => fields[k]))
        .run();
    }
    await recomputeExam(ctx.env, existing.exam_id);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'exam_question.update', entityType: 'exam_question', entityId: id });
    return json({ ok: true });
  });

  router.delete('/api/admin/exams/:examId/questions/:questionId', async (ctx) => {
    const auth = await requirePermission(ctx, 'exams.manage');
    const examId = uuidParam(ctx.params.examId);
    const questionId = uuidParam(ctx.params.questionId);
    await ctx.env.DB.prepare('DELETE FROM exam_questions WHERE exam_id = ?1 AND question_id = ?2').bind(examId, questionId).run();
    await recomputeExam(ctx.env, examId);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'exam.question_removed',
      entityType: 'exam',
      entityId: examId,
      meta: { questionId },
    });
    return json({ ok: true });
  });

  // ===================== ATTEMPTS + RESULTS ==============================
  router.get('/api/admin/results', async (ctx) => {
    await requirePermission(ctx, 'results.view');
    const page = parsePage(ctx.url, { pageSize: 25, maxPageSize: 200 });
    const examId = ctx.url.searchParams.get('examId');
    const published = ctx.url.searchParams.get('published');
    const q = (ctx.url.searchParams.get('q') ?? '').trim();

    const where: string[] = [];
    const binds: unknown[] = [];
    if (examId) {
      binds.push(examId);
      where.push(`r.exam_id = ?${binds.length}`);
    }
    if (published === 'true' || published === 'false') {
      binds.push(published === 'true' ? 1 : 0);
      where.push(`r.is_published = ?${binds.length}`);
    }
    if (q) {
      binds.push(`%${q}%`);
      where.push(`(u.email LIKE ?${binds.length} OR e.title LIKE ?${binds.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM results r JOIN exams e ON e.id = r.exam_id JOIN users u ON u.id = r.user_id ${whereSql}`)
        .bind(...binds)
        .first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT r.id, r.attempt_id AS attemptId, r.exam_id AS examId, e.title AS examTitle, u.email AS studentEmail,
                u.display_name AS studentName, r.score, r.max_score AS maxScore, r.percentage, r.accuracy,
                r.correct_count AS correctCount, r.wrong_count AS wrongCount, r.rank, r.percentile,
                r.passed, r.is_published AS isPublished, r.computed_at AS computedAt
           FROM results r
           JOIN exams e ON e.id = r.exam_id
           JOIN users u ON u.id = r.user_id
           ${whereSql}
          ORDER BY r.computed_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    return json(
      paginated(
        (rows.results ?? []).map((r) => ({ ...r, passed: Boolean(r.passed), isPublished: Boolean(r.isPublished) })),
        Number(count?.n ?? 0),
        page,
      ),
    );
  });

  router.post('/api/admin/results/publish', async (ctx) => {
    const auth = await requirePermission(ctx, 'results.publish');
    const body = await readJson(ctx.request);
    const examId = typeof body.examId === 'string' && UUID_RE.test(body.examId) ? body.examId : null;
    const resultIds = Array.isArray(body.resultIds) ? body.resultIds.filter((i): i is string => typeof i === 'string' && UUID_RE.test(i)) : [];
    const publish = body.publish !== false;

    if (!examId && !resultIds.length) throw badRequest('Provide examId or resultIds.');

    let updated = 0;
    if (examId) {
      const res = await ctx.env.DB.prepare(
        'UPDATE results SET is_published = ?2, published_at = CASE WHEN ?2 = 1 THEN COALESCE(published_at, ?3) ELSE NULL END WHERE exam_id = ?1',
      )
        .bind(examId, publish ? 1 : 0, nowIso())
        .run();
      updated = res.meta?.changes ?? 0;
      await ctx.env.DB.prepare(
        'UPDATE exams SET result_publish_mode = ?2 WHERE id = ?1',
      ).bind(examId, publish ? 'immediate' : 'manual').run();
    } else if (resultIds.length) {
      const placeholders = resultIds.map((_, i) => `?${i + 2}`).join(',');
      const res = await ctx.env.DB.prepare(
        `UPDATE results SET is_published = ?1, published_at = CASE WHEN ?1 = 1 THEN COALESCE(published_at, ?${resultIds.length + 2}) ELSE NULL END WHERE id IN (${placeholders})`,
      )
        .bind(publish ? 1 : 0, ...resultIds, nowIso())
        .run();
      updated = res.meta?.changes ?? 0;
    }

    await writeAudit(ctx.env, ctx.request, auth, {
      action: publish ? 'results.publish' : 'results.unpublish',
      entityType: 'result',
      entityId: examId,
      meta: { updated, resultIds: resultIds.slice(0, 50) },
    });
    return json({ ok: true, updated });
  });

  // Force-submit an in-progress attempt (support scenario).
  router.post('/api/admin/attempts/:id/submit', async (ctx) => {
    const auth = await requirePermission(ctx, 'results.view');
    const attemptId = uuidParam(ctx.params.id);
    const outcome = await submitAttempt(ctx.env, attemptId, { channel: 'admin' });
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'attempt.force_submit',
      entityType: 'exam_attempt',
      entityId: attemptId,
      meta: outcome,
    });
    return json(outcome);
  });

  router.get('/api/admin/attempts', async (ctx) => {
    await requirePermission(ctx, 'results.view');
    const page = parsePage(ctx.url, { pageSize: 25 });
    const status = ctx.url.searchParams.get('status');
    const examId = ctx.url.searchParams.get('examId');
    const binds: unknown[] = [];
    const where: string[] = [];
    if (status) {
      binds.push(status);
      where.push(`a.status = ?${binds.length}`);
    }
    if (examId) {
      binds.push(examId);
      where.push(`a.exam_id = ?${binds.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows, count] = await Promise.all([
      ctx.env.DB.prepare(
        `SELECT a.id, a.exam_id AS examId, e.title AS examTitle, u.email AS studentEmail, a.status, a.started_at AS startedAt,
                a.submitted_at AS submittedAt, a.score, a.percentage, a.expires_at_ms AS expiresAtMs,
                a.time_spent_seconds AS timeSpentSeconds, a.answered_count AS answeredCount,
                a.total_questions AS totalQuestions, a.submit_channel AS submitChannel
           FROM exam_attempts a JOIN exams e ON e.id = a.exam_id JOIN users u ON u.id = a.user_id
           ${whereSql} ORDER BY a.created_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM exam_attempts a ${whereSql}`)
        .bind(...binds)
        .first<{ n: number }>(),
    ]);
    return json(paginated(rows.results ?? [], Number(count?.n ?? 0), page));
  });

  router.get('/api/admin/results/export', async (ctx) => {
    const auth = await requirePermission(ctx, 'results.export');
    const examId = ctx.url.searchParams.get('examId');
    const rows = examId
      ? await ctx.env.DB.prepare(
          `SELECT u.email, e.title AS exam, r.score, r.max_score, r.percentage, r.correct_count, r.wrong_count,
                  r.unattempted_count, r.accuracy, r.rank, r.percentile, r.computed_at
             FROM results r JOIN users u ON u.id = r.user_id JOIN exams e ON e.id = r.exam_id
            WHERE r.exam_id = ?1 ORDER BY r.score DESC LIMIT 5000`,
        )
          .bind(examId)
          .all<Record<string, unknown>>()
      : await ctx.env.DB.prepare(
          `SELECT u.email, e.title AS exam, r.score, r.max_score, r.percentage, r.correct_count, r.wrong_count,
                  r.unattempted_count, r.accuracy, r.rank, r.percentile, r.computed_at
             FROM results r JOIN users u ON u.id = r.user_id JOIN exams e ON e.id = r.exam_id
            ORDER BY r.computed_at DESC LIMIT 5000`,
        ).all<Record<string, unknown>>();

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'results.export',
      entityType: 'result',
      meta: { examId, count: rows.results?.length ?? 0 },
    });
    return new Response(toCsv(rows.results ?? []), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="prepsetu-results-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
