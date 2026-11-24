// =============================================================================
// Google Sheets → D1 synchronisation engine
// =============================================================================
// Guarantees
//   * Preview mode: full validation and diffing, ZERO writes.
//   * Never deletes rows. Records that disappear from the sheet are reported as
//     "missingFromSheet" and left untouched (admins archive via the dashboard).
//   * Idempotent: re-running a sync produces no duplicates (matched on
//     external_id, then on natural keys such as slug/OptionKey/YouTube ID).
//   * Parents before children (Classes → Courses → Subjects → Chapters → …).
//   * Per-row validation with precise errors (sheet, row number, message).
//   * Concurrency: a lease row in `sync_locks` prevents two syncs overlapping;
//     stale leases expire automatically.
//   * Every run is recorded in `sync_logs` with inserted/updated/skipped/failed.
// =============================================================================

import type { Env } from '../env';
import type { SyncReport, SyncSheetReport } from '../../shared/types';
import {
  buildColumnMap,
  coerceCell,
  findSheetSpec,
  SHEET_SPECS,
  type SheetEntity,
  type SheetSpec,
} from './sheets-schema';
import { describeSheetsError, getSheetValues, getSpreadsheetMeta, sheetsConfigured } from './google-sheets';
import { newId, nowIso, slugify } from '../lib/util';
import { parseYouTubeUrl, youtubeThumbnail } from '../../shared/youtube';
import { HttpError } from '../lib/http';

export type SyncMode = 'preview' | 'full' | 'incremental' | 'scheduled';

export type SyncOptions = {
  mode: SyncMode;
  sheetFilter?: string[];
  actorId?: string | null;
};

type RowRecord = Record<string, unknown>;

type EntityResult = { inserted: number; updated: number; skipped: number; failed: number; errors: { row: number; message: string }[] };

const LOCK_KEY = 'sheets-sync';
const LOCK_TTL_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

async function acquireLock(env: Env, actorId?: string | null): Promise<boolean> {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM sync_locks WHERE expires_at < ?1').bind(now).run();
  try {
    await env.DB.prepare(
      `INSERT INTO sync_locks (key, locked_at, locked_by, expires_at) VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(LOCK_KEY, nowIso(), actorId ?? 'system', now + LOCK_TTL_SECONDS * 1000)
      .run();
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM sync_locks WHERE key = ?1').bind(LOCK_KEY).run().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Lookups shared across entities (resolved once per run)
// ---------------------------------------------------------------------------

type Lookups = {
  classesByKey: Map<string, string>;
  examTypesByKey: Map<string, string>;
  coursesByKey: Map<string, string>;
  subjectsByKey: Map<string, { id: string; courseId: string }>;
  chaptersByKey: Map<string, { id: string; subjectId: string; courseId: string }>;
  seriesByKey: Map<string, string>;
  examsByKey: Map<string, string>;
  questionsByKey: Map<string, string>;
  testSeriesByKey: Map<string, string>;
};

async function loadLookups(env: Env): Promise<Lookups> {
  const [classes, examTypes, courses, subjects, chapters, series, exams, questions, testSeries] = await env.DB.batch<
    { id: string; k1: string | null; k2: string | null; k3: string | null }
  >([
    env.DB.prepare('SELECT id, slug AS k1, lower(name) AS k2, external_id AS k3 FROM classes'),
    env.DB.prepare('SELECT id, slug AS k1, lower(name) AS k2, external_id AS k3 FROM exam_types'),
    env.DB.prepare('SELECT id, slug AS k1, lower(name) AS k2, external_id AS k3 FROM courses'),
    env.DB.prepare('SELECT id, slug AS k1, lower(name) AS k2, external_id AS k3, course_id AS k4 FROM subjects'),
    env.DB.prepare('SELECT id, slug AS k1, lower(name) AS k2, external_id AS k3, subject_id AS k4, course_id AS k5 FROM chapters'),
    env.DB.prepare('SELECT id, slug AS k1, lower(title) AS k2, external_id AS k3 FROM lecture_series'),
    env.DB.prepare('SELECT id, slug AS k1, lower(title) AS k2, external_id AS k3 FROM exams'),
    env.DB.prepare('SELECT id, external_id AS k1, lower(substr(question_text,1,120)) AS k2, NULL AS k3 FROM questions'),
    env.DB.prepare('SELECT id, slug AS k1, lower(name) AS k2, external_id AS k3 FROM test_series'),
  ]);

  const index = <T>(rows: { id: string; k1: string | null; k2: string | null; k3: string | null; k4?: string | null; k5?: string | null }[], make: (r: never) => T) => {
    const map = new Map<string, T>();
    for (const row of rows) {
      for (const key of [row.k3, row.k1, row.k2]) {
        if (key) map.set(String(key).trim().toLowerCase(), make(row as never));
      }
    }
    return map;
  };

  return {
    classesByKey: index(classes.results ?? [], (r: { id: string }) => r.id),
    examTypesByKey: index(examTypes.results ?? [], (r: { id: string }) => r.id),
    coursesByKey: index(courses.results ?? [], (r: { id: string }) => r.id),
    subjectsByKey: index(subjects.results ?? [], (r: { id: string; k4: string }) => ({ id: r.id, courseId: r.k4 })),
    chaptersByKey: index(chapters.results ?? [], (r: { id: string; k4: string; k5: string }) => ({ id: r.id, subjectId: r.k4, courseId: r.k5 })),
    seriesByKey: index(series.results ?? [], (r: { id: string }) => r.id),
    examsByKey: index(exams.results ?? [], (r: { id: string }) => r.id),
    questionsByKey: index(questions.results ?? [], (r: { id: string }) => r.id),
    testSeriesByKey: index(testSeries.results ?? [], (r: { id: string }) => r.id),
  };
}

function lookup(map: Map<string, string>, ref: unknown): string | null {
  if (ref === null || ref === undefined) return null;
  const key = String(ref).trim().toLowerCase();
  if (!key) return null;
  return map.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// Per-entity importers
// ---------------------------------------------------------------------------

type ImportContext = {
  env: Env;
  mode: SyncMode;
  lookups: Lookups;
  result: EntityResult;
  previewRows: Record<string, unknown[]>;
  existingExternalIds: Set<string>;
};

function sheetStatus(value: unknown, fallback: string): 'draft' | 'published' | 'archived' {
  if (typeof value === 'boolean') return value ? 'published' : 'draft';
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback as 'draft';
  if (['published', 'active', 'live', 'yes', 'true', '1', 'public', 'enabled'].includes(text)) return 'published';
  if (['archived', 'deleted', 'inactive', 'hidden'].includes(text)) return 'archived';
  return 'draft';
}

function boolOr(value: unknown, fallback: boolean): number {
  if (value === null || value === undefined || value === '') return fallback ? 1 : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value).trim().toLowerCase();
  if (['true', 'yes', '1', 'y', 'on', 'active'].includes(text)) return 1;
  if (['false', 'no', '0', 'n', 'off', 'inactive'].includes(text)) return 0;
  return fallback ? 1 : 0;
}

function parseDateMs(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  const date = Date.parse(String(value));
  return Number.isNaN(date) ? 0 : date;
}

function normaliseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = parseDateMs(value);
  if (!ms) return null;
  return new Date(ms).toISOString();
}

async function existingExternalIdsFor(env: Env, table: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(`SELECT external_id FROM ${table} WHERE external_id IS NOT NULL`).all<{ external_id: string }>();
  return new Set((rows.results ?? []).map((r) => r.external_id));
}

async function findByExternal(env: Env, table: string, externalId: string | null | undefined): Promise<{ id: string } | null> {
  if (!externalId) return null;
  return env.DB.prepare(`SELECT id FROM ${table} WHERE external_id = ?1`).bind(externalId).first<{ id: string }>();
}

type UpsertOutcome = { action: 'inserted' | 'updated' | 'unchanged' };

async function upsert(
  ctx: ImportContext,
  table: string,
  externalId: string | null,
  values: Record<string, unknown>,
  naturalMatch?: { column: string; value: string },
): Promise<UpsertOutcome> {
  let existingId: string | null = null;
  if (externalId) {
    existingId = (await findByExternal(ctx.env, table, externalId))?.id ?? null;
  }
  if (!existingId && naturalMatch && naturalMatch.value) {
    const row = await ctx.env.DB.prepare(`SELECT id FROM ${table} WHERE ${naturalMatch.column} = ?1 LIMIT 1`)
      .bind(naturalMatch.value)
      .first<{ id: string }>();
    existingId = row?.id ?? null;
  }
  // Natural key satisfied by the application's own unique index (e.g. slug)
  if (!existingId && naturalMatch && naturalMatch.value) {
    const row = await ctx.env.DB.prepare(`SELECT id FROM ${table} WHERE lower(${naturalMatch.column}) = lower(?1) LIMIT 1`)
      .bind(naturalMatch.value)
      .first<{ id: string }>();
    existingId = row?.id ?? null;
  }

  if (existingId) {
    const keys = Object.keys(values);
    if (!keys.length) return { action: 'unchanged' };
    const setSql = keys.map((k, i) => `${k} = ?${i + 2}`).join(', ');
    await ctx.env.DB.prepare(`UPDATE ${table} SET ${setSql} WHERE id = ?1`)
      .bind(existingId, ...keys.map((k) => values[k]))
      .run();
    return { action: 'updated' };
  }
  const keys = Object.keys(values);
  const placeholders = keys.map((_, i) => `?${i + 1}`).join(', ');
  await ctx.env.DB.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`)
    .bind(...keys.map((k) => values[k]))
    .run();
  return { action: 'inserted' };
}

// ---- individual entity importers -------------------------------------------

async function importClasses(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    const externalId = row.external_id ? String(row.external_id) : null;
    const slug = slugify(String(row.slug ?? name));
    const level = Number(coerceCell(row.level, 'level') ?? 0) || 0;
    await upsert(ctx, 'classes', externalId, {
      id: externalId ? (await findByExternal(ctx.env, 'classes', externalId))?.id ?? undefined : undefined,
      name,
      slug,
      level: Number.isFinite(level) ? level : 0,
      description: row.description ?? null,
      color: row.color ?? null,
      icon: row.icon ?? null,
      sort_order: Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0,
      is_active: boolOr(row.is_active, true),
      external_id: externalId,
      sheet_row: row.__row ?? null,
    }, { column: 'slug', value: slug });
  }
}

