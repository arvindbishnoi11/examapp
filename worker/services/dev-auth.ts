// =============================================================================
// Development-only session tokens
// =============================================================================
// Purpose: make the platform fully usable and testable in environments where no
// Firebase Admin credential is available (offline/local demos, automated tests).
//
// Safety rails (all must hold, otherwise tokens are refused and cannot be
// minted):
//   1. DEV_AUTH_ENABLED === "true"
//   2. APP_ENV !== "production"
//   3. FIREBASE_SERVICE_ACCOUNT_JSON is empty
// Tokens are HMAC-SHA256 signed with ADMIN_SESSION_SECRET (or an ephemeral
// per-isolate secret), expire after 12 hours and carry `dev: true`, which is
// rejected by production deployments.
// =============================================================================

import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { base64UrlDecodeToString, base64UrlEncodeString, hmacSign, hmacVerify } from '../lib/util';

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

let ephemeralSecret: string | null = null;

function secret(env: Env): string {
  if (env.ADMIN_SESSION_SECRET?.trim()) return env.ADMIN_SESSION_SECRET.trim();
  if (!ephemeralSecret) {
    ephemeralSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    console.warn('dev_auth_ephemeral_secret', 'Set ADMIN_SESSION_SECRET for stable dev sessions.');
  }
  return ephemeralSecret;
}

export function devAuthEnabled(env: Env): boolean {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) return false;
  if ((env.APP_ENV ?? 'development') === 'production') return false;
  return (env.DEV_AUTH_ENABLED ?? '').toLowerCase() === 'true';
}

export type DevTokenPayload = {
  dev: true;
  sub: string;
  email: string;
  name?: string;
  iat: number;
  exp: number;
};

export async function signDevToken(env: Env, user: { id: string; email: string; name?: string }): Promise<{ token: string; expiresAt: string }> {
  if (!devAuthEnabled(env)) {
    throw new HttpError(403, 'dev_auth_disabled', 'Development sign-in is disabled on this deployment.');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: DevTokenPayload = {
    dev: true,
    sub: user.id,
    email: user.email,
    name: user.name,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const body = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await hmacSign(secret(env), body);
  return { token: `dev.${body}.${signature}`, expiresAt: new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString() };
}

export async function verifyDevToken(env: Env, token: string): Promise<DevTokenPayload> {
  if (!devAuthEnabled(env)) {
    throw new HttpError(401, 'dev_auth_disabled', 'Development sign-in is disabled on this deployment.');
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'dev') {
    throw new HttpError(401, 'invalid_token', 'Malformed development token.');
  }
  const [, body, signature] = parts;
  if (!(await hmacVerify(secret(env), body, signature))) {
    throw new HttpError(401, 'invalid_token', 'Invalid development token signature.');
  }
  const payload = JSON.parse(base64UrlDecodeToString(body)) as DevTokenPayload;
  if (!payload.dev || !payload.sub || !payload.email) {
    throw new HttpError(401, 'invalid_token', 'Invalid development token payload.');
  }
  if (payload.exp * 1000 < Date.now()) {
    throw new HttpError(401, 'token_expired', 'Your session has expired. Please sign in again.');
  }
  return payload;
}

export function isDevToken(token: string): boolean {
  return token.startsWith('dev.');
}
