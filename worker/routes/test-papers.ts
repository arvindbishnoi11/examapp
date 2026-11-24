// =============================================================================
// Student-facing test paper library
//  GET /api/test-papers          published papers (filters)
//  GET /api/test-papers/:id      paper detail + permission-checked download
//  POST /api/test-papers/:id/download   increments counter, returns the URL
// =============================================================================

import type { Router } from '../lib/router';
import { forbidden, json, notFound, parsePage, paginated } from '../lib/http';
import { optionalAuth, requireAuth } from '../services/session';
import { cachedJson } from '../lib/cache';
import { likePattern } from '../lib/util';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../lib/rate-limit';

export function registerTestPaperRoutes(router: Router): void {
  router.get('/api/test-papers', async (ctx) => {
    const page = parsePage(ctx.url, { pageSize: 24, maxPageSize: 60 });
    const examTypeId = ctx.url.searchParams.get('examTypeId');
    const subjectId = ctx.url.searchParams.get('subjectId');
    const classId = ctx.url.searchParams.get('classId');
    const year = ctx.url.searchParams.get('year');
    const category = ctx.url.searchParams.get('category');
    const q = (ctx.url.searchParams.get('q') ?? '').trim();

    const where: string[] = ["tp.status = 'published'", "tp.visibility IN ('public','authenticated')"];
    const binds: unknown[] = [];
    const add = (value: unknown, clause: (i: number) => string) => {
      binds.push(value);
      where.push(clause(binds.length));
    };
    if (examTypeId) add(examTypeId, (i) => `tp.exam_type_id = ?${i}`);
    if (subjectId) add(subjectId, (i) => `tp.subject_id = ?${i}`);
    if (classId) add(classId, (i) => `tp.class_id = ?${i}`);
    if (year) add(Number(year), (i) => `tp.year = ?${i}`);
    if (category) add(category, (i) => `tp.category = ?${i}`);
    if (q) add(likePattern(q), (i) => `tp.title LIKE ?${i} ESCAPE '\\'`);

    const producer = async () => {
      const whereSql = where.join(' AND ');
      const [count, rows, years] = await Promise.all([
        ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM test_papers tp WHERE ${whereSql}`).bind(...binds).first<{ n: number }>(),
        ctx.env.DB.prepare(
          `SELECT tp.id, tp.title, tp.description, tp.year, tp.category, tp.cover_image_url AS coverImageUrl,
                  tp.file_url AS fileUrl, tp.file_size_bytes AS fileSizeBytes, tp.answer_key_url AS answerKeyUrl,
                  tp.solution_url AS solutionUrl, tp.download_count AS downloadCount, tp.is_free AS isFree,
                  tp.visibility, tp.created_at AS createdAt,
                  cl.name AS className, et.name AS examTypeName, s.name AS subjectName
             FROM test_papers tp
             LEFT JOIN classes cl ON cl.id = tp.class_id
             LEFT JOIN exam_types et ON et.id = tp.exam_type_id
             LEFT JOIN subjects s ON s.id = tp.subject_id
             WHERE ${whereSql}
             ORDER BY tp.year DESC, tp.created_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
        )
          .bind(...binds, page.pageSize, page.offset)
          .all<Record<string, unknown>>(),
        ctx.env.DB.prepare("SELECT DISTINCT year FROM test_papers WHERE status = 'published' AND year IS NOT NULL ORDER BY year DESC")
          .all<{ year: number }>(),
      ]);

      return {
        ...paginated(
          (rows.results ?? []).map((r) => ({
            ...r,
            // Downloads are gated by the detail route; the list never exposes
            // restricted file URLs to anonymous visitors.
            fileUrl: r.visibility === 'restricted' ? null : r.fileUrl,
            isFree: Boolean(r.isFree),
          })),
          Number(count?.n ?? 0),
          page,
        ),
        years: (years.results ?? []).map((y) => y.year),
      };
    };

    return cachedJson(ctx, producer, {
      ttlSeconds: 120,
      vary: { examTypeId, subjectId, classId, year, category, page: page.page, size: page.pageSize },
    });
  });

  router.get('/api/test-papers/:id', async (ctx) => {
    const auth = await optionalAuth(ctx);
    const paper = await ctx.env.DB.prepare(
      `SELECT tp.*, cl.name AS className, et.name AS examTypeName, s.name AS subjectName
         FROM test_papers tp
         LEFT JOIN classes cl ON cl.id = tp.class_id
         LEFT JOIN exam_types et ON et.id = tp.exam_type_id
         LEFT JOIN subjects s ON s.id = tp.subject_id
        WHERE tp.id = ?1 AND tp.status = 'published'`,
    )
      .bind(ctx.params.id)
      .first<Record<string, unknown>>();
    if (!paper) throw notFound('Test paper not found.');

    const restricted = paper.visibility === 'restricted';
    if (restricted && !auth) throw forbidden('Please sign in to open this paper.');

    return json({
      paper: {
        ...paper,
        isFree: Boolean(paper.isFree),
        fileUrl: restricted && !auth ? null : paper.fileUrl,
      },
      canDownload: Boolean(auth) || paper.visibility === 'public',
    });
  });

  router.post('/api/test-papers/:id/download', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.read, clientIdentity(ctx.request, auth.user.id));

    const paper = await ctx.env.DB.prepare(
      "SELECT id, title, file_url AS fileUrl, answer_key_url AS answerKeyUrl, solution_url AS solutionUrl, visibility, status FROM test_papers WHERE id = ?1",
    )
      .bind(ctx.params.id)
      .first<{ id: string; title: string; fileUrl: string; answerKeyUrl: string | null; solutionUrl: string | null; visibility: string; status: string }>();
    if (!paper || paper.status !== 'published') throw notFound('Test paper not found.');

    ctx.ctx.waitUntil(
      ctx.env.DB.prepare('UPDATE test_papers SET download_count = download_count + 1 WHERE id = ?1').bind(paper.id).run().catch(() => undefined),
    );

    return json({
      fileUrl: paper.fileUrl,
      answerKeyUrl: paper.answerKeyUrl,
      solutionUrl: paper.solutionUrl,
      title: paper.title,
    });
  });
}
