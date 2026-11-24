// =============================================================================
// Admin: courses, classes, exam types, subjects, chapters (full CRUD)
// =============================================================================

import type { RouteCtx } from '../../env';
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
import { likePattern, newId, nowIso, parseJson } from '../../lib/util';
import { uniqueSlug } from '../../lib/slug';

type Entity = 'classes' | 'exam_types' | 'courses' | 'subjects' | 'chapters';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function tableFor(entity: Entity, env: { DB: D1Database }) {
  const meta = await env.DB.prepare(`PRAGMA table_info(${entity})`).all<{ name: string }>();
  return new Set((meta.results ?? []).map((r) => r.name));
}

async function insertRow(ctx: RouteCtx, table: string, values: Record<string, unknown>): Promise<string> {
  const id = newId();
  const keys = ['id', ...Object.keys(values).filter((k) => values[k] !== undefined)];
  const placeholders = keys.map((_, i) => `?${i + 1}`).join(', ');
  await ctx.env.DB.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`)
    .bind(id, ...Object.keys(values).filter((k) => values[k] !== undefined).map((k) => values[k]))
    .run();
  return id;
}

async function updateRow(ctx: RouteCtx, table: string, id: string, values: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  if (!keys.length) return;
  const setSql = keys.map((k, i) => `${k} = ?${i + 2}`).join(', ');
  await ctx.env.DB.prepare(`UPDATE ${table} SET ${setSql} WHERE id = ?1`)
    .bind(id, ...keys.map((k) => values[k]))
    .run();
}

function requireUuidParam(ctx: RouteCtx, name = 'id'): string {
  const value = ctx.params[name];
  if (!value || !UUID_RE.test(value)) throw badRequest('Invalid identifier.');
  return value;
}

// ---- generic taxonomy CRUD helper -----------------------------------------

async function listTaxonomy(ctx: RouteCtx, entity: Entity, extraWhere: string[], binds: unknown[], select: string) {
  const auth = ctx.auth;
  const page = parsePage(ctx.url, { pageSize: 50, maxPageSize: 200 });
  const q = (ctx.url.searchParams.get('q') ?? '').trim();
  const where = [...extraWhere];
  const allBinds = [...binds];
  if (q) {
    allBinds.push(likePattern(q));
    where.push(`${entity}.name LIKE ?${allBinds.length} ESCAPE '\\'`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [count, rows] = await Promise.all([
    ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${entity} ${whereSql}`).bind(...allBinds).first<{ n: number }>(),
    ctx.env.DB.prepare(
      `${select} ${whereSql} ORDER BY ${entity}.sort_order ASC, ${entity}.created_at DESC LIMIT ?${allBinds.length + 1} OFFSET ?${allBinds.length + 2}`,
    )
      .bind(...allBinds, page.pageSize, page.offset)
      .all<Record<string, unknown>>(),
  ]);
  return { items: rows.results ?? [], total: Number(count?.n ?? 0), page, auth };
}

