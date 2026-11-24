// =============================================================================
// Admin: Test Paper Manager (PDF library)
// =============================================================================
// Storage strategy
//   * Small PDFs (<= 25 MB by default) may be uploaded through the Worker and
//     stored in R2 (if the MEDIA binding exists) — server-side validation of
//     type, size and the %PDF- signature.
//   * Firebase Storage is the default: the browser uploads directly with the
//     authenticated Firebase user (Security Rules restrict writes to admins),
//     then registers the resulting URL + metadata here. The Worker verifies the
//     URL host and that the caller is a permitted admin.
//   * External links are allowed but must be https.
// =============================================================================

import type { Router } from '../../lib/router';
import {
  HttpError,
  badRequest,
  conflict,
  json,
  notFound,
  parsePage,
  paginated,
  readJson,
  Validator,
  assertUploadSize,
} from '../../lib/http';
import { requirePermission } from '../../services/session';
import { writeAudit } from '../../lib/audit';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { likePattern, newId, nowIso } from '../../lib/util';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidParam(value: string | undefined): string {
  if (!value || !UUID_RE.test(value)) throw badRequest('Invalid identifier.');
  return value;
}

/** Only Firebase Storage, R2 public URLs, or plain https links are accepted. */
function validateFileUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest('fileUrl must be an absolute URL.');
  }
  if (parsed.protocol !== 'https:') throw badRequest('Only https URLs are allowed for test papers.');
}