async function importExamTypes(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    const externalId = row.external_id ? String(row.external_id) : null;
    const slug = slugify(String(row.slug ?? name));
    await upsert(ctx, 'exam_types', externalId, {
      name,
      slug,
      short_name: row.short_name ?? null,
      description: row.description ?? null,
      color: row.color ?? null,
      icon: row.icon ?? null,
      sort_order: Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0,
      is_active: boolOr(row.is_active, true),
      external_id: externalId,
      sheet_row: row.__row ?? null,
    }, { column: 'slug', value: slug });
  }
}

async function importCourses(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    const externalId = row.external_id ? String(row.external_id) : null;
    const slug = slugify(String(row.slug ?? name));
    const classId = lookup(ctx.lookups.classesByKey, row.class_ref);
    const examTypeId = lookup(ctx.lookups.examTypesByKey, row.exam_type_ref);
    const price = Number(coerceCell(row.price_inr, 'price_inr') ?? 0) || 0;
    await upsert(ctx, 'courses', externalId, {
      name,
      slug,
      description: row.description ?? null,
      short_description: row.short_description ?? null,
      cover_image_url: row.cover_image_url ?? null,
      class_id: classId,
      exam_type_id: examTypeId,
      tags: row.tags ?? null,
      difficulty: ['beginner', 'intermediate', 'advanced', 'all'].includes(String(row.difficulty ?? 'all').toLowerCase())
        ? String(row.difficulty).toLowerCase()
        : 'all',
      price_inr: price,
      is_free: price === 0 ? boolOr(row.is_free, true) : boolOr(row.is_free, false),
      is_featured: boolOr(row.is_featured, false),
      status: sheetStatus(row.status, 'draft'),
      visibility: String(row.visibility ?? '').toLowerCase() === 'restricted' ? 'restricted' : 'public',
      sort_order: Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0,
      external_id: externalId,
      sheet_row: row.__row ?? null,
    }, { column: 'slug', value: slug });

    // Refresh the lookup so dependent rows in this run resolve the new id.
    const saved = await ctx.env.DB.prepare('SELECT id FROM courses WHERE slug = ?1').bind(slug).first<{ id: string }>();
    if (saved) {
      ctx.lookups.coursesByKey.set(name.toLowerCase(), saved.id);
      if (externalId) ctx.lookups.coursesByKey.set(externalId.toLowerCase(), saved.id);
      ctx.lookups.coursesByKey.set(slug.toLowerCase(), saved.id);
    }
  }
}

