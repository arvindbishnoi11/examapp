// =============================================================================
// Session resolution + authorization
// =============================================================================
// Flow:  Authorization: Bearer <Firebase ID token>
//   → verify signature/claims (firebase-auth.ts)
//   → upsert the user row (profile created on first sign-in)
//   → load roles + permission overrides + profile in ONE batch
//   → requirePermission(...) guards every privileged route.
//
// Privilege-escalation defences:
//   * roles are read from D1, never from client-supplied claims
//   * only the super admin may create/promote administrators
//   * nobody can suspend, delete or demote themselves
//   * the super-admin mailbox is bound by SUPER_ADMIN_EMAIL on the server
//   * an explicit override can deny a permission granted by a role
// =============================================================================

import type { AuthContext, Env, RouteCtx } from '../env';
import { forbidden, HttpError, unauthorized } from '../lib/http';
import { newId, nowIso } from '../lib/util';
import { verifyFirebaseIdToken, providerFromPayload } from './firebase-auth';
import { isDevToken, verifyDevToken } from './dev-auth';

export const SUPER_ADMIN_ROLE_ID = 'role_super_admin';

type UserRow = {
  id: string;
  email: string;
  email_verified: number;
  display_name: string | null;
  photo_url: string | null;
  status: 'active' | 'suspended' | 'deleted';
  auth_provider: string;
  last_login_at: string | null;
};

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 20 ? token : null;
}

function isSuperAdminEmail(env: Env, email: string | null | undefined): boolean {
  const configured = (env.SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!configured || !email) return false;
  return email.toLowerCase() === configured;
}

export async function loadPermissions(env: Env, userId: string, roles: string[], superAdmin: boolean): Promise<Set<string>> {
  if (superAdmin) {
    const all = await env.DB.prepare('SELECT key FROM permissions').all<{ key: string }>();
    return new Set((all.results ?? []).map((r) => r.key));
  }
  if (!roles.length) return new Set();

  const placeholders = roles.map((_, i) => `?${i + 1}`).join(',');
  const [fromRoles, overrides] = await env.DB.batch<{ key: string }>([
    env.DB.prepare(
      `SELECT DISTINCT rp.permission_key AS key
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
        WHERE r.key IN (${placeholders})`,
    ).bind(...roles),
    env.DB.prepare(
      `SELECT permission_key AS key FROM user_permission_overrides
        WHERE user_id = ?1 AND granted = 1`,
    ).bind(userId),
  ]);

  const permissions = new Set<string>();
  for (const row of fromRoles.results ?? []) permissions.add(row.key);
  for (const row of overrides.results ?? []) permissions.add(row.key);

  // Explicit denials win over role grants.
  const denials = await env.DB.prepare(
    'SELECT permission_key AS key FROM user_permission_overrides WHERE user_id = ?1 AND granted = 0',
  )
    .bind(userId)
    .all<{ key: string }>();
  for (const row of denials.results ?? []) permissions.delete(row.key);

  return permissions;
}

async function loadProfile(env: Env, userId: string) {
  return env.DB.prepare(
    `SELECT full_name AS fullName, class_id AS classId, target_exam_type_id AS targetExamTypeId,
            city, state, school, bio, language, avatar_url AS avatarUrl,
            onboarding_completed AS onboardingCompleted, notification_prefs AS notificationPrefs,
            study_goal_minutes AS studyGoalMinutes, streak_days AS streakDays
       FROM user_profiles WHERE user_id = ?1`,
  )
    .bind(userId)
    .first<Record<string, unknown>>();
}

function mapProfile(row: Record<string, unknown> | null) {
  if (!row) return null;
  let prefs = { push: true, email: true, examReminders: true, newContent: true };
  try {
    prefs = { ...prefs, ...(JSON.parse(String(row.notificationPrefs ?? '{}')) as typeof prefs) };
  } catch {
    /* default */
  }
  return {
    fullName: (row.fullName as string) ?? null,
    classId: (row.classId as string) ?? null,
    targetExamTypeId: (row.targetExamTypeId as string) ?? null,
    city: (row.city as string) ?? null,
    state: (row.state as string) ?? null,
    school: (row.school as string) ?? null,
    bio: (row.bio as string) ?? null,
    language: (row.language as string) ?? 'en',
    avatarUrl: (row.avatarUrl as string) ?? null,
    onboardingCompleted: Boolean(row.onboardingCompleted),
    notificationPrefs: prefs,
    studyGoalMinutes: Number(row.studyGoalMinutes ?? 60),
    streakDays: Number(row.streakDays ?? 0),
  };
}

