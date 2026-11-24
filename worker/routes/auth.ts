// =============================================================================
// Authentication + student profile routes
// =============================================================================
//  POST /api/auth/verify      exchange a signed-in session for a server session
//  GET  /api/auth/me          current session, roles and permissions
//  GET  /api/auth/config      public bootstrap config (no secrets)
//  PUT  /api/auth/profile     update student profile / goals
//  POST /api/auth/onboarding  complete onboarding
//  POST /api/auth/logout      audit logout (token revocation is client-side)
//  POST /api/auth/dev-login   development-only sign-in (see dev-auth.ts)
//  DELETE /api/auth/account   GDPR-style account erasure of personal data
// =============================================================================

import type { RouteCtx } from '../env';
import type { Router } from '../lib/router';
import { badRequest, json, notFound, readJson, Validator } from '../lib/http';
import { requireAuth, sessionPayload, mapProfile } from '../services/session';
import { devAuthEnabled, signDevToken } from '../services/dev-auth';
import { RATE_LIMITS, enforceRateLimit, clientIdentity } from '../lib/rate-limit';
import { writeAudit } from '../lib/audit';
import { newId, nowIso } from '../lib/util';

async function publicSettingMap(ctx: RouteCtx): Promise<Record<string, string>> {
  try {
    const rows = await ctx.env.DB.prepare(
      'SELECT key, value FROM platform_settings WHERE is_public = 1',
    ).all<{ key: string; value: string }>();
    const map: Record<string, string> = {};
    for (const row of rows.results ?? []) map[row.key] = row.value;
    return map;
  } catch {
    return {};
  }
}