async function importSubjects(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    const courseId = lookup(ctx.lookups.coursesByKey, row.course_ref);
    if (!courseId) {
      throw new Error(`Course "${row.course_ref ?? ''}" could not be resolved. Add the course row first.`);
    }
    const externalId = row.external_id ? String(row.external_id) : null;
    const slug = slugify(String(row.slug ?? name));
    const existing = await ctx.env.DB.prepare('SELECT id FROM subjects WHERE course_id = ?1 AND slug = ?2')
      .bind(courseId, slug)
      .first<{ id: string }>();
    const id = existing?.id ?? newId();
    if (existing) {
      await ctx.env.DB.prepare(
        `UPDATE subjects SET name = ?2, color = ?3, icon = ?4, sort_order = ?5, is_active = ?6,
                description = ?7, external_id = COALESCE(?8, external_id), sheet_row = ?9 WHERE id = ?1`,
      )
        .bind(id, name, row.color ?? null, row.icon ?? null, Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0, boolOr(row.is_active, true), row.description ?? null, externalId, row.__row ?? null)
        .run();
      ctx.result.updated++;
    } else {
      await ctx.env.DB.prepare(
        `INSERT INTO subjects (id, course_id, name, slug, description, color, icon, sort_order, is_active, external_id, sheet_row)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
        .bind(id, courseId, name, slug, row.description ?? null, row.color ?? null, row.icon ?? null, Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0, boolOr(row.is_active, true), externalId, row.__row ?? null)
        .run();
      ctx.result.inserted++;
    }
    ctx.lookups.subjectsByKey.set(name.toLowerCase(), { id, courseId });
    if (externalId) ctx.lookups.subjectsByKey.set(externalId.toLowerCase(), { id, courseId });
    ctx.lookups.subjectsByKey.set(`${slug}`.toLowerCase(), { id, courseId });
  }
}

async function importChapters(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    const subjectHit = lookup2(ctx.lookups.subjectsByKey, row.subject_ref);
    if (!subjectHit) throw new Error(`Subject "${row.subject_ref ?? ''}" could not be resolved.`);
    const courseId = lookup(ctx.lookups.coursesByKey, row.course_ref) ?? subjectHit.courseId;
    if (!courseId) throw new Error('Chapter has no resolvable course. Set the Course column or the subject\'s course.');

    const externalId = row.external_id ? String(row.external_id) : null;
    const slug = slugify(String(row.slug ?? name));
    const existing = await ctx.env.DB.prepare('SELECT id FROM chapters WHERE subject_id = ?1 AND slug = ?2')
      .bind(subjectHit.id, slug)
      .first<{ id: string }>();
    const id = existing?.id ?? newId();
    const params = [
      name,
      courseId,
      row.description ?? null,
      Number(coerceCell(row.weightage, 'weightage') ?? 0) || null,
      Number(coerceCell(row.estimated_minutes, 'estimated_minutes') ?? 0) || null,
      Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0,
      boolOr(row.is_active, true),
      externalId,
      row.__row ?? null,
    ] as const;

    if (existing) {
      await ctx.env.DB.prepare(
        `UPDATE chapters SET name = ?2, course_id = ?3, description = ?4, weightage = ?5, estimated_minutes = ?6,
                sort_order = ?7, is_active = ?8, external_id = COALESCE(?9, external_id), sheet_row = ?10 WHERE id = ?1`,
      )
        .bind(id, ...params)
        .run();
      ctx.result.updated++;
    } else {
      await ctx.env.DB.prepare(
        `INSERT INTO chapters (id, subject_id, course_id, name, slug, description, weightage, estimated_minutes, sort_order, is_active, external_id, sheet_row)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
        .bind(id, subjectHit.id, courseId, name, slug, row.description ?? null, params[3], params[4], params[5], params[6], externalId, row.__row ?? null)
        .run();
      ctx.result.inserted++;
    }
    ctx.lookups.chaptersByKey.set(name.toLowerCase(), { id, subjectId: subjectHit.id, courseId });
    if (externalId) ctx.lookups.chaptersByKey.set(externalId.toLowerCase(), { id, subjectId: subjectHit.id, courseId });
  }
}

function lookup2<T>(map: Map<string, T>, ref: unknown): T | null {
  if (ref === null || ref === undefined) return null;
  return map.get(String(ref).trim().toLowerCase()) ?? null;
}

async function importLectureSeries(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const title = String(row.title ?? '').trim();
    const courseId = lookup(ctx.lookups.coursesByKey, row.course_ref);
    if (!courseId) throw new Error(`Course "${row.course_ref ?? ''}" could not be resolved.`);
    const chapterHit = lookup2(ctx.lookups.chaptersByKey, row.chapter_ref);
    const subjectHit = lookup2(ctx.lookups.subjectsByKey, row.subject_ref);
    const externalId = row.external_id ? String(row.external_id) : null;
    const slug = slugify(title);

    const existing = await ctx.env.DB.prepare('SELECT id FROM lecture_series WHERE course_id = ?1 AND slug = ?2')
      .bind(courseId, slug)
      .first<{ id: string }>();
    const id = existing?.id ?? newId();
    const values = [
      title,
      slug,
      courseId,
      chapterHit?.id ?? null,
      subjectHit?.id ?? null,
      row.description ?? null,
      row.thumbnail_url ?? null,
      row.youtube_playlist_id ?? null,
      boolOr(row.is_free, false),
      sheetStatus(row.status, 'draft'),
      Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0,
      externalId,
      row.__row ?? null,
    ] as const;

    if (existing) {
      await ctx.env.DB.prepare(
        `UPDATE lecture_series SET title = ?2, slug = ?3, course_id = ?4, chapter_id = ?5, subject_id = ?6, description = ?7,
                thumbnail_url = ?8, youtube_playlist_id = ?9, is_free = ?10, status = ?11, sort_order = ?12,
                external_id = COALESCE(?13, external_id), sheet_row = ?14 WHERE id = ?1`,
      )
        .bind(id, ...values)
        .run();
      ctx.result.updated++;
    } else {
      await ctx.env.DB.prepare(
        `INSERT INTO lecture_series (id, title, slug, course_id, chapter_id, subject_id, description, thumbnail_url,
            youtube_playlist_id, is_free, status, sort_order, external_id, sheet_row)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
        .bind(id, ...values)
        .run();
      ctx.result.inserted++;
    }
    ctx.lookups.seriesByKey.set(title.toLowerCase(), id);
    if (externalId) ctx.lookups.seriesByKey.set(externalId.toLowerCase(), id);
  }
}

async function refreshSeriesCounts(env: Env, courseId?: string): Promise<void> {
  const sql = `
    UPDATE lecture_series SET
      lecture_count = (SELECT COUNT(*) FROM lectures l WHERE l.series_id = lecture_series.id AND l.status = 'published'),
      total_minutes = (SELECT COALESCE(SUM(COALESCE(l.duration_seconds, 0)), 0) / 60 FROM lectures l WHERE l.series_id = lecture_series.id)
    WHERE id IN (SELECT DISTINCT series_id FROM lectures WHERE series_id IS NOT NULL ${courseId ? 'AND course_id = ?1' : ''})`;
  await (courseId ? env.DB.prepare(sql).bind(courseId) : env.DB.prepare(sql)).run();
}

async function importLectures(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  const touchedCourses = new Set<string>();

  for (const row of rows) {
    const title = String(row.title ?? '').trim();
    let videoId = row.youtube_video_id ? String(row.youtube_video_id).trim() : '';
    const urlValue = row.youtube_url ? String(row.youtube_url).trim() : '';

    if (!videoId && urlValue) {
      const parsed = parseYouTubeUrl(urlValue);
      if (parsed.kind === 'video') videoId = parsed.videoId;
      else if (parsed.kind === 'playlist' && parsed.videoId) videoId = parsed.videoId;
      else if (parsed.kind === 'invalid') throw new Error(`Invalid YouTube URL: ${parsed.reason}`);
      else if (parsed.kind === 'playlist') throw new Error('This is a playlist link. Add the series row and import the playlist instead.');
    }
    if (!videoId) throw new Error('A YouTube video id or URL is required.');
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error(`"${videoId}" is not a valid YouTube video id.`);

    const seriesHit = lookup(ctx.lookups.seriesByKey, row.series_ref);
    const chapterHit = lookup2(ctx.lookups.chaptersByKey, row.chapter_ref);
    const subjectHit = lookup2(ctx.lookups.subjectsByKey, row.subject_ref);
    const courseId =
      lookup(ctx.lookups.coursesByKey, row.course_ref) ??
      chapterHit?.courseId ??
      (seriesHit ? (await ctx.env.DB.prepare('SELECT course_id FROM lecture_series WHERE id = ?1').bind(seriesHit).first<{ course_id: string }>())?.course_id ?? null : null);

    const externalId = row.external_id ? String(row.external_id) : null;
    const durationRaw = coerceCell(row.duration_seconds, 'duration_seconds');
    const duration = durationRaw === null ? null : Math.max(0, Math.round(Number(durationRaw)));

    // Resolve an existing record: external id → same video in the same series.
    let existingId = externalId ? (await findByExternal(ctx.env, 'lectures', externalId))?.id ?? null : null;
    if (!existingId) {
      const match = await ctx.env.DB.prepare(
        'SELECT id FROM lectures WHERE youtube_video_id = ?1 AND ((series_id IS NULL AND ?2 IS NULL) OR series_id = ?2) LIMIT 1',
      )
        .bind(videoId, seriesHit)
        .first<{ id: string }>();
      existingId = match?.id ?? null;
    }

    const values = [
      title,
      row.description ?? null,
      videoId,
      urlValue || `https://www.youtube.com/watch?v=${videoId}`,
      row.thumbnail_url ?? youtubeThumbnail(videoId, 'high'),
      duration,
      row.lecture_number === null || row.lecture_number === undefined ? null : Number(coerceCell(row.lecture_number, 'lecture_number')),
      String(row.language ?? 'en').slice(0, 8) || 'en',
      boolOr(row.is_free, false),
      sheetStatus(row.status, 'draft'),
      String(row.visibility ?? '').toLowerCase() === 'restricted' ? 'restricted' : 'public',
      Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0,
      courseId,
      subjectHit?.id ?? null,
      chapterHit?.id ?? null,
      seriesHit,
      normaliseDate(row.published_at),
      externalId,
      row.__row ?? null,
    ] as const;

    if (existingId) {
      await ctx.env.DB.prepare(
        `UPDATE lectures SET title = ?2, description = ?3, youtube_video_id = ?4, youtube_url = ?5, thumbnail_url = ?6,
                duration_seconds = ?7, lecture_number = ?8, language = ?9, is_free = ?10, status = ?11, visibility = ?12,
                sort_order = ?13, course_id = ?14, subject_id = ?15, chapter_id = ?16, series_id = ?17,
                published_at = COALESCE(?18, published_at), external_id = COALESCE(?19, external_id), sheet_row = ?20
          WHERE id = ?1`,
      )
        .bind(existingId, ...values)
        .run();
      ctx.result.updated++;
    } else {
      await ctx.env.DB.prepare(
        `INSERT INTO lectures (id, title, description, youtube_video_id, youtube_url, thumbnail_url, duration_seconds,
            lecture_number, language, is_free, status, visibility, sort_order, course_id, subject_id, chapter_id, series_id,
            published_at, external_id, sheet_row)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`,
      )
        .bind(newId(), ...values)
        .run();
      ctx.result.inserted++;
    }
    if (courseId) touchedCourses.add(courseId);
  }

  for (const courseId of touchedCourses) await refreshSeriesCounts(ctx.env, courseId);
  if (!touchedCourses.size) await refreshSeriesCounts(ctx.env);
}

