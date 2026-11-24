// =============================================================================
// Google service-account authentication (shared by Sheets + FCM)
// =============================================================================
// Two credential shapes are supported in *_SERVICE_ACCOUNT_JSON:
//   1. {"type":"service_account", "client_email", "private_key", ...}
//      → JWT-bearer OAuth 2.0 grant, RS256 signature (production).
//   2. {"type":"authorized_user", "client_id", "client_secret", "refresh_token"}
//      → refresh-token grant (handy for local development / personal OAuth).
// Access tokens are cached in isolate memory for ~50 min and de-duplicated
// across concurrent requests.
// =============================================================================

import type { Env } from '../env';
import { decodeBase64, withRetry } from '../lib/util';

export type ServiceAccountCredential =
  | {
      type: 'service_account';
      projectId?: string;
      clientEmail: string;
      privateKey: string;
      privateKeyId?: string;
      tokenUri?: string;
    }
  | {
      type: 'authorized_user';
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      projectId?: string;
    };

type CachedToken = { accessToken: string; expiresAt: number; scope: string };

const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

/** Accepts raw JSON, a JSON string wrapped in an extra layer of quotes, or base64 JSON. */
export function parseCredentials(raw: string | undefined | null): ServiceAccountCredential | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  try {
    // `.dev.vars` values are sometimes pasted with an extra layer of quotes.
    if (text.startsWith('"') && text.endsWith('"')) text = JSON.parse(text) as string;
  } catch {
    /* keep going */
  }
  let obj: Record<string, unknown> | null = null;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    try {
      obj = JSON.parse(new TextDecoder().decode(decodeBase64(text))) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;

  const normaliseKey = (key: string) => key.replace(/\\n/g, '\n').trim();

  if (obj.type === 'service_account' || (obj.client_email && obj.private_key)) {
    if (typeof obj.client_email !== 'string' || typeof obj.private_key !== 'string') return null;
    return {
      type: 'service_account',
      clientEmail: obj.client_email,
      privateKey: normaliseKey(obj.private_key),
      privateKeyId: typeof obj.private_key_id === 'string' ? obj.private_key_id : undefined,
      projectId: typeof obj.project_id === 'string' ? obj.project_id : undefined,
      tokenUri: typeof obj.token_uri === 'string' ? obj.token_uri : undefined,
    };
  }

  if (obj.type === 'authorized_user' || (obj.client_id && obj.refresh_token)) {
    if (
      typeof obj.client_id !== 'string' ||
      typeof obj.client_secret !== 'string' ||
      typeof obj.refresh_token !== 'string'
    ) {
      return null;
    }
    return {
      type: 'authorized_user',
      clientId: obj.client_id,
      clientSecret: obj.client_secret,
      refreshToken: obj.refresh_token,
      projectId: typeof obj.project_id === 'string' ? obj.project_id : undefined,
    };
  }

  return null;
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const bytes = decodeBase64(base64.replace(/\+/g, '-').replace(/\//g, '_'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64Url(bytes: ArrayBuffer | Uint8Array | string): string {
  const arr =
    typeof bytes === 'string'
      ? new TextEncoder().encode(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
  let binary = '';
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signJwt(cred: ServiceAccountCredential & { type: 'service_account' }, scope: string, audience: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', ...(cred.privateKeyId ? { kid: cred.privateKeyId } : {}) };
  const claims = {
    iss: cred.clientEmail,
    scope,
    aud: audience,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(cred.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

async function fetchAccessToken(cred: ServiceAccountCredential, scope: string): Promise<{ accessToken: string; expiresIn: number }> {
  const tokenUri =
    cred.type === 'service_account' ? cred.tokenUri ?? 'https://oauth2.googleapis.com/token' : 'https://oauth2.googleapis.com/token';

  let body: URLSearchParams;
  if (cred.type === 'service_account') {
    const assertion = await signJwt(cred, scope, tokenUri);
    body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
  } else {
    body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: cred.refreshToken,
    });
  }

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // Never surface credential material in the error.
    throw new Error(`Google OAuth token request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Google OAuth response did not contain an access token.');
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

/**
 * Returns a cached access token for the given scope.
 * Throws a descriptive error when credentials are missing/invalid so callers
 * can convert it into an actionable admin-facing message.
 */
export async function getGoogleAccessToken(
  cacheKey: string,
  rawCredentials: string | undefined,
  scope: string,
): Promise<string> {
  const cred = parseCredentials(rawCredentials);
  if (!cred) {
    throw new Error('google_credentials_missing');
  }

  const key = `${cacheKey}:${scope}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const { accessToken, expiresIn } = await withRetry(() => fetchAccessToken(cred, scope), {
      attempts: 3,
      shouldRetry: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        return /\b(429|500|502|503|504)\b/.test(message) || /network|fetch/i.test(message);
      },
    });
    tokenCache.set(key, { accessToken, expiresAt: Date.now() + expiresIn * 1000, scope });
    return accessToken;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export function googleProjectId(env: Env, raw: string | undefined): string | null {
  const cred = parseCredentials(raw);
  return cred?.projectId ?? env.FIREBASE_PROJECT_ID ?? null;
}

export const SCOPES = {
  sheets: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  fcm: 'https://www.googleapis.com/auth/firebase.messaging',
  firebaseAuth: 'https://www.googleapis.com/auth/identitytoolkit',
  cloudPlatform: 'https://www.googleapis.com/auth/cloud-platform',
} as const;