/**
 * Upserts the user on every authenticated request (cheap, idempotent) and
 * enforces the server-bound super-admin mailbox.
 */
async function upsertUser(env: Env, payload: {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  provider: string;
}): Promise<UserRow> {
  const email = (payload.email ?? '').toLowerCase();
  if (!email) throw new HttpError(401, 'email_required', 'Your account has no email address.');

  const superAdminEmail = isSuperAdminEmail(env, email);
  const existing = await env.DB.prepare(
    'SELECT id, email, email_verified, display_name, photo_url, status, auth_provider, last_login_at FROM users WHERE id = ?1',
  )
    .bind(payload.sub)
    .first<UserRow>();

  // Guard: a *different* account claiming the super-admin mailbox cannot
  // overwrite the bound super admin (identity is verified by Firebase).
  if (!existing) {
    const emailOwner = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?1 AND id != ?2')
      .bind(email, payload.sub)
      .first<{ id: string }>();
    if (emailOwner) {
      throw new HttpError(
        409,
        'email_in_use',
        'An account with this email already exists. Please sign in with the original method.',
      );
    }
  }

  if (existing?.status === 'suspended') {
    throw new HttpError(403, 'account_suspended', 'Your account has been suspended. Please contact support.');
  }
  if (existing?.status === 'deleted') {
    throw new HttpError(403, 'account_deleted', 'This account is no longer active.');
  }

  const ts = nowIso();

  if (!existing) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, email_verified, display_name, photo_url, auth_provider, status, last_login_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7, ?7)`,
      ).bind(payload.sub, email, payload.email_verified ? 1 : 0, payload.name ?? null, payload.picture ?? null, payload.provider, ts),
      env.DB.prepare(
        `INSERT INTO user_profiles (user_id, full_name, avatar_url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)`,
      ).bind(payload.sub, payload.name ?? null, payload.picture ?? null, ts),
    ]);
  } else {
    await env.DB.prepare(
      `UPDATE users
          SET email = ?2, email_verified = ?3, display_name = COALESCE(?4, display_name),
              photo_url = COALESCE(?5, photo_url), auth_provider = ?6, last_login_at = ?7
        WHERE id = ?1`,
    )
      .bind(payload.sub, email, payload.email_verified ? 1 : 0, payload.name ?? null, payload.picture ?? null, payload.provider, ts)
      .run();
  }

  // ---- Super-admin bootstrap ------------------------------------------------
  // The first successful sign-in of the mailbox bound in SUPER_ADMIN_EMAIL is
  // promoted server-side. No API can grant the super-admin role to anyone else.
  if (superAdminEmail) {
    const role = await env.DB.prepare('SELECT is_active FROM user_roles WHERE user_id = ?1 AND role_id = ?2')
      .bind(payload.sub, SUPER_ADMIN_ROLE_ID)
      .first<{ is_active: number }>();
    if (!role) {
      await env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, is_active, granted_by, granted_at)
         VALUES (?1, ?2, ?3, 1, NULL, ?4)
         ON CONFLICT(user_id, role_id) DO UPDATE SET is_active = 1, revoked_at = NULL`,
      )
        .bind(newId(), payload.sub, SUPER_ADMIN_ROLE_ID, ts)
        .run();
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, actor_email, action, entity_type, entity_id, status, meta_json, created_at)
         VALUES (?1, ?2, ?3, 'auth.super_admin_bootstrapped', 'user', ?2, 'success', ?4, ?5)`,
      )
        .bind(newId(), payload.sub, email, JSON.stringify({ reason: 'SUPER_ADMIN_EMAIL match' }), ts)
        .run();
    } else if (!role.is_active) {
      // A deactivated super admin is re-activated on their own sign-in; an
      // attacker cannot use this because they cannot obtain that mailbox's token.
      await env.DB.prepare('UPDATE user_roles SET is_active = 1, revoked_at = NULL WHERE user_id = ?1 AND role_id = ?2')
        .bind(payload.sub, SUPER_ADMIN_ROLE_ID)
        .run();
    }
  }

  const fresh = await env.DB.prepare(
    'SELECT id, email, email_verified, display_name, photo_url, status, auth_provider, last_login_at FROM users WHERE id = ?1',
  )
    .bind(payload.sub)
    .first<UserRow>();
  if (!fresh) throw new HttpError(500, 'user_upsert_failed', 'Unable to create your account.');
  return fresh;
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext> {
  const token = bearerToken(request);
  if (!token) throw unauthorized();

  let payload: {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  let provider: string;

  if (isDevToken(token)) {
    // Development-only path; verifyDevToken() refuses to work in production.
    const dev = await verifyDevToken(env, token);
    payload = { sub: dev.sub, email: dev.email, email_verified: true, name: dev.name };
    provider = 'dev';
  } else {
    const verified = await verifyFirebaseIdToken(env, token);
    payload = verified.payload;
    provider = providerFromPayload(verified.payload);
  }

  const user = await upsertUser(env, {
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified,
    name: payload.name,
    picture: payload.picture,
    provider,
  });

  const rolesResult = await env.DB.prepare(
    `SELECT r.key AS key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?1 AND ur.is_active = 1
        AND (ur.expires_at IS NULL OR ur.expires_at > ?2)`,
  )
    .bind(user.id, nowIso())
    .all<{ key: string }>();

  const roles = (rolesResult.results ?? []).map((r) => r.key);
  const isSuperAdmin = roles.includes('super_admin') || isSuperAdminEmail(env, user.email);
  const permissions = await loadPermissions(env, user.id, roles, isSuperAdmin);
  const profile = await loadProfile(env, user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerified: Boolean(user.email_verified),
      displayName: user.display_name,
      photoUrl: user.photo_url,
      status: user.status,
      authProvider: user.auth_provider,
    },
    roles,
    permissions,
    isSuperAdmin,
    isStaff: roles.some((r) => r !== 'student'),
    profile: profile as Record<string, unknown> | null,
  };
}

/** Resolves the session once per request and caches it on ctx. */
export async function requireAuth(ctx: RouteCtx): Promise<AuthContext> {
  if (ctx.auth) return ctx.auth;
  ctx.auth = await authenticate(ctx.request, ctx.env);
  return ctx.auth;
}

export async function optionalAuth(ctx: RouteCtx): Promise<AuthContext | null> {
  if (ctx.auth) return ctx.auth;
  if (!bearerToken(ctx.request)) return null;
  try {
    ctx.auth = await authenticate(ctx.request, ctx.env);
    return ctx.auth;
  } catch {
    return null;
  }
}

export function assertPermission(auth: AuthContext, permission: string): void {
  if (auth.isSuperAdmin) return;
  if (!auth.permissions.has(permission)) {
    throw forbidden(`Missing permission: ${permission}`);
  }
}

export async function requirePermission(ctx: RouteCtx, permission: string): Promise<AuthContext> {
  const auth = await requireAuth(ctx);
  assertPermission(auth, permission);
  return auth;
}

export async function requireAnyPermission(ctx: RouteCtx, permissions: string[]): Promise<AuthContext> {
  const auth = await requireAuth(ctx);
  if (auth.isSuperAdmin) return auth;
  if (!permissions.some((p) => auth.permissions.has(p))) {
    throw forbidden(`Missing permission: one of ${permissions.join(', ')}`);
  }
  return auth;
}

export function requireSuperAdmin(auth: AuthContext): void {
  if (!auth.isSuperAdmin) throw forbidden('Only the Super Admin can perform this action.');
}

export function sessionPayload(auth: AuthContext) {
  return {
    id: auth.user.id,
    email: auth.user.email,
    emailVerified: auth.user.emailVerified,
    displayName: auth.user.displayName,
    photoUrl: auth.user.photoUrl,
    status: auth.user.status,
    roles: auth.roles,
    permissions: Array.from(auth.permissions).sort(),
    isStaff: auth.isStaff,
    isSuperAdmin: auth.isSuperAdmin,
    profile: mapProfile(auth.profile),
  };
}

export { mapProfile };
