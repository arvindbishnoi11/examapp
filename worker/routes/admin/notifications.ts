// =============================================================================
// Admin: notifications composer + announcements
//   POST /api/admin/notifications/send     (immediate or scheduled)
//   GET  /api/admin/notifications
//   GET  /api/admin/notifications/audience-preview
// =============================================================================

import type { Router } from '../../lib/router';
import {
  badRequest,
  json,
  notFound,
  parsePage,
  paginated,
  readJson,
  Validator,
} from '../../lib/http';
import { requirePermission } from '../../services/session';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { writeAudit } from '../../lib/audit';
import { fcmConfigured, fcmHealth, resolveAudience, sendPush, type Audience } from '../../services/fcm';
import { newId, nowIso } from '../../lib/util';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGETS = ['all', 'class', 'exam_type', 'course', 'user', 'users'] as const;

export function registerAdminNotificationRoutes(router: Router): void {
  router.get('/api/admin/notifications', async (ctx) => {
    await requirePermission(ctx, 'notifications.manage');
    const page = parsePage(ctx.url, { pageSize: 25 });
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT id, title, body, image_url AS imageUrl, deep_link AS deepLink, target_type AS targetType,
                target_value AS targetValue, status, scheduled_at AS scheduledAt, sent_at AS sentAt,
                success_count AS successCount, failed_count AS failedCount, delivered_count AS deliveredCount,
                error_message AS errorMessage, created_at AS createdAt
           FROM notifications ORDER BY created_at DESC LIMIT ?1 OFFSET ?2`,
      )
        .bind(page.pageSize, page.offset)
        .all(),
    ]);
    return json({
      ...paginated(rows.results ?? [], Number(count?.n ?? 0), page),
      configured: fcmConfigured(ctx.env),
    });
  });

  router.get('/api/admin/notifications/health', async (ctx) => {
    await requirePermission(ctx, 'notifications.manage');
    return json({
      ...(await fcmHealth(ctx.env)),
      configured: fcmConfigured(ctx.env),
      tokenCount: Number(
        (await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM notification_tokens WHERE is_active = 1').first<{ n: number }>())?.n ?? 0,
      ),
    });
  });

  router.post('/api/admin/notifications/audience-preview', async (ctx) => {
    await requirePermission(ctx, 'notifications.manage');
    const body = await readJson(ctx.request);
    const targetType = TARGETS.includes(body.targetType as never) ? (body.targetType as Audience['targetType']) : 'all';
    const audience = await resolveAudience(ctx.env, {
      targetType,
      targetValue: typeof body.targetValue === 'string' ? body.targetValue : null,
    });
    const tokens = audience.userIds.length
      ? Number(
          (
            await ctx.env.DB.prepare(
              `SELECT COUNT(*) AS n FROM notification_tokens WHERE is_active = 1 AND user_id IN (SELECT value FROM json_each(?1))`,
            )
              .bind(JSON.stringify(audience.userIds))
              .first<{ n: number }>()
          )?.n ?? 0,
        )
      : 0;
    return json({
      recipients: audience.userIds.length,
      description: audience.description,
      devices: tokens,
      sampleUserIds: audience.userIds.slice(0, 5),
    });
  });

  router.post('/api/admin/notifications/send', async (ctx) => {
    const auth = await requirePermission(ctx, 'notifications.send');
    await enforceRateLimit(ctx.env, RATE_LIMITS.notifications, clientIdentity(ctx.request, auth.user.id));

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { required: true, max: 160 })!;
    const message = v.string('body', { required: true, max: 1000 })!;
    const imageUrl = v.string('imageUrl', { max: 512 });
    const deepLink = v.string('deepLink', { max: 512 });
    const targetType = v.enum('targetType', TARGETS, { required: true })!;
    const targetValue = v.string('targetValue', { max: 2000 });
    const scheduledAt = v.timestamp('scheduledAt');
    v.throwIfInvalid();

    if (imageUrl && !/^https:\/\//.test(imageUrl)) throw badRequest('imageUrl must be an https URL.');
    if (deepLink && !/^\//.test(deepLink) && !/^https:\/\//.test(deepLink)) {
      throw badRequest('deepLink must be an app path (/lectures/…) or an https URL.');
    }
    if (targetType !== 'all' && !targetValue) throw badRequest('Select a target for this audience.');
    if (targetType === 'class' && !UUID_RE.test(targetValue!)) throw badRequest('Invalid class id.');
    if (targetType === 'exam_type' && !UUID_RE.test(targetValue!)) throw badRequest('Invalid exam type id.');
    if (targetType === 'course' && !UUID_RE.test(targetValue!)) throw badRequest('Invalid course id.');
    if (targetType === 'user' && !UUID_RE.test(targetValue!)) throw badRequest('Invalid user id.');

    const id = newId();
    const isScheduled = Boolean(scheduledAt && Date.parse(scheduledAt) > Date.now() + 30_000);

    await ctx.env.DB.prepare(
      `INSERT INTO notifications (id, title, body, image_url, deep_link, target_type, target_value, status, scheduled_at, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
    )
      .bind(
        id,
        title,
        message,
        imageUrl ?? null,
        deepLink ?? null,
        targetType,
        targetValue ?? null,
        isScheduled ? 'scheduled' : 'sending',
        isScheduled ? scheduledAt! : null,
        auth.user.id,
        nowIso(),
      )
      .run();

    if (isScheduled) {
      await writeAudit(ctx.env, ctx.request, auth, {
        action: 'notification.schedule',
        entityType: 'notification',
        entityId: id,
        after: { title, targetType, scheduledAt },
      });
      return json({ id, status: 'scheduled', scheduledAt });
    }

    // Send now.
    let result;
    try {
      result = await sendPush(ctx.env, {
        title,
        body: message,
        imageUrl,
        deepLink,
        audience: { targetType, targetValue: targetValue ?? null },
      });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      await ctx.env.DB.prepare("UPDATE notifications SET status = 'failed', error_message = ?2, sent_at = ?3 WHERE id = ?1")
        .bind(id, messageText.slice(0, 500), nowIso())
        .run();
      await writeAudit(ctx.env, ctx.request, auth, {
        action: 'notification.send',
        entityType: 'notification',
        entityId: id,
        status: 'failure',
        meta: { error: messageText },
      });
      return json({ id, status: 'failed', error: messageText }, { status: 502 });
    }

    const finalStatus = result.success > 0 ? 'sent' : result.tokens === 0 ? 'sent' : 'failed';
    await ctx.env.DB.prepare(
      `UPDATE notifications SET status = ?2, sent_at = ?3, success_count = ?4, failed_count = ?5, delivered_count = ?4,
         error_message = ?6 WHERE id = ?1`,
    )
      .bind(id, finalStatus, nowIso(), result.success, result.failed, result.error ?? null)
      .run();

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'notification.send',
      entityType: 'notification',
      entityId: id,
      status: result.error ? 'failure' : 'success',
      meta: { title, recipients: result.attempted, devices: result.tokens, success: result.success, failed: result.failed },
    });

    return json({
      id,
      status: finalStatus,
      recipients: result.attempted,
      devices: result.tokens,
      success: result.success,
      failed: result.failed,
      fcmConfigured: result.configured,
      warning: result.error,
    });
  });

  // ===================== ANNOUNCEMENTS ====================================
  router.get('/api/admin/announcements', async (ctx) => {
    await requirePermission(ctx, 'announcements.manage');
    const page = parsePage(ctx.url, { pageSize: 25 });
    const [count, rows] = await Promise.all([
      ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM announcements').first<{ n: number }>(),
      ctx.env.DB.prepare(
        `SELECT a.*, cl.name AS className, et.name AS examTypeName
           FROM announcements a
           LEFT JOIN classes cl ON cl.id = a.class_id
           LEFT JOIN exam_types et ON et.id = a.exam_type_id
          ORDER BY a.created_at DESC LIMIT ?1 OFFSET ?2`,
      )
        .bind(page.pageSize, page.offset)
        .all<Record<string, unknown>>(),
    ]);
    return json(
      paginated(
        (rows.results ?? []).map((r) => ({ ...r, isPinned: Boolean(r.isPinned) })),
        Number(count?.n ?? 0),
        page,
      ),
    );
  });

  router.post('/api/admin/announcements', async (ctx) => {
    const auth = await requirePermission(ctx, 'announcements.manage');
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { required: true, max: 200 })!;
    const bodyText = v.string('body', { required: true, max: 5000 })!;
    const imageUrl = v.string('imageUrl', { max: 512 });
    const linkUrl = v.string('linkUrl', { max: 512 });
    const priority = v.enum('priority', ['low', 'normal', 'high', 'urgent'] as const, { fallback: 'normal' })!;
    const isPinned = v.boolean('isPinned', false)!;
    const targetAudience = v.enum('target_audience' as never, ['all', 'class', 'exam_type', 'course', 'selected'] as never, { fallback: 'all' }) ?? 'all';
    const classId = v.string('classId', { max: 64 });
    const examTypeId = v.string('examTypeId', { max: 64 });
    const publishAt = v.timestamp('publishAt');
    const expiresAt = v.timestamp('expiresAt');
    const status = v.enum('status', ['draft', 'published', 'archived'] as const, { fallback: 'published' })!;
    v.throwIfInvalid();

    const id = newId();
    await ctx.env.DB.prepare(
      `INSERT INTO announcements (id, title, body, image_url, link_url, target_audience, class_id, exam_type_id, priority,
          is_pinned, status, publish_at, expires_at, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)`,
    )
      .bind(
        id,
        title,
        bodyText,
        imageUrl ?? null,
        linkUrl ?? null,
        targetAudience,
        classId ?? null,
        examTypeId ?? null,
        priority,
        isPinned ? 1 : 0,
        status,
        publishAt ?? null,
        expiresAt ?? null,
        auth.user.id,
        nowIso(),
      )
      .run();

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'announcement.create',
      entityType: 'announcement',
      entityId: id,
      after: { title, status },
    });
    return json({ id }, { status: 201 });
  });

  router.put('/api/admin/announcements/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'announcements.manage');
    const id = ctx.params.id;
    const existing = await ctx.env.DB.prepare('SELECT id FROM announcements WHERE id = ?1').bind(id).first();
    if (!existing) throw notFound('Announcement not found.');

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const title = v.string('title', { max: 200 });
    const bodyText = v.string('body', { max: 5000 });
    const imageUrl = v.string('imageUrl', { max: 512 });
    const linkUrl = v.string('linkUrl', { max: 512 });
    const priority = v.enum('priority', ['low', 'normal', 'high', 'urgent'] as const);
    const isPinned = v.boolean('isPinned');
    const status = v.enum('status', ['draft', 'published', 'archived'] as const);
    const publishAt = v.timestamp('publishAt');
    const expiresAt = v.timestamp('expiresAt');
    v.throwIfInvalid();

    const fields: Record<string, unknown> = {
      title: title ?? undefined,
      body: bodyText ?? undefined,
      image_url: imageUrl ?? undefined,
      link_url: linkUrl ?? undefined,
      priority: priority ?? undefined,
      is_pinned: isPinned === undefined ? undefined : isPinned ? 1 : 0,
      status: status ?? undefined,
      publish_at: publishAt === undefined ? undefined : publishAt,
      expires_at: expiresAt === undefined ? undefined : expiresAt,
    };
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (keys.length) {
      await ctx.env.DB.prepare(`UPDATE announcements SET ${keys.map((k, i) => `${k} = ?${i + 2}`).join(', ')} WHERE id = ?1`)
        .bind(id, ...keys.map((k) => fields[k]))
        .run();
    }
    await writeAudit(ctx.env, ctx.request, auth, { action: 'announcement.update', entityType: 'announcement', entityId: id });
    return json({ ok: true });
  });

  router.delete('/api/admin/announcements/:id', async (ctx) => {
    const auth = await requirePermission(ctx, 'announcements.manage');
    await ctx.env.DB.prepare('DELETE FROM announcements WHERE id = ?1').bind(ctx.params.id).run();
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'announcement.delete',
      entityType: 'announcement',
      entityId: ctx.params.id,
    });
    return json({ ok: true });
  });
}