async function importTestSeries(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    const slug = slugify(String(row.slug ?? name));
    const externalId = row.external_id ? String(row.external_id) : null;
    const courseId = lookup(ctx.lookups.coursesByKey, row.course_ref);
    const examTypeId = lookup(ctx.lookups.examTypesByKey, row.exam_type_ref);
    await upsert(ctx, 'test_series', externalId, {
      name,
      slug,
      description: row.description ?? null,
      course_id: courseId,
      exam_type_id: examTypeId,
      thumbnail_url: row.thumbnail_url ?? null,
      is_free: boolOr(row.is_free, false),
      status: sheetStatus(row.status, 'draft'),
      sort_order: Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0,
      external_id: externalId,
      sheet_row: row.__row ?? null,
    }, { column: 'slug', value: slug });

    const saved = await ctx.env.DB.prepare('SELECT id FROM test_series WHERE slug = ?1').bind(slug).first<{ id: string }>();
    if (saved) {
      ctx.lookups.testSeriesByKey.set(name.toLowerCase(), saved.id);
      if (externalId) ctx.lookups.testSeriesByKey.set(externalId.toLowerCase(), saved.id);
    }
  }
}

async function importExams(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  const ALLOWED_KINDS = ['practice', 'chapter', 'topic', 'full_mock', 'previous_year', 'board', 'custom'];
  for (const row of rows) {
    const title = String(row.title ?? '').trim();
    const externalId = row.external_id ? String(row.external_id) : null;
    const slug = slugify(title);
    const courseId = lookup(ctx.lookups.coursesByKey, row.course_ref);
    const examTypeId = lookup(ctx.lookups.examTypesByKey, row.exam_type_ref);
    const subjectHit = lookup2(ctx.lookups.subjectsByKey, row.subject_ref);
    const chapterHit = lookup2(ctx.lookups.chaptersByKey, row.chapter_ref);
    const seriesId = lookup(ctx.lookups.testSeriesByKey, row.test_series_ref);

    const kindRaw = slugify(String(row.exam_kind ?? 'practice')).replace(/-/g, '_');
    const kind = ALLOWED_KINDS.includes(kindRaw) ? kindRaw : 'practice';
    const duration = Number(coerceCell(row.duration_minutes, 'duration_minutes') ?? 0) || 60;
    const negativeMarks = Number(coerceCell(row.negative_marks, 'negative_marks') ?? 1);
    const marksPerQuestion = Number(coerceCell(row.marks_per_question, 'marks_per_question') ?? 4);
    const totalMarks = Number(coerceCell(row.total_marks, 'total_marks') ?? 0) || 0;
    const publishMode = ['immediate', 'after_window', 'manual'].includes(String(row.result_publish_mode ?? '').toLowerCase())
      ? String(row.result_publish_mode).toLowerCase()
      : 'immediate';

    const existingId =
      (externalId ? (await findByExternal(ctx.env, 'exams', externalId))?.id : null) ??
      (await ctx.env.DB.prepare('SELECT id FROM exams WHERE slug = ?1').bind(slug).first<{ id: string }>())?.id ??
      null;

    const values = [
      title,
      slug,
      row.description ?? null,
      row.instructions ?? null,
      kind,
      courseId,
      examTypeId,
      subjectHit?.id ?? null,
      chapterHit?.id ?? null,
      Math.max(1, Math.min(600, Math.round(duration))),
      totalMarks,
      marksPerQuestion,
      Number.isFinite(negativeMarks) ? Math.abs(negativeMarks) : 1,
      boolOr(row.negative_marking_enabled, true),
      boolOr(row.shuffle_questions, false),
      boolOr(row.shuffle_options, false),
      normaliseDate(row.start_at),
      normaliseDate(row.end_at),
      Math.max(1, Math.min(100, Number(coerceCell(row.max_attempts, 'max_attempts') ?? 1) || 1)),
      publishMode,
      Math.max(0, Math.min(100, Number(coerceCell(row.passing_percentage, 'passing_percentage') ?? 0) || 0)),
      boolOr(row.is_free, true),
      sheetStatus(row.status, 'draft'),
      seriesId,
      externalId,
      row.__row ?? null,
    ] as const;

    if (existingId) {
      await ctx.env.DB.prepare(
        `UPDATE exams SET title = ?2, slug = ?3, description = ?4, instructions = ?5, exam_kind = ?6, course_id = ?7,
                exam_type_id = ?8, subject_id = ?9, chapter_id = ?10, duration_minutes = ?11, total_marks = ?12,
                marks_per_question = ?13, negative_marks = ?14, negative_marking_enabled = ?15, shuffle_questions = ?16,
                shuffle_options = ?17, start_at = ?18, end_at = ?19, max_attempts = ?20, result_publish_mode = ?21,
                passing_percentage = ?22, is_free = ?23, status = ?24, test_series_id = ?25,
                external_id = COALESCE(?26, external_id), sheet_row = ?27
          WHERE id = ?1`,
      )
        .bind(existingId, ...values)
        .run();
      ctx.result.updated++;
    } else {
      await ctx.env.DB.prepare(
        `INSERT INTO exams (id, title, slug, description, instructions, exam_kind, course_id, exam_type_id, subject_id,
            chapter_id, duration_minutes, total_marks, marks_per_question, negative_marks, negative_marking_enabled,
            shuffle_questions, shuffle_options, start_at, end_at, max_attempts, result_publish_mode, passing_percentage,
            is_free, status, test_series_id, external_id, sheet_row)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)`,
      )
        .bind(newId(), ...values)
        .run();
      ctx.result.inserted++;
    }

    const saved = await ctx.env.DB.prepare('SELECT id FROM exams WHERE slug = ?1').bind(slug).first<{ id: string }>();
    if (saved) {
      ctx.lookups.examsByKey.set(title.toLowerCase(), saved.id);
      if (externalId) ctx.lookups.examsByKey.set(externalId.toLowerCase(), saved.id);
    }
  }
}