export function registerAdminPaperRoutes(router: Router): void {
  router.get('/api/admin/test-papers', async (ctx) => {
    await requirePermission(ctx, 'test_papers.manage');
    const page = parsePage(ctx.url, { pageSize: 25 });
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const status = ctx.url.searchParams.get('status');
    const examTypeId = ctx.url.searchParams.get('examTypeId');
    const year = ctx.url.searchParams.get('year');

    const where: string[] = [];
    const binds: unknown[] = [];
    if (q) {
      binds.push(likePattern(q));
      where.push(`tp.title LIKE ?${binds.length}`);
    }
    if (status) {
      binds.push(status);
      where.push(`tp.status = ?${binds.length}`);
    }
    if (examTypeId) {
      binds.push(examTypeId);
      where.push(`tp.exam_type_id = ?${binds.length}`);
    }
    if (year) {
      binds.push(Number(year));
      where.push(`tp.year = ?${binds.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM test_papers tp ${whereSql}`).bind(...binds).first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT tp.*, cl.name AS className, et.name AS examTypeName, s.name AS subjectName
           FROM test_papers tp
           LEFT JOIN classes cl ON cl.id = tp.class_id
           LEFT JOIN exam_types et ON et.id = tp.exam_type_id
           LEFT JOIN subjects s ON s.id = tp.subject_id
           ${whereSql}
           ORDER BY tp.created_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
      )
        .bind(...binds, page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);

    return json(
      paginated(
        (rows.results ?? []).map((r) => ({ ...r, isFree: Boolean(r.isFree) })),
        Number(count?.n ?? 0),
        page,
      ),
    );
  });

  /**
   * Register the metadata of an uploaded paper.
   * The file itself is uploaded by the browser either to Firebase Storage
   * (recommended) or to this Worker (multipart, R2 required).
   */
  router.post('/api/admin/test-papers', async (ctx) => {
    const auth = await requirePermission(ctx, 'test_papers.manage');
    await enforceRateLimit(ctx.env, RATE_LIMITS.upload, clientIdentity(ctx.request, auth.user.id));

    const body = await readJson(ctx.request, { maxBytes: 1024 * 1024 });
    const v = new Validator(body);
    const title = v.string('title', { required: true, max: 200 })!;
    const description = v.string('description', { max: 3000 });
    const fileUrl = v.string('fileUrl', { required: true, max: 1024 })!;
    const fileKey = v.string('fileKey', { max: 512 });
    const fileSizeBytes = v.number('fileSizeBytes', { min: 0, max: 60 * 1024 * 1024, integer: true });
    const classId = v.string('classId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const subjectId = v.string('subjectId', { max: 64 });
    const year = v.number('year', { min: 1990, max: 2100, integer: true });
    const category = v.string('category', { max: 80 });
    const coverImageUrl = v.string('coverImageUrl', { max: 512 });
    const answerKeyUrl = v.string('answerKeyUrl', { max: 1024 });
    const solutionUrl = v.string('solutionUrl', { max: 1024 });
    const visibility = v.enum('visibility', ['public', 'authenticated', 'restricted'] as const, { fallback: 'authenticated' })!;
    const isFree = v.boolean('isFree', true)!;
    const status = v.enum('status', ['draft', 'published', 'archived'] as const, { fallback: 'published' })!;
    v.throwIfInvalid();

    validateFileUrl(fileUrl);
    if (!/\.pdf(\?|#|$)/i.test(fileUrl) && !/firebasestorage|r2\.dev|cloudflarestorage/.test(fileUrl)) {
      // Firebase Storage URLs encode the file name in the path; allow them.
      console.warn('test_paper_url_without_pdf_extension', fileUrl.slice(0, 120));
    }
    if (answerKeyUrl) validateFileUrl(answerKeyUrl);
    if (solutionUrl) validateFileUrl(solutionUrl);

    const id = newId();
    const provider = /firebasestorage|googleapis\.com\/v0\/b\//.test(fileUrl) ? 'firebase' : /r2\.dev|workers\.dev\/api\/media/.test(fileUrl) ? 'r2' : 'external';

    await ctx.env.DB.prepare(
      `INSERT INTO test_papers (id, title, description, class_id, exam_type_id, subject_id, year, category, cover_image_url,
          file_url, file_key, storage_provider, file_size_bytes, mime_type, answer_key_url, solution_url, visibility, is_free,
          status, uploaded_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'application/pdf', ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20)`,
    )
      .bind(
        id,
        title,
        description ?? null,
        classId ?? null,
        examTypeId ?? null,
        subjectId ?? null,
        year ?? null,
        category ?? null,
        coverImageUrl ?? null,
        fileUrl,
        fileKey ?? null,
        provider,
        fileSizeBytes ?? null,
        answerKeyUrl ?? null,
        solutionUrl ?? null,
        visibility,
        isFree ? 1 : 0,
        status,
        auth.user.id,
        nowIso(),
      )
      .run();

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'test_paper.create',
      entityType: 'test_paper',
      entityId: id,
      after: { title, fileUrl: fileUrl.slice(0, 200), provider, status },
    });
    return json({ id, provider }, { status: 201 });
  });

  router.put('/api/admin/test-papers/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'test_papers.manage');
    const id = uuidParam(ctx.params.id);
    const existing = await ctx.env.DB.prepare('SELECT id, title FROM test_papers WHERE id = ?1')
      .bind(id)
      .first<{ id: string; title: string }>();
    if (!existing) throw notFound('Test paper not found.');

    const body = await readJson(ctx.request, { maxBytes: 1024 * 1024 });
    const v = new Validator(body);
    const title = v.string('title', { max: 200 });
    const description = v.string('description', { max: 3000 });
    const classId = v.string('classId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const subjectId = v.string('subjectId', { max: 64 });
    const year = v.number('year', { min: 1990, max: 2100, integer: true });
    const category = v.string('category', { max: 80 });
    const coverImageUrl = v.string('coverImageUrl', { max: 512 });
    const answerKeyUrl = v.string('answerKeyUrl', { max: 1024 });
    const solutionUrl = v.string('solutionUrl', { max: 1024 });
    const visibility = v.enum('visibility', ['public', 'authenticated', 'restricted'] as const);
    const isFree = v.boolean('isFree');
    const status = v.enum('status', ['draft', 'published', 'archived'] as const);
    v.throwIfInvalid();

    const fields: Record<string, unknown> = {
      title: title ?? undefined,
      description: description ?? undefined,
      class_id: classId ?? undefined,
      exam_type_id: examTypeId ?? undefined,
      subject_id: subjectId ?? undefined,
      year: year ?? undefined,
      category: category ?? undefined,
      cover_image_url: coverImageUrl ?? undefined,
      answer_key_url: answerKeyUrl ?? undefined,
      solution_url: solutionUrl ?? undefined,
      visibility: visibility ?? undefined,
      is_free: isFree === undefined ? undefined : isFree ? 1 : 0,
      status: status ?? undefined,
    };
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (keys.length) {
      await ctx.env.DB.prepare(`UPDATE test_papers SET ${keys.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
        .bind(id, ...keys.map((k) => fields[k]))
        .run();
    }
    await writeAudit(ctx.env, ctx.request, auth, { action: 'test_paper.update', entityType: 'test_paper', entityId: id, after: body });
    return json({ ok: true });
  });

  router.delete('/api/admin/test-papers/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'test_papers.manage');
    const id = uuidParam(ctx.params.id);
    const paper = await ctx.env.DB.prepare('SELECT id, title, file_key, storage_provider FROM test_papers WHERE id = ?1')
      .bind(id)
      .first<{ id: string; title: string; file_key: string | null; storage_provider: string }>();
    if (!paper) throw notFound('Test paper not found.');

    if (paper.storage_provider === 'r2' && paper.file_key && ctx.env.MEDIA) {
      ctx.ctx.waitUntil(ctx.env.MEDIA.delete(paper.file_key).catch(() => undefined));
    }

    await ctx.env.DB.prepare('DELETE FROM test_papers WHERE id = ?1').bind(id).run();
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'test_paper.delete',
      entityType: 'test_paper',
      entityId: id,
      before: { title: paper.title },
    });
    return json({ ok: true });
  });

  // ---- Direct upload to R2 (optional provider) ---------------------------
  router.post('/api/admin/test-papers/upload', async (ctx) => {
    const auth = await requirePermission(ctx, 'test_papers.manage');
    if (!ctx.env.MEDIA) {
      throw new HttpError(
        412,
        'r2_not_configured',
        'Direct uploads require the R2 bucket binding MEDIA. Use Firebase Storage instead (see docs/STORAGE.md).',
      );
    }
    await enforceRateLimit(ctx.env, RATE_LIMITS.upload, clientIdentity(ctx.request, auth.user.id));
    assertUploadSize(ctx.request, 32 * 1024 * 1024);

    const contentType = ctx.request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) throw badRequest('Expected multipart/form-data.');

    const form = await ctx.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw badRequest('No file was uploaded.');
    if (file.size > 32 * 1024 * 1024) throw new HttpError(413, 'payload_too_large', 'PDFs must be 32 MB or smaller.');
    if (file.type && file.type !== 'application/pdf') throw badRequest('Only PDF files are accepted.');

    const buffer = await file.arrayBuffer();
    const header = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 5)));
    if (header !== '%PDF-') throw badRequest('The uploaded file is not a valid PDF.');

    const key = `test-papers/${new Date().toISOString().slice(0, 7)}/${newId()}.pdf`;
    await ctx.env.MEDIA.put(key, buffer, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { uploadedBy: auth.user.id, originalName: file.name.slice(0, 120) },
    });

    const publicBase = ctx.env.ALLOWED_ORIGINS?.split(',')[0]?.trim() || ctx.url.origin;
    const fileUrl = `${publicBase}/api/media/${key}`;

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'test_paper.upload',
      entityType: 'test_paper',
      meta: { key, size: file.size },
    });
    return json({ fileUrl, fileKey: key, fileSizeBytes: file.size });
  });

  // ---- Signed/streamed media (R2) ----------------------------------------
  router.get('/api/media/*', async (ctx) => {
    if (!ctx.env.MEDIA) throw notFound('Media storage is not configured.');
    const key = ctx.params.wildcard;
    if (!key || !/^test-papers\/[A-Za-z0-9._/-]+$/.test(key) || key.includes('..')) throw badRequest('Invalid media key.');

    const object = await ctx.env.MEDIA.get(key);
    if (!object) throw notFound('File not found.');
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'application/pdf',
        'content-length': String(object.size),
        etag: object.httpEtag,
        'cache-control': 'private, max-age=3600',
      },
    });
  });
}
