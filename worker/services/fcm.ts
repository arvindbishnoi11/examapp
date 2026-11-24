// =============================================================================
// Firebase Cloud Messaging (HTTP v1 API) + audience resolution
// =============================================================================
// Requires FIREBASE_SERVICE_ACCOUNT_JSON with the role
// "Firebase Admin SDK Administrator Service Agent" (or FCM Admin).
// When credentials are missing the composer still records the notification and
// returns a precise, actionable error instead of pretending to deliver.
// =============================================================================

import type { Env } from '../env';
import { getGoogleAccessToken, googleProjectId, parseCredentials, SCOPES } from './google-auth';
import { chunk, withRetry } from '../lib/util';

const FCM_SCOPE = SCOPES.fcm;

export function fcmConfigured(env: Env): boolean {
  return Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) && Boolean(env.FIREBASE_PROJECT_ID?.trim() || googleProjectId(env, env.FIREBASE_SERVICE_ACCOUNT_JSON));
}

export type Audience = {
  targetType: 'all' | 'class' | 'exam_type' | 'course' | 'user' | 'users';
  targetValue?: string | null;
};

export type ResolvedAudience = {
  userIds: string[];
  description: string;
};

/** Turns an audience selector into a concrete list of student user ids. */
export async function resolveAudience(env: Env, audience: Audience): Promise<ResolvedAudience> {
  switch (audience.targetType) {
    case 'all': {
      const rows = await env.DB.prepare(
        "SELECT id FROM users WHERE status = 'active' AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = users.id AND ur.is_active = 1 AND r.key != 'student')",
      ).all<{ id: string }>();
      return { userIds: (rows.results ?? []).map((r) => r.id), description: 'All active students' };
    }
    case 'class': {
      const rows = await env.DB.prepare(
        "SELECT u.id FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE p.class_id = ?1 AND u.status = 'active'",
      )
        .bind(audience.targetValue ?? '')
        .all<{ id: string }>();
      return { userIds: (rows.results ?? []).map((r) => r.id), description: 'Students in the selected class' };
    }
    case 'exam_type': {
      const rows = await env.DB.prepare(
        "SELECT u.id FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE p.target_exam_type_id = ?1 AND u.status = 'active'",
      )
        .bind(audience.targetValue ?? '')
        .all<{ id: string }>();
      return { userIds: (rows.results ?? []).map((r) => r.id), description: 'Students targeting the selected examination' };
    }
    case 'course': {
      const rows = await env.DB.prepare(
        `SELECT DISTINCT u.id FROM users u
           JOIN exam_attempts a ON a.user_id = u.id
           JOIN exams e ON e.id = a.exam_id
          WHERE e.course_id = ?1 AND u.status = 'active'`,
      )
        .bind(audience.targetValue ?? '')
        .all<{ id: string }>();
      return { userIds: (rows.results ?? []).map((r) => r.id), description: 'Students active in the selected course' };
    }
    case 'user':
    case 'users': {
      const list = audience.targetType === 'user' ? [audience.targetValue ?? ''] : String(audience.targetValue ?? '').split(',');
      const ids = list.map((s) => s.trim()).filter(Boolean);
      if (!ids.length) return { userIds: [], description: 'Selected students' };
      const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
      const rows = await env.DB.prepare(`SELECT id FROM users WHERE id IN (${placeholders}) AND status = 'active'`)
        .bind(...ids)
        .all<{ id: string }>();
      return { userIds: (rows.results ?? []).map((r) => r.id), description: 'Selected students' };
    }
    default:
      return { userIds: [], description: 'Unknown audience' };
  }
}

export type SendResult = {
  attempted: number;
  success: number;
  failed: number;
  tokens: number;
  configured: boolean;
  error?: string;
  invalidTokens: string[];
};

type TokenRow = { token: string; userId: string };

async function tokensForUsers(env: Env, userIds: string[]): Promise<TokenRow[]> {
  if (!userIds.length) return [];
  const out: TokenRow[] = [];
  for (const batch of chunk(userIds, 80)) {
    const placeholders = batch.map((_, i) => `?${i + 1}`).join(',');
    const rows = await env.DB.prepare(
      `SELECT t.token, t.user_id AS userId
         FROM notification_tokens t
         JOIN user_profiles p ON p.user_id = t.user_id
        WHERE t.is_active = 1 AND t.user_id IN (${placeholders})
          AND COALESCE(json_extract(p.notification_prefs, '$.push'), 1) = 1`,
    )
      .bind(...batch)
      .all<TokenRow>();
    out.push(...(rows.results ?? []));
  }
  return out;
}