export function registerAdminCourseRoutes(router: Router): void {
  // ===================== CLASSES ==========================================
  router.get('/api/admin/classes', async (ctx) => {
    await requirePermission(ctx, 'courses.view');
    const { items, total, page } = await listTaxonomy(
      ctx,
      'classes',
      [],
      [],
      `SELECT classes.*, (SELECT COUNT(*) FROM courses c WHERE c.class_id = classes.id) AS courseCount FROM classes`,
    );
    return json(paginated(items, total, page));
  });

  router.post('/api/admin/classes', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const name = v.string('name', { required: true, max: 80 })!;
    const level = v.number('level', { min: 0, max: 20, integer: true }) ?? 0;
    const description = v.string('description', { max: 500 });
    const color = v.string('color', { max: 20 });
    const icon = v.string('icon', { max: 40 });
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true }) ?? 0;
    v.throwIfInvalid();

    const id = await insertRow(ctx, 'classes', {
      name,
      slug: uniqueSlug(name),
      level,
      description: description ?? null,
      color: color ?? null,
      icon: icon ?? null,
      sort_order: sortOrder,
      is_active: 1,
    });
    invalidateAsync(ctx, ['catalogue:']);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'class.create', entityType: 'class', entityId: id, after: { name } });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/classes/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const name = v.string('name', { max: 80 });
    const level = v.number('level', { min: 0, max: 20, integer: true });
    const description = v.string('description', { max: 500 });
    const color = v.string('color', { max: 20 });
    const isActive = v.boolean('isActive');
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true });
    v.throwIfInvalid();

    if (!(await ctx.env.DB.prepare('SELECT id FROM classes WHERE id = ?1').bind(id).first())) throw notFound('Class not found.');
    await updateRow(ctx, 'classes', id, {
      name: name ?? undefined,
      level: level ?? undefined,
      description: description ?? undefined,
      color: color ?? undefined,
      is_active: isActive === undefined ? undefined : isActive ? 1 : 0,
      sort_order: sortOrder ?? undefined,
    });
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'class.update', entityType: 'class', entityId: id, after: body });
    return json({ ok: true });
  });

  router.delete('/api/admin/classes/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const existing = await ctx.env.DB.prepare('SELECT id FROM classes WHERE id = ?1').bind(id).first();
    if (!existing) throw notFound('Class not found.');
    const usage = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM courses WHERE class_id = ?1').bind(id).first<{ n: number }>();
    if (Number(usage?.n ?? 0) > 0) throw conflict('This class is used by existing courses. Deactivate it instead of deleting.');
    await ctx.env.DB.prepare('DELETE FROM classes WHERE id = ?1').bind(id).run();
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'class.delete', entityType: 'class', entityId: id });
    return json({ ok: true });
  });

  // ===================== EXAM TYPES =======================================
  router.get('/api/admin/exam-types', async (ctx) => {
    await requirePermission(ctx, 'courses.view');
    const { items, total, page } = await listTaxonomy(
      ctx,
      'exam_types',
      [],
      [],
      `SELECT exam_types.*, (SELECT COUNT(*) FROM courses c WHERE c.exam_type_id = exam_types.id) AS courseCount FROM exam_types`,
    );
    return json(paginated(items, total, page));
  });

  router.post('/api/admin/exam-types', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const name = v.string('name', { required: true, max: 80 })!;
    const shortName = v.string('shortName', { max: 30 });
    const description = v.string('description', { max: 500 });
    const color = v.string('color', { max: 20 });
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true }) ?? 0;
    v.throwIfInvalid();

    const id = await insertRow(ctx, 'exam_types', {
      name,
      slug: uniqueSlug(name),
      short_name: shortName ?? null,
      description: description ?? null,
      color: color ?? null,
      sort_order: sortOrder,
      is_active: 1,
    });
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'exam_type.create', entityType: 'exam_type', entityId: id, after: { name } });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/exam-types/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const name = v.string('name', { max: 80 });
    const shortName = v.string('shortName', { max: 30 });
    const description = v.string('description', { max: 500 });
    const color = v.string('color', { max: 20 });
    const isActive = v.boolean('isActive');
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true });
    v.throwIfInvalid();
    if (!(await ctx.env.DB.prepare('SELECT id FROM exam_types WHERE id = ?1').bind(id).first())) throw notFound('Exam type not found.');
    await updateRow(ctx, 'exam_types', id, {
      name: name ?? undefined,
      short_name: shortName ?? undefined,
      description: description ?? undefined,
      color: color ?? undefined,
      is_active: isActive === undefined ? undefined : isActive ? 1 : 0,
      sort_order: sortOrder ?? undefined,
    });
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'exam_type.update', entityType: 'exam_type', entityId: id, after: body });
    return json({ ok: true });
  });

  router.delete('/api/admin/exam-types/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const existing = await ctx.env.DB.prepare('SELECT id FROM exam_types WHERE id = ?1').bind(id).first();
    if (!existing) throw notFound('Examination type not found.');
    const usage = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM courses WHERE exam_type_id = ?1').bind(id).first<{ n: number }>();
    if (Number(usage?.n ?? 0) > 0) throw conflict('This exam type is used by existing courses. Deactivate it instead of deleting.');
    await ctx.env.DB.prepare('DELETE FROM exam_types WHERE id = ?1').bind(id).run();
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'exam_type.delete', entityType: 'exam_type', entityId: id });
    return json({ ok: true });
  });

  // ===================== COURSES ==========================================
  router.get('/api/admin/courses', async (ctx) => {
    await requirePermission(ctx, 'courses.view');
    const page = parsePage(ctx.url, { pageSize: 25, maxPageSize: 100 });
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const status = ctx.url.searchParams.get('status');
    const classId = ctx.url.searchParams.get('classId');
    const examTypeId = ctx.url.searchParams.get('examTypeId');

    const where: string[] = [];
    const binds: unknown[] = [];
    if (q) {
      binds.push(likePattern(q));
      where.push(`c.name LIKE ?${binds.length} ESCAPE '\\'`);
    }
    if (status && ['draft', 'published', 'archived'].includes(status)) {
      binds.push(status);
      where.push(`c.status = ?${binds.length}`);
    }
    if (classId) {
      binds.push(classId);
      where.push(`c.class_id = ?${binds.length}`);
    }
    if (examTypeId) {
      binds.push(examTypeId);
      where.push(`c.exam_type_id = ?${binds.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM courses c ${whereSql}`).bind(...binds).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT c.id, c.name, c.slug, c.description, c.short_description AS shortDescription,
                c.cover_image_url AS coverImageUrl, c.class_id AS classId, c.exam_type_id AS examTypeId,
                c.is_free AS isFree, c.is_featured AS isFeatured, c.status, c.visibility, c.sort_order AS sortOrder,
                c.price_inr AS priceInr, c.tags, c.created_at AS createdAt, c.updated_at AS updatedAt,
                cl.name AS className, et.name AS examTypeName,
                (SELECT COUNT(*) FROM subjects s WHERE s.course_id = c.id) AS subjectCount,
                (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id) AS lectureCount,
                (SELECT COUNT(*) FROM exams e WHERE e.course_id = c.id) AS examCount
           FROM courses c
           LEFT JOIN classes cl ON cl.id = c.class_id
           LEFT JOIN exam_types et ON et.id = c.exam_type_id
           ${whereSql}
          ORDER BY c.sort_order ASC, c.created_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    return json(
      paginated(
        (rows.results ?? []).map((r) => ({ ...r, isFree: Boolean(r.isFree), isFeatured: Boolean(r.isFeatured) })),
        Number(count?.n ?? 0),
        page,
      ),
    );
  });

  router.post('/api/admin/courses', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const name = v.string('name', { required: true, max: 120 })!;
    const description = v.string('description', { max: 4000 });
    const shortDescription = v.string('shortDescription', { max: 300 });
    const coverImageUrl = v.string('coverImageUrl', { max: 512 });
    const classId = v.string('classId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const status = v.enum('status', ['draft', 'published', 'archived'] as const, { fallback: 'draft' })!;
    const visibility = v.enum('visibility', ['public', 'restricted'] as const, { fallback: 'public' })!;
    const isFree = v.boolean('isFree', true)!;
    const isFeatured = v.boolean('isFeatured', false)!;
    const priceInr = v.number('priceInr', { min: 0, max: 1000000, integer: true }) ?? 0;
    const tagsRaw = body.tags;
    const sortOrder = v.number('sortOrder', { min: 0, max: 10000, integer: true }) ?? 0;
    v.throwIfInvalid();

    if (coverImageUrl && !/^https?:\/\//.test(coverImageUrl)) throw badRequest('Cover image must be an absolute URL.');
    const tags = Array.isArray(tagsRaw) ? tagsRaw.map(String).join(',') : typeof tagsRaw === 'string' ? tagsRaw : null;

    const id = await insertRow(ctx, 'courses', {
      name,
      slug: uniqueSlug(name),
      description: description ?? null,
      short_description: shortDescription ?? null,
      cover_image_url: coverImageUrl ?? null,
      class_id: classId ?? null,
      exam_type_id: examTypeId ?? null,
      tags,
      is_free: isFree ? 1 : 0,
      is_featured: isFeatured ? 1 : 0,
      price_inr: priceInr,
      status,
      visibility,
      sort_order: sortOrder,
      created_by: auth.user.id,
    });
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'course.create',
      entityType: 'course',
      entityId: id,
      after: { name, status },
    });
    return json({ id }, { status: 201 });
  });

  router.get('/api/admin/courses/:id', async (ctx) => {
    await requirePermission(ctx, 'courses.view');
    const id = requireUuidParam(ctx);
    const course = await ctx.env.DB.prepare('SELECT * FROM courses WHERE id = ?1').bind(id).first<Record<string, unknown>>();
    if (!course) throw notFound('Course not found.');

    const [subjects, series] = await ctx.env.DB.batch<Record<string, unknown>>([
      ctx.env.DB.prepare(
        `SELECT s.id, s.name, s.slug, s.color, s.icon, s.sort_order AS sortOrder, s.is_active AS isActive,
                (SELECT COUNT(*) FROM chapters ch WHERE ch.subject_id = s.id) AS chapterCount,
                (SELECT COUNT(*) FROM lectures l WHERE l.subject_id = s.id AND l.status = 'published') AS lectureCount
           FROM subjects s WHERE s.course_id = ?1 ORDER BY s.sort_order ASC`,
      ).bind(id),
      ctx.env.DB.prepare(
        `SELECT id, title, lecture_count AS lectureCount, status FROM lecture_series WHERE course_id = ?1 ORDER BY sort_order ASC`,
      ).bind(id),
    ]);

    return json({
      course: { ...course, isFree: Boolean(course.is_free), isFeatured: Boolean(course.is_featured) },
      subjects: subjects.results ?? [],
      series: series.results ?? [],
    });
  });

  router.put('/api/admin/courses/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const body = await readJson(ctx.request);
    const existing = await ctx.env.DB.prepare('SELECT id, name, status FROM courses WHERE id = ?1')
      .bind(id)
      .first<{ id: string; name: string; status: string }>();
    if (!existing) throw notFound('Course not found.');

    const v = new Validator(body);
    const name = v.string('name', { max: 120 });
    const description = v.string('description', { max: 4000 });
    const shortDescription = v.string('shortDescription', { max: 300 });
    const coverImageUrl = v.string('coverImageUrl', { max: 512 });
    const classId = v.string('classId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const status = v.enum('status', ['draft', 'published', 'archived'] as const);
    const visibility = v.enum('visibility', ['public', 'restricted'] as const);
    const isFree = v.boolean('isFree');
    const isFeatured = v.boolean('isFeatured');
    const priceInr = v.number('priceInr', { min: 0, max: 1000000, integer: true });
    const sortOrder = v.number('sortOrder', { min: 0, max: 10000, integer: true });
    const tagsRaw = body.tags;
    v.throwIfInvalid();

    const tags = Array.isArray(tagsRaw) ? tagsRaw.map(String).join(',') : typeof tagsRaw === 'string' ? tagsRaw : undefined;

    await updateRow(ctx, 'courses', id, {
      name: name ?? undefined,
      description: description ?? undefined,
      short_description: shortDescription ?? undefined,
      cover_image_url: coverImageUrl ?? undefined,
      class_id: classId ?? undefined,
      exam_type_id: examTypeId ?? undefined,
      tags,
      status: status ?? undefined,
      visibility: visibility ?? undefined,
      is_free: isFree === undefined ? undefined : isFree ? 1 : 0,
      is_featured: isFeatured === undefined ? undefined : isFeatured ? 1 : 0,
      price_inr: priceInr ?? undefined,
      sort_order: sortOrder ?? undefined,
      updated_by: auth.user.id,
    });

    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'course.update',
      entityType: 'course',
      entityId: id,
      before: { name: existing.name, status: existing.status },
      after: { name, status },
    });

    // Publishing a course makes its lectures/exams visible through the
    // catalogue immediately (cached responses were invalidated above).
    return json({ ok: true });
  });

  router.delete('/api/admin/courses/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const usage = await ctx.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM lectures WHERE course_id = ?1) AS lectures,
         (SELECT COUNT(*) FROM exams WHERE course_id = ?1) AS exams,
         (SELECT COUNT(*) FROM exam_attempts a JOIN exams e ON e.id = a.exam_id WHERE e.course_id = ?1) AS attempts`,
    )
      .bind(id)
      .first<{ lectures: number; exams: number; attempts: number }>();
    if (Number(usage?.attempts ?? 0) > 0) {
      throw conflict('Students have attempted examinations in this course. Archive it instead of deleting.');
    }
    if (Number(usage?.lectures ?? 0) > 0 || Number(usage?.exams ?? 0) > 0) {
      throw conflict('This course still contains lectures or examinations. Archive it instead of deleting.');
    }
    await ctx.env.DB.prepare('DELETE FROM courses WHERE id = ?1').bind(id).run();
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'course.delete', entityType: 'course', entityId: id, status: 'success' });
    return json({ ok: true });
  });

  // ===================== SUBJECTS =========================================
  router.get('/api/admin/subjects', async (ctx) => {
    await requirePermission(ctx, 'courses.view');
    const courseId = ctx.url.searchParams.get('courseId');
    const page = parsePage(ctx.url, { pageSize: 100 });
    const where = courseId ? 'WHERE s.course_id = ?1' : '';
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM subjects s ${where}`)
        .bind(...(courseId ? [courseId] : []))
        .first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT s.*, c.name AS courseName,
                (SELECT COUNT(*) FROM chapters ch WHERE ch.subject_id = s.id) AS chapterCount
           FROM subjects s LEFT JOIN courses c ON c.id = s.course_id
           ${where} ORDER BY s.sort_order ASC, s.name ASC LIMIT ?${courseId ? 2 : 1} OFFSET ?${courseId ? 3 : 2}`,
      )
        .bind(...(courseId ? [courseId, page.pageSize, page.offset] : [page.pageSize, page.offset]))
        .all<Record<string, unknown>>(),
    ]);
    return json(paginated(rows.results ?? [], Number(count?.n ?? 0), page));
  });

  router.post('/api/admin/subjects', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const courseId = v.string('courseId', { required: true, max: 64 })!;
    const name = v.string('name', { required: true, max: 80 })!;
    const color = v.string('color', { max: 20 });
    const icon = v.string('icon', { max: 40 });
    const description = v.string('description', { max: 500 });
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true }) ?? 0;
    v.throwIfInvalid();

    const course = await ctx.env.DB.prepare('SELECT id FROM courses WHERE id = ?1').bind(courseId).first();
    if (!course) throw notFound('Course not found.');

    const dup = await ctx.env.DB.prepare('SELECT id FROM subjects WHERE course_id = ?1 AND lower(name) = lower(?2)')
      .bind(courseId, name)
      .first();
    if (dup) throw conflict('That subject already exists in this course.');

    const id = await insertRow(ctx, 'subjects', {
      course_id: courseId,
      name,
      slug: uniqueSlug(name),
      color: color ?? null,
      icon: icon ?? null,
      description: description ?? null,
      sort_order: sortOrder,
      is_active: 1,
    });
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'subject.create', entityType: 'subject', entityId: id, after: { name, courseId } });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/subjects/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const name = v.string('name', { max: 80 });
    const color = v.string('color', { max: 20 });
    const icon = v.string('icon', { max: 40 });
    const description = v.string('description', { max: 500 });
    const isActive = v.boolean('isActive');
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true });
    v.throwIfInvalid();
    if (!(await ctx.env.DB.prepare('SELECT id FROM subjects WHERE id = ?1').bind(id).first())) throw notFound('Subject not found.');
    await updateRow(ctx, 'subjects', id, {
      name: name ?? undefined,
      color: color ?? undefined,
      icon: icon ?? undefined,
      description: description ?? undefined,
      is_active: isActive === undefined ? undefined : isActive ? 1 : 0,
      sort_order: sortOrder ?? undefined,
    });
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'subject.update', entityType: 'subject', entityId: id, after: body });
    return json({ ok: true });
  });

  router.delete('/api/admin/subjects/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const usage = await ctx.env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM chapters WHERE subject_id = ?1) AS chapters, (SELECT COUNT(*) FROM questions WHERE subject_id = ?1) AS questions',
    )
      .bind(id)
      .first<{ chapters: number; questions: number }>();
    if (Number(usage?.chapters ?? 0) > 0 || Number(usage?.questions ?? 0) > 0) {
      throw conflict('This subject still has chapters or questions. Deactivate it instead of deleting.');
    }
    await ctx.env.DB.prepare('DELETE FROM subjects WHERE id = ?1').bind(id).run();
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'subject.delete', entityType: 'subject', entityId: id });
    return json({ ok: true });
  });

  // ===================== CHAPTERS =========================================
  router.get('/api/admin/chapters', async (ctx) => {
    await requirePermission(ctx, 'courses.view');
    const subjectId = ctx.url.searchParams.get('subjectId');
    const courseId = ctx.url.searchParams.get('courseId');
    const binds: unknown[] = [];
    const where: string[] = [];
    if (subjectId) {
      binds.push(subjectId);
      where.push(`ch.subject_id = ?${binds.length}`);
    }
    if (courseId) {
      binds.push(courseId);
      where.push(`ch.course_id = ?${binds.length}`);
    }
    const page = parsePage(ctx.url, { pageSize: 200, maxPageSize: 500 });
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM chapters ch ${whereSql}`).bind(...binds).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT ch.*, s.name AS subjectName, c.name AS courseName,
                (SELECT COUNT(*) FROM lectures l WHERE l.chapter_id = ch.id) AS lectureCount,
                (SELECT COUNT(*) FROM questions q WHERE q.chapter_id = ch.id) AS questionCount
           FROM chapters ch
           LEFT JOIN subjects s ON s.id = ch.subject_id
           LEFT JOIN courses c ON c.id = ch.course_id
          ${whereSql}
          ORDER BY ch.sort_order ASC, ch.name ASC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);
    return json(paginated(rows.results ?? [], Number(count?.n ?? 0), page));
  });

  router.post('/api/admin/chapters', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const subjectId = v.string('subjectId', { required: true, max: 64 })!;
    const name = v.string('name', { required: true, max: 120 })!;
    const description = v.string('description', { max: 1000 });
    const weightage = v.number('weightage', { min: 0, max: 10000, integer: true });
    const estimatedMinutes = v.number('estimatedMinutes', { min: 0, max: 100000, integer: true });
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true }) ?? 0;
    v.throwIfInvalid();

    const subject = await ctx.env.DB.prepare('SELECT id, course_id FROM subjects WHERE id = ?1')
      .bind(subjectId)
      .first<{ id: string; course_id: string }>();
    if (!subject) throw notFound('Subject not found.');

    const dup = await ctx.env.DB.prepare('SELECT id FROM chapters WHERE subject_id = ?1 AND lower(name) = lower(?2)')
      .bind(subjectId, name)
      .first();
    if (dup) throw conflict('That chapter already exists in this subject.');

    const id = await insertRow(ctx, 'chapters', {
      subject_id: subjectId,
      course_id: subject.course_id,
      name,
      slug: uniqueSlug(name),
      description: description ?? null,
      weightage: weightage ?? null,
      estimated_minutes: estimatedMinutes ?? null,
      sort_order: sortOrder,
      is_active: 1,
    });
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'chapter.create', entityType: 'chapter', entityId: id, after: { name } });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/chapters/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const name = v.string('name', { max: 120 });
    const description = v.string('description', { max: 1000 });
    const weightage = v.number('weightage', { min: 0, max: 10000, integer: true });
    const estimatedMinutes = v.number('estimatedMinutes', { min: 0, max: 100000, integer: true });
    const isActive = v.boolean('isActive');
    const sortOrder = v.number('sortOrder', { min: 0, max: 1000, integer: true });
    v.throwIfInvalid();
    if (!(await ctx.env.DB.prepare('SELECT id FROM chapters WHERE id = ?1').bind(id).first())) throw notFound('Chapter not found.');
    await updateRow(ctx, 'chapters', id, {
      name: name ?? undefined,
      description: description ?? undefined,
      weightage: weightage ?? undefined,
      estimated_minutes: estimatedMinutes ?? undefined,
      is_active: isActive === undefined ? undefined : isActive ? 1 : 0,
      sort_order: sortOrder ?? undefined,
    });
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'chapter.update', entityType: 'chapter', entityId: id, after: body });
    return json({ ok: true });
  });

  router.delete('/api/admin/chapters/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const id = requireUuidParam(ctx);
    const usage = await ctx.env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM lectures WHERE chapter_id = ?1) AS lectures, (SELECT COUNT(*) FROM questions WHERE chapter_id = ?1) AS questions',
    )
      .bind(id)
      .first<{ lectures: number; questions: number }>();
    if (Number(usage?.lectures ?? 0) > 0 || Number(usage?.questions ?? 0) > 0) {
      throw conflict('This chapter still has lectures or questions. Deactivate it instead of deleting.');
    }
    await ctx.env.DB.prepare('DELETE FROM chapters WHERE id = ?1').bind(id).run();
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, { action: 'chapter.delete', entityType: 'chapter', entityId: id });
    return json({ ok: true });
  });

  // ===================== Reorder (drag & drop) ============================
  router.post('/api/admin/reorder', async (ctx) => {
    const auth = await requirePermission(ctx, 'courses.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const entity = v.enum('entity', ['courses', 'subjects', 'chapters', 'lectures', 'lecture_series', 'classes', 'exam_types'] as const, {
      required: true,
    })!;
    const items = v.array('items', { maxItems: 500 });
    v.throwIfInvalid();
    if (!items?.length) throw badRequest('items array is required.');

    const statements: D1PreparedStatement[] = [];
    for (const raw of items) {
      const item = raw as { id?: unknown; sortOrder?: unknown };
      const id = String(item.id ?? '');
      if (!UUID_RE.test(id)) continue;
      statements.push(
        ctx.env.DB.prepare(`UPDATE ${entity} SET sort_order = ?2 WHERE id = ?1`).bind(
          id,
          Math.max(0, Math.min(100000, Number(item.sortOrder ?? 0) || 0)),
        ),
      );
    }
    if (statements.length) await ctx.env.DB.batch(statements);
    invalidateAsync(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: `${entity}.reorder`,
      entityType: entity,
      meta: { count: statements.length },
    });
    return json({ ok: true, updated: statements.length });
  });
}