export function registerAuthRoutes(router: Router): void {
  // ---- Public bootstrap config ---------------------------------------------
  router.get('/api/auth/config', async (ctx) => {
    const settings = await publicSettingMap(ctx);
    return json({
      siteName: settings['site.name'] ?? ctx.env.APP_NAME ?? 'PrepSetu',
      tagline: settings['site.tagline'] ?? '',
      supportEmail: settings['site.support_email'] ?? '',
      maintenanceMode: settings['site.maintenance_mode'] === 'true',
      registrationOpen: settings['features.registration_open'] !== 'false',
      googleSignIn: settings['features.google_signin'] !== 'false',
      pushNotifications: settings['features.push_notifications'] !== 'false',
      testPaperDownloads: settings['features.test_paper_downloads'] !== 'false',
      vapidKey: settings['push.vapid_key'] ?? null,
      firebaseProjectId: ctx.env.FIREBASE_PROJECT_ID ?? 'rankup29',
      superAdminEmail: ctx.env.SUPER_ADMIN_EMAIL ?? null,
      // Development-only flags. Never true in a production deployment.
      devAuthEnabled: devAuthEnabled(ctx.env),
      authMode: devAuthEnabled(ctx.env) ? 'development' : 'firebase',
    });
  });

  // ---- Exchange an authenticated client session for server context ---------
  router.post('/api/auth/verify', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.authVerify, clientIdentity(ctx.request, auth.user.id));
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'auth.verify',
      entityType: 'user',
      entityId: auth.user.id,
      status: 'success',
    });
    return json({ user: sessionPayload(auth), serverTime: nowIso() });
  });

  router.get('/api/auth/me', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.authMe, clientIdentity(ctx.request, auth.user.id));

    // Touch activity for active-student analytics (best effort).
    ctx.ctx.waitUntil(
      ctx.env.DB.prepare('UPDATE user_profiles SET last_active_at = ?2 WHERE user_id = ?1')
        .bind(auth.user.id, nowIso())
        .run()
        .catch(() => undefined),
    );

    return json({ user: sessionPayload(auth), serverTime: nowIso() });
  });

  // ---- Profile -------------------------------------------------------------
  router.put('/api/auth/profile', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));
    const body = await readJson(ctx.request);
    const v = new Validator(body);

    const fullName = v.string('fullName', { max: 120 });
    const city = v.string('city', { max: 80 });
    const state = v.string('state', { max: 80 });
    const school = v.string('school', { max: 160 });
    const bio = v.string('bio', { max: 500 });
    const language = v.enum('language', ['en', 'hi'] as const, { fallback: 'en' });
    const classId = v.string('classId', { max: 64 });
    const targetExamTypeId = v.string('targetExamTypeId', { max: 64 });
    const studyGoalMinutes = v.number('studyGoalMinutes', { min: 5, max: 1440, integer: true });
    const avatarUrl = v.string('avatarUrl', { max: 512 });
    const notificationPrefs = body.notificationPrefs as Record<string, unknown> | undefined;
    v.throwIfInvalid();

    if (avatarUrl && !/^https:\/\//.test(avatarUrl)) v.fail('avatarUrl', 'Must be an https URL.');
    if (notificationPrefs !== undefined && (typeof notificationPrefs !== 'object' || Array.isArray(notificationPrefs))) {
      v.fail('notificationPrefs', 'Must be an object.');
    }
    v.throwIfInvalid();

    if (classId) {
      const exists = await ctx.env.DB.prepare('SELECT id FROM classes WHERE id = ?1 AND is_active = 1').bind(classId).first();
      if (!exists) throw badRequest('Selected class does not exist.', [{ field: 'classId', message: 'Unknown class.' }]);
    }
    if (targetExamTypeId) {
      const exists = await ctx.env.DB.prepare('SELECT id FROM exam_types WHERE id = ?1 AND is_active = 1')
        .bind(targetExamTypeId)
        .first();
      if (!exists) throw badRequest('Selected goal does not exist.', [{ field: 'targetExamTypeId', message: 'Unknown exam type.' }]);
    }

    const prefs = notificationPrefs
      ? JSON.stringify({
          push: Boolean(notificationPrefs.push),
          email: Boolean(notificationPrefs.email),
          examReminders: Boolean(notificationPrefs.examReminders),
          newContent: Boolean(notificationPrefs.newContent),
        })
      : null;

    await ctx.env.DB.prepare(
      `UPDATE user_profiles SET
         full_name = COALESCE(?2, full_name),
         city = COALESCE(?3, city),
         state = COALESCE(?4, state),
         school = COALESCE(?5, school),
         bio = COALESCE(?6, bio),
         language = COALESCE(?7, language),
         study_goal_minutes = COALESCE(?8, study_goal_minutes),
         avatar_url = COALESCE(?9, avatar_url),
         notification_prefs = COALESCE(?10, notification_prefs),
         class_id = COALESCE(?11, class_id),
         target_exam_type_id = COALESCE(?12, target_exam_type_id)
       WHERE user_id = ?1`,
    )
      .bind(
        auth.user.id,
        fullName ?? null,
        city ?? null,
        state ?? null,
        school ?? null,
        bio ?? null,
        language ?? null,
        studyGoalMinutes ?? null,
        avatarUrl ?? null,
        prefs,
        classId ?? null,
        targetExamTypeId ?? null,
      )
      .run();

    if (fullName) {
      await ctx.env.DB.prepare('UPDATE users SET display_name = ?2 WHERE id = ?1').bind(auth.user.id, fullName).run();
    }

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'profile.update',
      entityType: 'user',
      entityId: auth.user.id,
    });

    const fresh = await requireAuth({ ...ctx, auth: undefined });
    return json({ user: sessionPayload(fresh) });
  });

  router.post('/api/auth/onboarding', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));
    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const fullName = v.string('fullName', { required: true, max: 120 });
    const classId = v.string('classId', { required: true, max: 64 });
    const targetExamTypeId = v.string('targetExamTypeId', { required: true, max: 64 });
    const studyGoalMinutes = v.number('studyGoalMinutes', { min: 5, max: 1440, integer: true, required: true });
    v.throwIfInvalid();

    const [cls, examType] = await ctx.env.DB.batch([
      ctx.env.DB.prepare('SELECT id FROM classes WHERE id = ?1 AND is_active = 1').bind(classId!),
      ctx.env.DB.prepare('SELECT id FROM exam_types WHERE id = ?1 AND is_active = 1').bind(targetExamTypeId!),
    ]);
    if (!cls.results?.length) throw badRequest('Selected class does not exist.');
    if (!examType.results?.length) throw badRequest('Selected goal does not exist.');

    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `UPDATE user_profiles SET full_name = ?2, class_id = ?3, target_exam_type_id = ?4,
                study_goal_minutes = ?5, onboarding_completed = 1
          WHERE user_id = ?1`,
      ).bind(auth.user.id, fullName!, classId!, targetExamTypeId!, studyGoalMinutes!),
      ctx.env.DB.prepare('UPDATE users SET display_name = ?2 WHERE id = ?1').bind(auth.user.id, fullName!),
    ]);

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'profile.onboarding_completed',
      entityType: 'user',
      entityId: auth.user.id,
      meta: { classId, targetExamTypeId },
    });

    const fresh = await requireAuth({ ...ctx, auth: undefined });
    return json({ user: sessionPayload(fresh) });
  });

  // ---- Logout (audit only; Firebase tokens are expired client-side) --------
  router.post('/api/auth/logout', async (ctx) => {
    const auth = await requireAuth(ctx);
    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'auth.logout',
      entityType: 'user',
      entityId: auth.user.id,
    });
    return json({ ok: true });
  });

  // ---- Account erasure (student data) --------------------------------------
  router.delete('/api/auth/account', async (ctx) => {
    const auth = await requireAuth(ctx);
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));
    const body = await readJson(ctx.request);
    if (body.confirm !== 'DELETE') throw badRequest('Type DELETE to confirm account deletion.');

    await ctx.env.DB.batch([
      ctx.env.DB.prepare('DELETE FROM notification_tokens WHERE user_id = ?1').bind(auth.user.id),
      ctx.env.DB.prepare('DELETE FROM bookmarks WHERE user_id = ?1').bind(auth.user.id),
      ctx.env.DB.prepare('DELETE FROM lecture_progress WHERE user_id = ?1').bind(auth.user.id),
      // Exam attempts + results are retained for academic-record integrity but
      // detached from the profile; personal data is removed below.
      ctx.env.DB.prepare('UPDATE user_profiles SET full_name = NULL, city = NULL, state = NULL, school = NULL, bio = NULL, avatar_url = NULL WHERE user_id = ?1').bind(auth.user.id),
      ctx.env.DB.prepare("UPDATE users SET status = 'deleted', email = 'deleted+' || id || '@prepsetu.invalid', display_name = NULL, photo_url = NULL WHERE id = ?1").bind(auth.user.id),
      ctx.env.DB.prepare('UPDATE user_roles SET is_active = 0, revoked_at = ?2 WHERE user_id = ?1').bind(auth.user.id, nowIso()),
    ]);

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'account.deleted',
      entityType: 'user',
      entityId: auth.user.id,
      status: 'success',
    });
    return json({ ok: true });
  });

  // ---- Development sign-in -------------------------------------------------
  router.post('/api/auth/dev-login', async (ctx) => {
    if (!devAuthEnabled(ctx.env)) throw notFound('Not found.');

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const email = v.email('email', { required: true })!;
    const name = v.string('name', { max: 120 });
    v.throwIfInvalid();

    await enforceRateLimit(ctx.env, RATE_LIMITS.authVerify, clientIdentity(ctx.request));

    const existing = await ctx.env.DB.prepare('SELECT id, status FROM users WHERE lower(email) = ?1')
      .bind(email)
      .first<{ id: string; status: string }>();
    if (existing?.status === 'suspended') throw badRequest('This account is suspended.');

    let userId = existing?.id;
    if (!userId) {
      userId = `dev_${newId()}`;
      const ts = nowIso();
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(
          `INSERT INTO users (id, email, email_verified, display_name, auth_provider, status, last_login_at, created_at, updated_at)
           VALUES (?1, ?2, 1, ?3, 'dev', 'active', ?4, ?4, ?4)`,
        ).bind(userId, email, name ?? email.split('@')[0], ts),
        ctx.env.DB.prepare(
          `INSERT INTO user_profiles (user_id, full_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)`,
        ).bind(userId, name ?? email.split('@')[0], ts),
      ]);
    }

    const token = await signDevToken(ctx.env, { id: userId, email, name });
    await writeAudit(ctx.env, ctx.request, undefined, {
      action: 'auth.dev_login',
      entityType: 'user',
      entityId: userId,
      meta: { email },
    });
    return json({ token: token.token, expiresAt: token.expiresAt });
  });
}

export { mapProfile };