/**
 * Sends a push notification to every active token of the audience.
 * Uses the FCM v1 batch endpoint (500 messages per request).
 */
export async function sendPush(env: Env, input: {
  title: string;
  body: string;
  imageUrl?: string | null;
  deepLink?: string | null;
  audience: Audience;
}): Promise<SendResult> {
  const audience = await resolveAudience(env, input.audience);
  const tokens = await tokensForUsers(env, audience.userIds);

  if (!fcmConfigured(env)) {
    return {
      attempted: audience.userIds.length,
      success: 0,
      failed: tokens.length,
      tokens: tokens.length,
      configured: false,
      invalidTokens: [],
      error:
        'FCM is not configured. Add FIREBASE_SERVICE_ACCOUNT_JSON (with the Firebase Admin SDK Administrator Service Agent role) and FIREBASE_PROJECT_ID to enable push notifications.',
    };
  }
  if (!tokens.length) {
    return { attempted: audience.userIds.length, success: 0, failed: 0, tokens: 0, configured: true, invalidTokens: [] };
  }

  const projectId = env.FIREBASE_PROJECT_ID ?? googleProjectId(env, env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!projectId) {
    return {
      attempted: audience.userIds.length,
      success: 0,
      failed: tokens.length,
      tokens: tokens.length,
      configured: false,
      invalidTokens: [],
      error: 'FIREBASE_PROJECT_ID is missing; cannot address the FCM v1 endpoint.',
    };
  }

  const accessToken = await getGoogleAccessToken('fcm', env.FIREBASE_SERVICE_ACCOUNT_JSON, FCM_SCOPE);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

  let success = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  // Send in parallel batches; FCM v1 is one message per request, so we cap
  // concurrency to stay well inside Worker limits.
  const batches = chunk(tokens, 25);
  for (const batch of batches) {
    const results = await Promise.all(
      batch.map(async (row) => {
        const message = {
          message: {
            token: row.token,
            notification: {
              title: input.title.slice(0, 200),
              body: input.body.slice(0, 1000),
              ...(input.imageUrl ? { image: input.imageUrl } : {}),
            },
            webpush: {
              notification: {
                title: input.title.slice(0, 200),
                body: input.body.slice(0, 1000),
                icon: '/icons/icon-192.png',
                badge: '/icons/badge-72.png',
                ...(input.imageUrl ? { image: input.imageUrl } : {}),
              },
              fcmOptions: input.deepLink ? { link: input.deepLink } : undefined,
            },
            data: {
              deepLink: input.deepLink ?? '/',
              title: input.title,
              body: input.body,
            },
          },
        };

        try {
          const response = await withRetry(
            () =>
              fetch(endpoint, {
                method: 'POST',
                headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
                body: JSON.stringify(message),
              }),
            {
              attempts: 3,
              shouldRetry: (err) => {
                const status = (err as { status?: number }).status;
                return status === 429 || (status !== undefined && status >= 500);
              },
            },
          );
          if (response.ok) return { ok: true as const, token: row.token };
          const text = await response.text().catch(() => '');
          if (/UNREGISTERED|INVALID_ARGUMENT.*token/i.test(text) || response.status === 404) {
            invalidTokens.push(row.token);
          }
          return { ok: false as const, token: row.token, error: text.slice(0, 200) };
        } catch (err) {
          return { ok: false as const, token: row.token, error: (err as Error).message };
        }
      }),
    );

    for (const r of results) (r.ok ? success++ : failed++);
  }

  if (invalidTokens.length) {
    for (const batch of chunk(invalidTokens, 50)) {
      const placeholders = batch.map((_, i) => `?${i + 1}`).join(',');
      await env.DB.prepare(`UPDATE notification_tokens SET is_active = 0 WHERE token IN (${placeholders})`)
        .bind(...batch)
        .run()
        .catch(() => undefined);
    }
  }

  return { attempted: audience.userIds.length, success, failed, tokens: tokens.length, configured: true, invalidTokens };
}

/** Verifies that the configured credential can mint an FCM token (diagnostics). */
export async function fcmHealth(env: Env): Promise<{ ok: boolean; message: string }> {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    return { ok: false, message: 'FIREBASE_SERVICE_ACCOUNT_JSON is not set.' };
  }
  const cred = parseCredentials(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!cred) return { ok: false, message: 'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON of a supported credential type.' };
  try {
    await getGoogleAccessToken('fcm', env.FIREBASE_SERVICE_ACCOUNT_JSON, FCM_SCOPE);
    return { ok: true, message: 'Service account can mint FCM access tokens.' };
  } catch (err) {
    return { ok: false, message: `Unable to obtain an access token: ${(err as Error).message.slice(0, 200)}` };
  }
}
