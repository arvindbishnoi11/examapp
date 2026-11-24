// =============================================================================
// Audit logging — append-only record of privileged actions
// =============================================================================

import type { Env } from '../env';
import type { AuthContext } from '../env';
import { newId, nowIso, sha256Hex } from './util';

export type AuditInput = {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  status?: 'success' | 'failure' | 'denied';
  before?: unknown;
  after?: unknown;
  meta?: unknown;
};

const MAX_JSON = 8000;

function serialise(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value, redactSecrets);
    return text.length > MAX_JSON ? text.slice(0, MAX_JSON) + '…' : text;
  } catch {
    return null;
  }
}

/** Defence in depth: never persist secret-looking keys into the audit log. */
function redactSecrets(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && /BEGIN (RSA |EC |)PRIVATE KEY|refresh_token|private_key/i.test(value)) {
    return '[redacted]';
  }
  return value;
}

export async function hashIp(env: Env, request: Request): Promise<string | null> {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0];
  if (!ip) return null;
  const salt = env.IP_HASH_SECRET || env.ADMIN_SESSION_SECRET || 'prepsetu';
  return (await sha256Hex(`${salt}:ip:${ip}`)).slice(0, 32);
}

export async function writeAudit(
  env: Env,
  request: Request,
  auth: AuthContext | undefined,
  input: AuditInput,
): Promise<void> {
  try {
    const ipHash = await hashIp(env, request);
    await env.DB.prepare(
      `INSERT INTO audit_logs
        (id, actor_id, actor_email, action, entity_type, entity_id, status,
         before_json, after_json, meta_json, ip_hash, user_agent, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
      .bind(
        newId(),
        auth?.user.id ?? null,
        auth?.user.email ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.status ?? 'success',
        serialise(input.before),
        serialise(input.after),
        serialise(input.meta),
        ipHash,
        (request.headers.get('user-agent') ?? '').slice(0, 300) || null,
        nowIso(),
      )
      .run();
  } catch (err) {
    // An audit failure must never break the user-facing operation, but it must
    // be visible in logs.
    console.error('audit_write_failed', { action: input.action, message: (err as Error)?.message });
  }
}

/** Non-blocking variant for use with ExecutionContext.waitUntil. */
export function auditAsync(
  ctx: { waitUntil(p: Promise<unknown>): void },
  env: Env,
  request: Request,
  auth: AuthContext | undefined,
  input: AuditInput,
): void {
  ctx.waitUntil(writeAudit(env, request, auth, input));
}