async function importExamSections(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const examId = lookup(ctx.lookups.examsByKey, row.exam_ref);
    if (!examId) throw new Error(`Examination "${row.exam_ref ?? ''}" could not be resolved.`);
    const title = String(row.title ?? '').trim();
    const externalId = row.external_id ? String(row.external_id) : null;
    const subjectHit = lookup2(ctx.lookups.subjectsByKey, row.subject_ref);
    const chapterHit = lookup2(ctx.lookups.chaptersByKey, row.chapter_ref);

    const existing =
      (externalId ? (await findByExternal(ctx.env, 'exam_sections', externalId))?.id : null) ??
      (await ctx.env.DB.prepare('SELECT id FROM exam_sections WHERE exam_id = ?1 AND title = ?2').bind(examId, title).first<{ id: string }>())?.id ??
      null;

    const values = [
      examId,
      title,
      subjectHit?.id ?? null,
      chapterHit?.id ?? null,
      row.instructions ?? null,
      boolOr(row.is_optional, false),
      Number(coerceCell(row.max_questions, 'max_questions') ?? 0) || null,
      Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0,
      externalId,
      row.__row ?? null,
    ] as const;

    if (existing) {
      await ctx.env.DB.prepare(
        `UPDATE exam_sections SET exam_id = ?2, title = ?3, subject_id = ?4, chapter_id = ?5, instructions = ?6,
                is_optional = ?7, max_questions = ?8, sort_order = ?9, external_id = COALESCE(?10, external_id), sheet_row = ?11
          WHERE id = ?1`,
      )
        .bind(existing, ...values)
        .run();
      ctx.result.updated++;
    } else {
      await ctx.env.DB.prepare(
        `INSERT INTO exam_sections (id, exam_id, title, subject_id, chapter_id, instructions, is_optional, max_questions, sort_order, external_id, sheet_row)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
        .bind(newId(), ...values)
        .run();
      ctx.result.inserted++;
    }
  }
}

function parseCorrectOptions(value: unknown, questionType: string): string[] {
  if (value === null || value === undefined) return [];
  const text = String(value).trim();
  if (!text) return [];
  if (questionType === 'numerical' || questionType === 'integer') return [];
  // "A,C" | "A, C" | "AC" | "1,3" | "a"  → canonical keys
  const letters = text
    .toUpperCase()
    .replace(/[^A-E0-9,]/g, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const keys = new Set<string>();
  for (const part of letters) {
    if (part.length === 1) {
      if (/[A-E]/.test(part)) keys.add(part);
      else if (/[1-5]/.test(part)) keys.add(String.fromCharCode(64 + Number(part)));
    } else {
      for (const char of part) {
        if (/[A-E]/.test(char)) keys.add(char);
      }
    }
  }
  return [...keys].sort();
}

const QUESTION_TYPE_ALIASES: Record<string, string> = {
  single: 'single_correct',
  singlecorrect: 'single_correct',
  mcq: 'single_correct',
  multiple: 'multiple_correct',
  multiplecorrect: 'multiple_correct',
  multi: 'multiple_correct',
  numerical: 'numerical',
  numeric: 'numerical',
  integer: 'integer',
  integeranswer: 'integer',
  passage: 'passage',
  passagebased: 'passage',
  image: 'image_based',
  imagebased: 'image_based',
};

async function importQuestions(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const questionText = String(row.question_text ?? '').trim();
    if (!questionText) throw new Error('Question text is empty.');
    const externalId = row.external_id ? String(row.external_id) : null;

    const typeRaw = String(row.question_type ?? 'single_correct').toLowerCase().replace(/[^a-z]/g, '');
    const questionType = QUESTION_TYPE_ALIASES[typeRaw] ?? 'single_correct';
    const difficulty = ['easy', 'medium', 'hard'].includes(String(row.difficulty ?? '').toLowerCase())
      ? String(row.difficulty).toLowerCase()
      : 'medium';

    const subjectHit = lookup2(ctx.lookups.subjectsByKey, row.subject_ref);
    const chapterHit = lookup2(ctx.lookups.chaptersByKey, row.chapter_ref);

    // Natural key: external id, otherwise identical text in the same chapter.
    let existingId = externalId ? (await findByExternal(ctx.env, 'questions', externalId))?.id ?? null : null;
    if (!existingId) {
      const match = await ctx.env.DB.prepare(
        `SELECT id FROM questions WHERE question_text = ?1 AND ((chapter_id IS NULL AND ?2 IS NULL) OR chapter_id = ?2) LIMIT 1`,
      )
        .bind(questionText, chapterHit?.id ?? null)
        .first<{ id: string }>();
      existingId = match?.id ?? null;
    }

    const marks = Number(coerceCell(row.marks, 'marks') ?? 4) || 4;
    const negativeMarks = Number(coerceCell(row.negative_marks, 'negative_marks') ?? 1);

    const values = [
      subjectHit?.id ?? null,
      chapterHit?.id ?? null,
      lookup(ctx.lookups.examTypesByKey, row.exam_type_ref),
      lookup(ctx.lookups.coursesByKey, row.course_ref),
      questionType,
      difficulty,
      questionText,
      row.question_image_url ?? null,
      row.passage_text ?? null,
      marks,
      Number.isFinite(negativeMarks) ? Math.abs(negativeMarks) : 1,
      row.source ?? null,
      row.year ? Number(coerceCell(row.year, 'year')) : null,
      row.tags ?? null,
      sheetStatus(row.status, 'published'),
      externalId,
      row.__row ?? null,
    ] as const;

    const questionId = existingId ?? newId();

    if (existingId) {
      await ctx.env.DB.prepare(
        `UPDATE questions SET subject_id = ?2, chapter_id = ?3, exam_type_id = ?4, course_id = ?5, question_type = ?6,
                difficulty = ?7, question_text = ?8, question_image_url = ?9, passage_text = ?10, marks = ?11,
                negative_marks = ?12, source = ?13, year = ?14, tags = ?15, status = ?16,
                external_id = COALESCE(?17, external_id), sheet_row = ?18
          WHERE id = ?1`,
      )
        .bind(questionId, ...values)
        .run();
      ctx.result.updated++;
    } else {
      await ctx.env.DB.prepare(
        `INSERT INTO questions (id, subject_id, chapter_id, exam_type_id, course_id, question_type, difficulty,
            question_text, question_image_url, passage_text, marks, negative_marks, source, year, tags, status, external_id, sheet_row)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
      )
        .bind(questionId, ...values)
        .run();
      ctx.result.inserted++;
    }

    ctx.lookups.questionsByKey.set(questionText.slice(0, 120).toLowerCase(), questionId);
    if (externalId) ctx.lookups.questionsByKey.set(externalId.toLowerCase(), questionId);

    // ---- inline options (A–E) ---------------------------------------------
    const optionDefs: { key: string; text: unknown }[] = [
      { key: 'A', text: row.option_a },
      { key: 'B', text: row.option_b },
      { key: 'C', text: row.option_c },
      { key: 'D', text: row.option_d },
      { key: 'E', text: row.option_e },
    ].filter((o) => o.text !== null && o.text !== undefined && String(o.text).trim() !== '');

    const correctKeys = parseCorrectOptions(row.correct_answer, questionType);

    if (questionType !== 'numerical' && questionType !== 'integer') {
      if (optionDefs.length < 2) throw new Error('At least two options (A and B) are required.');
      if (!correctKeys.length) throw new Error('Missing correct answer (expected A–E, e.g. "B" or "A,C").');

      const existingOptions = await ctx.env.DB.prepare('SELECT option_key AS key FROM question_options WHERE question_id = ?1')
        .bind(questionId)
        .all<{ key: string }>();
      const existingKeys = new Set((existingOptions.results ?? []).map((o) => o.key));

      for (let i = 0; i < optionDefs.length; i++) {
        const opt = optionDefs[i];
        const isCorrect = correctKeys.includes(opt.key) ? 1 : 0;
        if (existingKeys.has(opt.key)) {
          await ctx.env.DB.prepare(
            'UPDATE question_options SET option_text = ?2, is_correct = ?3, sort_order = ?4 WHERE question_id = ?1 AND option_key = ?5',
          )
            .bind(questionId, String(opt.text), isCorrect, i, opt.key)
            .run();
        } else {
          await ctx.env.DB.prepare(
            `INSERT INTO question_options (id, question_id, option_key, option_text, is_correct, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          )
            .bind(newId(), questionId, opt.key, String(opt.text), isCorrect, i)
            .run();
        }
      }
    }

    // ---- answer key --------------------------------------------------------
    const numericValue = coerceCell(row.numerical_answer, 'numeric_answer');
    const answerType =
      questionType === 'multiple_correct'
        ? 'multiple'
        : questionType === 'numerical'
          ? 'numeric'
          : questionType === 'integer'
            ? 'integer'
            : 'single';

    if (questionType === 'numerical' && (numericValue === null || numericValue === undefined)) {
      throw new Error('Numerical questions need a value in "Numerical Answer".');
    }
    if (questionType === 'integer' && (numericValue === null || numericValue === undefined)) {
      throw new Error('Integer questions need a value in "Numerical Answer".');
    }

    await ctx.env.DB.prepare(
      `INSERT INTO answer_keys (id, question_id, answer_type, correct_options, numeric_answer, numeric_tolerance, integer_answer)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
       ON CONFLICT(question_id) DO UPDATE SET
         answer_type = excluded.answer_type,
         correct_options = excluded.correct_options,
         numeric_answer = excluded.numeric_answer,
         integer_answer = excluded.integer_answer`,
    )
      .bind(
        newId(),
        questionId,
        answerType,
        correctKeys.length ? JSON.stringify(correctKeys) : null,
        questionType === 'numerical' ? Number(numericValue) : null,
        questionType === 'integer' ? Math.round(Number(numericValue)) : null,
      )
      .run();

    if (row.explanation) {
      await ctx.env.DB.prepare(
        `INSERT INTO explanations (id, question_id, explanation_text) VALUES (?1, ?2, ?3)
         ON CONFLICT(question_id) DO UPDATE SET explanation_text = excluded.explanation_text`,
      )
        .bind(newId(), questionId, String(row.explanation))
        .run();
    }
  }
}

async function importQuestionOptions(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const questionId = lookup(ctx.lookups.questionsByKey, row.question_ref);
    if (!questionId) throw new Error(`Question "${row.question_ref ?? ''}" could not be resolved.`);
    const key = String(row.option_key ?? '').trim().toUpperCase().slice(0, 4);
    if (!key) throw new Error('Option key is required.');

    await ctx.env.DB.prepare(
      `INSERT INTO question_options (id, question_id, option_key, option_text, option_image_url, is_correct, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(question_id, option_key) DO UPDATE SET
         option_text = excluded.option_text, option_image_url = excluded.option_image_url,
         is_correct = excluded.is_correct, sort_order = excluded.sort_order`,
    )
      .bind(
        newId(),
        questionId,
        key,
        row.option_text ?? null,
        row.option_image_url ?? null,
        boolOr(row.is_correct, false),
        Number(coerceCell(row.sort_order, 'sort_order') ?? 0) || 0,
      )
      .run();
    ctx.result.inserted++;
  }
}

async function importAnswerKeys(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const questionId = lookup(ctx.lookups.questionsByKey, row.question_ref);
    if (!questionId) throw new Error(`Question "${row.question_ref ?? ''}" could not be resolved.`);

    const typeRaw = String(row.answer_type ?? '').toLowerCase();
    const correct = parseCorrectOptions(row.correct_options, 'single_correct');
    const numeric = coerceCell(row.numeric_answer, 'numeric_answer');
    const integer = coerceCell(row.integer_answer, 'integer_answer');

    const answerType = ['single', 'multiple', 'numeric', 'integer'].includes(typeRaw)
      ? typeRaw
      : correct.length > 1
        ? 'multiple'
        : numeric !== null && integer === null && typeRaw !== 'integer'
          ? 'numeric'
          : integer !== null
            ? 'integer'
            : 'single';

    await ctx.env.DB.prepare(
      `INSERT INTO answer_keys (id, question_id, answer_type, correct_options, numeric_answer, numeric_tolerance, integer_answer)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(question_id) DO UPDATE SET
         answer_type = excluded.answer_type, correct_options = excluded.correct_options,
         numeric_answer = excluded.numeric_answer, numeric_tolerance = excluded.numeric_tolerance,
         integer_answer = excluded.integer_answer`,
    )
      .bind(
        newId(),
        questionId,
        answerType,
        correct.length ? JSON.stringify(correct) : null,
        numeric === null ? null : Number(numeric),
        Number(coerceCell(row.numeric_tolerance, 'numeric_tolerance') ?? 0) || 0,
        integer === null ? null : Math.round(Number(integer)),
      )
      .run();
    ctx.result.updated++;
  }
}

async function importExplanations(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const questionId = lookup(ctx.lookups.questionsByKey, row.question_ref);
    if (!questionId) throw new Error(`Question "${row.question_ref ?? ''}" could not be resolved.`);
    await ctx.env.DB.prepare(
      `INSERT INTO explanations (id, question_id, explanation_text, video_url, image_url) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(question_id) DO UPDATE SET explanation_text = excluded.explanation_text,
         video_url = excluded.video_url, image_url = excluded.image_url`,
    )
      .bind(newId(), questionId, row.explanation_text ?? null, row.video_url ?? null, row.image_url ?? null)
      .run();
    ctx.result.updated++;
  }
}

async function importAnnouncements(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const title = String(row.title ?? '').trim();
    const externalId = row.external_id ? String(row.external_id) : null;
    const priority = ['low', 'normal', 'high', 'urgent'].includes(String(row.priority ?? '').toLowerCase())
      ? String(row.priority).toLowerCase()
      : 'normal';
    const audienceRaw = String(row.target_audience ?? 'all').toLowerCase().replace(/\s/g, '_');
    const audience = ['all', 'class', 'exam_type', 'course', 'selected'].includes(audienceRaw) ? audienceRaw : 'all';

    await upsert(ctx, 'announcements', externalId, {
      title,
      body: String(row.body ?? ''),
      image_url: row.image_url ?? null,
      link_url: row.link_url ?? null,
      priority,
      is_pinned: boolOr(row.is_pinned, false),
      target_audience: audience,
      class_id: lookup(ctx.lookups.classesByKey, row.class_ref),
      exam_type_id: lookup(ctx.lookups.examTypesByKey, row.exam_type_ref),
      publish_at: normaliseDate(row.publish_at),
      expires_at: normaliseDate(row.expires_at),
      status: sheetStatus(row.status, 'draft'),
      external_id: externalId,
      sheet_row: row.__row ?? null,
    }, { column: 'external_id', value: externalId ?? '' });
  }
}

async function importTestPapers(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const title = String(row.title ?? '').trim();
    const fileUrl = String(row.file_url ?? '').trim();
    if (!/^https?:\/\//i.test(fileUrl)) throw new Error('file_url must be an absolute http(s) URL to the PDF.');
    const externalId = row.external_id ? String(row.external_id) : null;
    const provider = fileUrl.includes('firebasestorage') ? 'firebase' : 'external';

    await upsert(ctx, 'test_papers', externalId, {
      title,
      description: row.description ?? null,
      file_url: fileUrl,
      storage_provider: provider,
      class_id: lookup(ctx.lookups.classesByKey, row.class_ref),
      exam_type_id: lookup(ctx.lookups.examTypesByKey, row.exam_type_ref),
      subject_id: lookup2(ctx.lookups.subjectsByKey, row.subject_ref)?.id ?? null,
      year: row.year ? Number(coerceCell(row.year, 'year')) : null,
      category: row.category ?? null,
      cover_image_url: row.cover_image_url ?? null,
      answer_key_url: row.answer_key_url ?? null,
      solution_url: row.solution_url ?? null,
      visibility: ['public', 'authenticated', 'restricted'].includes(String(row.visibility ?? '').toLowerCase())
        ? String(row.visibility).toLowerCase()
        : 'authenticated',
      is_free: boolOr(row.is_free, true),
      status: sheetStatus(row.status, 'draft'),
      external_id: externalId,
      sheet_row: row.__row ?? null,
    }, { column: 'external_id', value: externalId ?? '' });
  }
}

async function importSettings(ctx: ImportContext, rows: RowRecord[]): Promise<void> {
  for (const row of rows) {
    const key = String(row.key ?? '').trim();
    if (!key) throw new Error('Setting key is required.');
    const value = row.value === null || row.value === undefined ? '' : String(row.value);
    await ctx.env.DB.prepare(
      `INSERT INTO platform_settings (key, value, category, description, is_public)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         category = COALESCE(excluded.category, platform_settings.category)`,
    )
      .bind(key, value, row.category ?? 'general', row.description ?? null, boolOr(row.is_public, false))
      .run();
    ctx.result.updated++;
  }
}

const IMPORTERS: Partial<Record<SheetEntity, (ctx: ImportContext, rows: RowRecord[]) => Promise<void>>> = {
  classes: importClasses,
  exam_types: importExamTypes,
  courses: importCourses,
  subjects: importSubjects,
  chapters: importChapters,
  lecture_series: importLectureSeries,
  lectures: importLectures,
  test_series: importTestSeries,
  exams: importExams,
  exam_sections: importExamSections,
  questions: importQuestions,
  question_options: importQuestionOptions,
  answer_keys: importAnswerKeys,
  explanations: importExplanations,
  announcements: importAnnouncements,
  test_papers: importTestPapers,
  settings: importSettings,
};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export type SyncOutcome = {
  report: SyncReport;
  preview?: Record<string, unknown[]>;
};

function emptyResult(): EntityResult {
  return { inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
}

function validateRow(row: RowRecord, spec: SheetSpec, map: ReturnType<typeof buildColumnMap>): string[] {
  const problems: string[] = [];
  for (const column of spec.columns) {
    if (!column.required) continue;
    if (map.mapping[column.field] === undefined) {
      problems.push(`Required column "${column.field}" is missing from the sheet.`);
    } else {
      const value = row[column.field];
      if (value === null || value === undefined || String(value).trim() === '') {
        problems.push(`Required field "${column.field}" is empty.`);
      }
    }
  }
  return problems;
}

export async function inspectSpreadsheet(env: Env): Promise<{
  configured: boolean;
  spreadsheetId: string;
  title: string | null;
  worksheets: { title: string; rowCount: number; mappedEntity: string | null; headerSample: string[] }[];
  message?: string;
}> {
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || '1tNqp66KgAnnhCRceOPkZubl1C-pMK_olzJkBlKGEnE4';
  if (!sheetsConfigured(env)) {
    return {
      configured: false,
      spreadsheetId,
      title: null,
      worksheets: [],
      message:
        'GOOGLE_SERVICE_ACCOUNT_JSON is not configured. Add the service-account JSON as a Cloudflare secret, then share the spreadsheet with the service account as an Editor.',
    };
  }

  try {
    const meta = await getSpreadsheetMeta(env, spreadsheetId);
    const worksheets = await Promise.all(
      meta.sheets.slice(0, 40).map(async (sheet) => {
        let headers: string[] = [];
        let rowCount = Math.max(0, sheet.rowCount - 1);
        try {
          const values = await getSheetValues(env, sheet.title, spreadsheetId, 'A1:Z3');
          headers = (values[0] ?? []).filter((h) => String(h).trim() !== '');
          rowCount = Math.max(0, sheet.rowCount - 1);
        } catch {
          /* sheet may be empty */
        }
        const spec = findSheetSpec(sheet.title);
        return { title: sheet.title, rowCount, mappedEntity: spec?.entity ?? null, headerSample: headers.slice(0, 12) };
      }),
    );

    return { configured: true, spreadsheetId, title: meta.title, worksheets };
  } catch (err) {
    return {
      configured: true,
      spreadsheetId,
      title: null,
      worksheets: [],
      message: describeSheetsError(err),
    };
  }
}

export async function runSync(env: Env, options: SyncOptions): Promise<SyncOutcome> {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const report: SyncReport = {
    mode: options.mode,
    status: 'running',
    startedAt,
    sheets: [],
  };

  if (!sheetsConfigured(env)) {
    report.status = 'failed';
    report.finishedAt = nowIso();
    report.errorMessage =
      'GOOGLE_SERVICE_ACCOUNT_JSON is not configured on this deployment. Synchronisation is unavailable until the secret is added.';
    await persistLog(env, report, options, startedMs);
    return { report };
  }

  const preview = options.mode === 'preview';
  const lockAcquired = preview ? true : await acquireLock(env, options.actorId);
  if (!lockAcquired) {
    throw new HttpError(409, 'sync_in_progress', 'Another synchronisation is already running. Please wait for it to finish.');
  }

  try {
    const lookups = await loadLookups(env);
    const meta = await getSpreadsheetMeta(env);

    const worksheetTitles = meta.sheets.map((s) => s.title);
    const normalise = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byNormalised = new Map(worksheetTitles.map((t) => [normalise(t), t]));

    const previewRows: Record<string, unknown[]> = {};

    for (const spec of SHEET_SPECS) {
      const requested = options.sheetFilter?.length
        ? options.sheetFilter.some((f) => normalise(f) === normalise(spec.entity) || spec.sheets.includes(normalise(f)))
        : true;
      if (!requested) continue;

      const matching = spec.sheets.map((s) => byNormalised.get(normalise(s))).filter((s): s is string => Boolean(s));
      const sheetReport: SyncSheetReport = {
        sheet: matching[0] ?? spec.sheets[0],
        entity: spec.entity,
        detected: matching.length > 0,
        totalRows: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      };

      if (!matching.length) {
        report.sheets.push(sheetReport);
        continue;
      }

      const importer = IMPORTERS[spec.entity];
      if (!importer) {
        report.sheets.push(sheetReport);
        continue;
      }

      for (const sheetTitle of matching) {
        let values: string[][];
        try {
          values = await getSheetValues(env, sheetTitle);
        } catch (err) {
          sheetReport.errors.push({ row: 0, message: describeSheetsError(err) });
          sheetReport.failed++;
          continue;
        }
        if (values.length < 2) continue;

        const headerRow = values[0];
        const columnMap = buildColumnMap(headerRow, spec);
        sheetReport.sheet = sheetTitle;

        if (columnMap.missingRequired.length) {
          sheetReport.errors.push({
            row: 1,
            message: `Missing required column(s): ${columnMap.missingRequired.join(', ')}. Found headers: ${headerRow.filter(Boolean).slice(0, 15).join(', ')}`,
          });
          sheetReport.failed++;
          continue;
        }

        const rows: RowRecord[] = [];
        values.slice(1).forEach((rawRow, index) => {
          if (rawRow.every((cell) => String(cell ?? '').trim() === '')) return; // blank row
          const record: RowRecord = { __row: index + 2 };
          for (const [field, colIndex] of Object.entries(columnMap.mapping)) {
            record[field] = coerceCell(rawRow[colIndex], field);
          }
          const problems = validateRow(record, spec, columnMap);
          if (problems.length) {
            sheetReport.errors.push({ row: index + 2, message: problems.join(' ') });
            sheetReport.failed++;
            report.status = report.status === 'failed' ? 'failed' : 'partial';
            return;
          }
          rows.push(record);
        });

        sheetReport.totalRows += rows.length;

        if (preview) {
          previewRows[spec.entity] = rows.slice(0, 25).map((r) => {
            const copy: Record<string, unknown> = { ...r };
            delete copy.__row;
            return copy;
          });
          // Count how many rows would be new vs updated without writing.
          const externalIds = await existingExternalIdsFor(env, tableForEntity(spec.entity));
          for (const row of rows) {
            const externalId = row.external_id ? String(row.external_id) : null;
            if (externalId && externalIds.has(externalId)) sheetReport.updated++;
            else sheetReport.inserted++;
          }
        } else {
          const result = emptyResult();
          const ctx: ImportContext = {
            env,
            mode: options.mode,
            lookups,
            result,
            previewRows,
            existingExternalIds: new Set<string>(),
          };

          for (const row of rows) {
            try {
              await importer(ctx, [row]);
            } catch (err) {
              result.failed++;
              const message = err instanceof Error ? err.message : String(err);
              if (sheetReport.errors.length < 60) {
                sheetReport.errors.push({ row: Number(row.__row ?? 0), message: message.slice(0, 300) });
              }
            }
          }

          sheetReport.inserted += result.inserted;
          sheetReport.updated += result.updated;
          sheetReport.skipped += result.skipped;
          sheetReport.failed += result.failed;
          if (result.failed > 0) report.status = report.status === 'failed' ? 'failed' : 'partial';
        }
      }

      report.sheets.push(sheetReport);
    }

    if (!preview) {
      // Completion step: recompute derived counters that depend on multiple sheets.
      await refreshSeriesCounts(env);
      await recomputeExamTotals(env);
    }

    report.status = report.sheets.some((s) => s.detected && s.inserted + s.updated > 0)
      ? report.status === 'running'
        ? 'success'
        : report.status
      : report.sheets.some((s) => s.failed > 0)
        ? report.status
        : 'success';

    if (report.status === 'running') report.status = 'success';
    report.finishedAt = nowIso();
    report.durationMs = Date.now() - startedMs;

    if (!preview) await persistLog(env, report, options, startedMs);

    return { report, preview: preview ? previewRows : undefined };
  } catch (err) {
    report.status = 'failed';
    report.finishedAt = nowIso();
    report.durationMs = Date.now() - startedMs;
    report.errorMessage = describeSheetsError(err);
    if (!preview) await persistLog(env, report, options, startedMs);
    return { report };
  } finally {
    if (!preview) await releaseLock(env);
  }
}

function tableForEntity(entity: SheetEntity): string {
  const map: Record<SheetEntity, string> = {
    classes: 'classes',
    exam_types: 'exam_types',
    courses: 'courses',
    subjects: 'subjects',
    chapters: 'chapters',
    lecture_series: 'lecture_series',
    lectures: 'lectures',
    test_series: 'test_series',
    exams: 'exams',
    exam_sections: 'exam_sections',
    questions: 'questions',
    question_options: 'question_options',
    answer_keys: 'answer_keys',
    explanations: 'explanations',
    announcements: 'announcements',
    test_papers: 'test_papers',
    settings: 'platform_settings',
  };
  return map[entity];
}

async function recomputeExamTotals(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE exams SET
       total_questions = (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = exams.id),
       total_marks = (SELECT COALESCE(SUM(eq.marks), 0) FROM exam_questions eq WHERE eq.exam_id = exams.id)
     WHERE id IN (SELECT DISTINCT exam_id FROM exam_questions)`,
  ).run();
}

async function persistLog(env: Env, report: SyncReport, options: SyncOptions, startedMs: number): Promise<void> {
  try {
    report.id = newId();
    await env.DB.prepare(
      `INSERT INTO sync_logs (id, source, mode, status, started_at, finished_at, duration_ms, triggered_by, stats_json, errors_json, error_message)
       VALUES (?1, 'google_sheets', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
      .bind(
        report.id,
        options.mode,
        report.status,
        report.startedAt,
        report.finishedAt ?? nowIso(),
        Date.now() - startedMs,
        options.actorId ?? null,
        JSON.stringify(
          Object.fromEntries(
            report.sheets.map((s) => [s.entity, { inserted: s.inserted, updated: s.updated, skipped: s.skipped, failed: s.failed }]),
          ),
        ),
        JSON.stringify(report.sheets.flatMap((s) => s.errors.map((e) => ({ sheet: s.sheet, row: e.row, message: e.message }))).slice(0, 200)),
        report.errorMessage ?? null,
      )
      .run();
  } catch (err) {
    console.error('sync_log_persist_failed', (err as Error)?.message);
  }
}

export async function lastSync(env: Env) {
  return env.DB.prepare(
    `SELECT id, mode, status, started_at AS startedAt, finished_at AS finishedAt, duration_ms AS durationMs, stats_json AS statsJson
       FROM sync_logs ORDER BY started_at DESC LIMIT 1`,
  ).first<Record<string, unknown>>();
}

export async function syncLocked(env: Env): Promise<boolean> {
  const row = await env.DB.prepare('SELECT key FROM sync_locks WHERE key = ?1 AND expires_at > ?2')
    .bind(LOCK_KEY, Date.now())
    .first();
  return Boolean(row);
}
