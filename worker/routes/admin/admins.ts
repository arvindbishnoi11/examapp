// =============================================================================
// Admin management — the most security-sensitive surface in PrepSetu
// =============================================================================
// Rules enforced server-side (never only in the UI):
//   * Only the Super Admin may create administrators, grant/revoke staff roles,
//     grant individual permissions, or touch another super admin.
//   * Nobody may grant themselves a role or permission.
//   * The super-admin role can only ever be held by SUPER_ADMIN_EMAIL; it can
//     never be assigned through the API.
//   * A staff member cannot suspend/remove the last active super admin, or an
//     account whose role outranks their own.
//   * Every change is audited before/after.
// =============================================================================

import type { Router } from '../../lib/router';
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
} from '../../lib/http';
import { requireAnyPermission, requirePermission, requireSuperAdmin, requireAuth } from '../../services/session';
import { writeAudit } from '../../lib/audit';
import { isPermissionKey, PERMISSION_KEYS, ROLE_LEVEL } from '../../../shared/permissions';
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { likePattern, newId, nowIso } from '../../lib/util';

const SUPER_ADMIN_ROLE_ID = 'role_super_admin';

async function roleByKey(env: { DB: D1Database }, key: string) {
  return env.DB.prepare('SELECT id, key, name, level FROM roles WHERE key = ?1').bind(key).first<{ id: string; key: string; name: string; level: number }>();
}

async function staffList(env: { DB: D1Database }) {
  const rows = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name AS displayName, u.status, u.created_at AS createdAt,
            u.last_login_at AS lastLoginAt, u.auth_provider AS authProvider,
            COALESCE((SELECT group_concat(r.name, ', ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND ur.is_active = 1), 'No role') AS roleNames,
            COALESCE((SELECT group_concat(r.key, ',') FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND ur.is_active = 1), '') AS roleKeys,
            (SELECT MAX(r.level) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id AND ur.is_active = 1) AS maxLevel
       FROM users u
      WHERE EXISTS (SELECT 1 FROM user_roles ur2 JOIN roles r2 ON r2.id = ur2.role_id
                     WHERE ur2.user_id = u.id AND ur2.is_active = 1 AND r2.key != 'student')
      ORDER BY maxLevel DESC, u.created_at ASC`,
  ).all<Record<string, unknown>>();
  return (rows.results ?? []).map((r) => ({
    ...r,
    roles: String(r.roleKeys ?? '').split(',').filter(Boolean),
  }));
}

export function registerAdminAdminRoutes(router: Router): void {
  // ---- List administrators -------------------------------------------------
  router.get('/api/admin/admins', async (ctx) => {
    const auth = await requireAnyPermission(ctx, ['admins.view', 'admins.create']);
    return json({
      items: await staffList(ctx.env),
      canManage: auth.isSuperAdmin,
      superAdminEmail: ctx.env.SUPER_ADMIN_EMAIL ?? null,
    });
  });

  router.get('/api/admin/admins/roles', async (ctx) => {
    await requireAnyPermission(ctx, ['admins.view', 'admins.create']);
    const [roles, mapping] = await Promise.all([
      ctx.env.DB.prepare(
        `SELECT id, key, name, description, level,
                (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = roles.id AND ur.is_active = 1) AS memberCount
           FROM roles ORDER BY level DESC`,
      ).all<Record<string, unknown>>(),
      ctx.env.DB.prepare('SELECT role_id AS roleId, permission_key AS permissionKey FROM role_permissions').all<{
        roleId: string;
        permissionKey: string;
      }>(),
    ]);
    return json({
      roles: roles.results ?? [],
      rolePermissions: mapping.results ?? [],
      permissionKeys: PERMISSION_KEYS,
    });
  });

  // ---- Promote an existing user to staff -----------------------------------
  router.post('/api/admin/users', async (ctx) => {
    const auth = await requireAuth(ctx);
    requireSuperAdmin(auth);
    await enforceRateLimit(ctx.env, RATE_LIMITS.write, clientIdentity(ctx.request, auth.user.id));
    await requirePermission(ctx, 'admins.create');

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const email = v.email('email', { required: true })!;
    const roleKey = v.string('roleKey', { required: true, max: 40 })!;
    const displayName = v.string('displayName', { max: 120 });
    v.throwIfInvalid();

    const role = await roleByKey(ctx.env, roleKey);
    if (!role) throw badRequest('Unknown role.');
    if (role.key === 'super_admin') {
      throw forbidden('The Super Admin role cannot be assigned through the API. It is bound to SUPER_ADMIN_EMAIL.');
    }
    if (role.key === 'student') throw badRequest('Use /api/admin/users/:id/role/revoke to remove staff access.');

    const target = await ctx.env.DB.prepare('SELECT id, email, status FROM users WHERE lower(email) = ?1')
      .bind(email)
      .first<{ id: string; email: string; status: string }>();
    if (!target) {
      throw notFound(
        'No account exists for that email. The person must sign in to PrepSetu once before they can be promoted to an administrator.',
      );
    }
    if (target.status !== 'active') throw conflict('That account is not active.');
    if (target.id === auth.user.id) throw forbidden('You cannot change your own roles.');

    const existing = await ctx.env.DB.prepare('SELECT id, is_active FROM user_roles WHERE user_id = ?1 AND role_id = ?2')
      .bind(target.id, role.id)
      .first<{ id: string; is_active: number }>();

    if (existing) {
      await ctx.env.DB.prepare('UPDATE user_roles SET is_active = 1, revoked_at = NULL, granted_by = ?2, granted_at = ?3 WHERE id = ?1')
        .bind(existing.id, auth.user.id, nowIso())
        .run();
    } else {
      await ctx.env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, is_active, granted_by, granted_at) VALUES (?1, ?2, ?3, 1, ?4, ?5)`,
      )
        .bind(newId(), target.id, role.id, auth.user.id, nowIso())
        .run();
    }

    if (displayName) {
      await ctx.env.DB.prepare('UPDATE users SET display_name = COALESCE(display_name, ?2) WHERE id = ?1')
        .bind(target.id, displayName)
        .run();
    }

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'admin.role_granted',
      entityType: 'user',
      entityId: target.id,
      after: { roleKey, email },
    });
    return json({ ok: true, user: { id: target.id, email: target.email, roleKey } });
  });

  // ---- Change a user's role ------------------------------------------------
  router.put('/api/admin/users/:id/role', async (ctx) => {
    const auth = await requireAuth(ctx);
    requireSuperAdmin(auth);
    await requirePermission(ctx, 'admins.edit');

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const roleKey = v.string('roleKey', { required: true, max: 40 })!;
    v.throwIfInvalid();

    if (ctx.params.id === auth.user.id) throw forbidden('You cannot change your own role.');
    if (roleKey === 'super_admin') throw forbidden('The Super Admin role cannot be assigned through the API.');

    const role = await roleByKey(ctx.env, roleKey);
    if (!role) throw badRequest('Unknown role.');
    if (role.key === 'student') throw badRequest('Use revoke to remove staff access.');

    const target = await ctx.env.DB.prepare('SELECT id, email FROM users WHERE id = ?1')
      .bind(ctx.params.id)
      .first<{ id: string; email: string }>();
    if (!target) throw notFound('User not found.');

    const currentRoles = await ctx.env.DB.prepare(
      `SELECT r.id, r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?1 AND ur.is_active = 1 AND r.key != 'student'`,
    )
      .bind(target.id)
      .all<{ id: string; key: string }>();

    if ((currentRoles.results ?? []).some((r) => r.key === 'super_admin')) {
      throw forbidden('Super Admin roles cannot be modified.');
    }

    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `UPDATE user_roles SET is_active = 0, revoked_at = ?2
          WHERE user_id = ?1 AND role_id != ?3 AND role_id IN (SELECT id FROM roles WHERE key != 'student')`,
      ).bind(target.id, nowIso(), role.id),
      ctx.env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, is_active, granted_by, granted_at) VALUES (?1, ?2, ?3, 1, ?4, ?5)
         ON CONFLICT(user_id, role_id) DO UPDATE SET is_active = 1, revoked_at = NULL, granted_by = ?4, granted_at = ?5`,
      ).bind(newId(), target.id, role.id, auth.user.id, nowIso()),
    ]);

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'admin.role_changed',
      entityType: 'user',
      entityId: target.id,
      before: { roles: (currentRoles.results ?? []).map((r) => r.key) },
      after: { roleKey },
    });
    return json({ ok: true });
  });

  // ---- Remove staff access -------------------------------------------------
  router.delete('/api/admin/users/:id/role', async (ctx) => {
    const auth = await requireAuth(ctx);
    requireSuperAdmin(auth);
    await requirePermission(ctx, 'admins.delete');

    if (ctx.params.id === auth.user.id) throw forbidden('You cannot remove your own staff access.');

    const target = await ctx.env.DB.prepare('SELECT id, email FROM users WHERE id = ?1')
      .bind(ctx.params.id)
      .first<{ id: string; email: string }>();
    if (!target) throw notFound('User not found.');

    const current = await ctx.env.DB.prepare(
      `SELECT r.id, r.key, r.level FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?1 AND ur.is_active = 1`,
    )
      .bind(target.id)
      .all<{ id: string; key: string; level: number }>();

    const list = current.results ?? [];
    if (list.some((r) => r.key === 'super_admin')) throw forbidden('The Super Admin account cannot be demoted through the API.');

    await ctx.env.DB.batch([
      ctx.env.DB.prepare('UPDATE user_roles SET is_active = 0, revoked_at = ?2 WHERE user_id = ?1').bind(target.id, nowIso()),
      ctx.env.DB.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?1').bind(target.id),
    ]);

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'admin.access_revoked',
      entityType: 'user',
      entityId: target.id,
      before: { roles: list.map((r) => r.key) },
      meta: { email: target.email },
    });
    return json({ ok: true });
  });

  // ---- Individual permission overrides ------------------------------------
  router.get('/api/admin/admins/:id/permissions', async (ctx) => {
    await requirePermission(ctx, 'admins.view');
    const user = await ctx.env.DB.prepare('SELECT id, email FROM users WHERE id = ?1')
      .bind(ctx.params.id)
      .first<{ id: string; email: string }>();
    if (!user) throw notFound('User not found.');

    const [roles, overrides] = await Promise.all([
      ctx.env.DB.prepare(
        `SELECT r.id, r.key, r.name, r.level FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = ?1 AND ur.is_active = 1`,
      )
        .bind(user.id)
        .all<Record<string, unknown>>(),
      ctx.env.DB.prepare('SELECT permission_key AS permissionKey, granted FROM user_permission_overrides WHERE user_id = ?1')
        .bind(user.id)
        .all<{ permissionKey: string; granted: number }>(),
    ]);

    return json({
      user,
      roles: roles.results ?? [],
      overrides: (overrides.results ?? []).map((o) => ({ permissionKey: o.permissionKey, granted: Boolean(o.granted) })),
    });
  });

  router.put('/api/admin/admins/:id/permissions', async (ctx) => {
    const auth = await requireAuth(ctx);
    requireSuperAdmin(auth);
    await requirePermission(ctx, 'admins.permissions');

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const overrides = v.array('overrides', { maxItems: 200 });
    v.throwIfInvalid();
    if (!overrides) throw badRequest('overrides array is required.');

    if (ctx.params.id === auth.user.id) throw forbidden('You cannot change your own permissions.');
    const target = await ctx.env.DB.prepare('SELECT id, email FROM users WHERE id = ?1')
      .bind(ctx.params.id)
      .first<{ id: string; email: string }>();
    if (!target) throw notFound('User not found.');

    const statements: D1PreparedStatement[] = [ctx.env.DB.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?1').bind(target.id)];
    for (const raw of overrides) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as { permissionKey?: unknown; granted?: unknown };
      const key = String(item.permissionKey ?? '');
      if (!isPermissionKey(key)) throw badRequest(`Unknown permission: ${key}`);
      const granted = item.granted === true || item.granted === 1 || item.granted === 'true';
      statements.push(
        ctx.env.DB.prepare(
          `INSERT INTO user_permission_overrides (user_id, permission_key, granted, granted_by) VALUES (?1, ?2, ?3, ?4)`,
        ).bind(target.id, key, granted ? 1 : 0, auth.user.id),
      );
    }
    await ctx.env.DB.batch(statements);

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'admin.permissions_changed',
      entityType: 'user',
      entityId: target.id,
      after: { overrides },
    });
    return json({ ok: true });
  });

  // ---- Role permission matrix (super admin edits what a role can do) -------
  router.put('/api/admin/roles/:roleId/permissions', async (ctx) => {
    const auth = await requireAuth(ctx);
    requireSuperAdmin(auth);
    await requirePermission(ctx, 'admins.permissions');

    const role = await ctx.env.DB.prepare('SELECT id, key FROM roles WHERE id = ?1')
      .bind(ctx.params.roleId)
      .first<{ id: string; key: string }>();
    if (!role) throw notFound('Role not found.');
    if (role.key === 'super_admin') throw forbidden('Super Admin permissions are fixed and cannot be edited.');

    const body = await readJson(ctx.request);
    const v = new Validator(body);
    const keys = v.array('permissions', { maxItems: 200 });
    v.throwIfInvalid();
    if (!keys) throw badRequest('permissions array is required.');

    const statements: D1PreparedStatement[] = [
      ctx.env.DB.prepare('DELETE FROM role_permissions WHERE role_id = ?1').bind(role.id),
    ];
    for (const raw of keys) {
      const key = String(raw);
      if (!isPermissionKey(key)) throw badRequest(`Unknown permission: ${key}`);
      statements.push(
        ctx.env.DB.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?1, ?2)').bind(role.id, key),
      );
    }
    await ctx.env.DB.batch(statements);

    await writeAudit(ctx.env, ctx.request, auth, {
      action: 'admin.role_permissions_changed',
      entityType: 'role',
      entityId: role.id,
      after: { permissions: keys },
    });
    return json({ ok: true });
  });

  // ---- Suspend / reactivate a staff account -------------------------------
  router.post('/api/admin/admins/:id/status', async (ctx) => {
    const auth = await requireAuth(ctx);
    requireSuperAdmin(auth);
    await requirePermission(ctx, 'admins.edit');

    const body = await readJson(ctx.request);
    const status = body.status === 'suspended' ? 'suspended' : 'active';
    if (ctx.params.id === auth.user.id) throw conflict('You cannot suspend your own account.');

    const target = await ctx.env.DB.prepare('SELECT id, email, status FROM users WHERE id = ?1')
      .bind(ctx.params.id)
      .first<{ id: string; email: string; status: string }>();
    if (!target) throw notFound('User not found.');

    const isSuper = await ctx.env.DB.prepare('SELECT 1 AS n FROM user_roles WHERE user_id = ?1 AND role_id = ?2 AND is_active = 1')
      .bind(target.id, SUPER_ADMIN_ROLE_ID)
      .first();
    if (isSuper) throw forbidden('The Super Admin account cannot be suspended through the API.');

    await ctx.env.DB.prepare('UPDATE users SET status = ?2 WHERE id = ?1').bind(target.id, status).run();
    await writeAudit(ctx.env, ctx.request, auth, {
      action: status === 'suspended' ? 'admin.suspended' : 'admin.reactivated',
      entityType: 'user',
      entityId: target.id,
      meta: { email: target.email },
    });
    return json({ ok: true, status });
  });

  // ---- Pending promotions: recent sign-ups not yet staff ------------------
  router.get('/api/admin/admins/candidates', async (ctx) => {
    await requirePermission(ctx, 'admins.create');
    const page = parsePage(ctx.url, { pageSize: 20 });
    const q = (ctx.url.searchParams.get('q') ?? '').trim();
    const where = ["u.status = 'active'", 'NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND ur.is_active = 1 AND r.key != \'student\')'];
    const binds: unknown[] = [];
    if (q) {
      binds.push(likePattern(q));
      where.push(`(u.email LIKE ?${binds.length} OR u.display_name LIKE ?${binds.length})`);
    }
    const rows = await ctx.env.DB.prepare(
      `SELECT u.id, u.email, u.display_name AS displayName, u.created_at AS createdAt, u.last_login_at AS lastLoginAt
         FROM users u WHERE ${where.join(' AND ')}
        ORDER BY u.last_login_at DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
    )
      .bind(...binds, page.pageSize, page.offset)
      .all<Record<string, unknown>>();
    return json(paginated(rows.results ?? [], rows.results?.length ?? 0, page));
  });

  // ---- My own effective permissions (for the admin UI) -------------------
  router.get('/api/admin/me', async (ctx) => {
    const auth = await requireAuth(ctx);
    return json({
      id: auth.user.id,
      email: auth.user.email,
      roles: auth.roles,
      permissions: Array.from(auth.permissions).sort(),
      isSuperAdmin: auth.isSuperAdmin,
      roleLevels: auth.roles.map((r) => ROLE_LEVEL[r] ?? 0),
    });
  });
}
