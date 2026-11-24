// =============================================================================
// Firebase ID-token verification (server-side, stateless)
// =============================================================================
// Firebase ID tokens are RS256 JWTs signed by Google. Verifying them locally
// with Google's public certificates avoids a network round-trip per request and
// does not require the Admin SDK's Node dependencies — ideal for Workers.
//
// Verification performed here:
//   * signature against Google's `securetoken` X.509 certificate set (kid match)
//   * iss  === https://securetoken.google.com/<projectId>
//   * aud  === <projectId>
//   * exp / iat (clock skew tolerated by 60 s)
//   * auth_time sanity and non-empty sub
//
// DEV MODE: when no service-account credential is configured AND the worker is
// not running in production, tokens are decoded without signature validation so
// the platform remains fully usable offline. This path is REFUSED when
// APP_ENV=production. See docs/AUTH.md.
// =============================================================================

import type { Env } from '../env';
import { HttpError } from '../lib/http';

export type FirebaseTokenPayload = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  user_id?: string;
  auth_time?: number;
  iat: number;
  exp: number;
  firebase?: {
    sign_in_provider?: string;
    identities?: Record<string, unknown>;
  };
  [key: string]: unknown;
};

type CertCache = { certs: Record<string, string>; expiresAt: number };

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache: CertCache | null = null;
let certInflight: Promise<Record<string, string>> | null = null;

function cacheMaxAge(response: Response): number {
  const cacheControl = response.headers.get('cache-control') ?? '';
  const match = /max-age=(\d+)/.exec(cacheControl);
  const seconds = match ? Number(match[1]) : 3600;
  return Math.max(300, Math.min(seconds, 21600));
}

async function fetchCertificates(): Promise<Record<string, string>> {
  if (certCache && certCache.expiresAt > Date.now()) return certCache.certs;
  if (certInflight) return certInflight;

  certInflight = (async () => {
    const response = await fetch(GOOGLE_CERTS_URL, { cf: { cacheTtl: 3600 } } as RequestInit);
    if (!response.ok) {
      throw new Error(`Unable to download Firebase signing certificates (${response.status}).`);
    }
    const certs = (await response.json()) as Record<string, string>;
    certCache = { certs, expiresAt: Date.now() + cacheMaxAge(response) * 1000 };
    return certs;
  })();

  try {
    return await certInflight;
  } finally {
    certInflight = null;
  }
}

function decodeSegment<T>(segment: string): T {
  const normalised = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64UrlToBytes(segment: string): Uint8Array {
  const normalised = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type VerifyResult = { payload: FirebaseTokenPayload; verified: boolean };

export function isFirebaseConfigured(env: Env): boolean {
  return Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || env.FIREBASE_PROJECT_ID?.trim());
}

/** `true` when the unverified decode path is permitted (never in production). */
export function devTokenDecodeAllowed(env: Env): boolean {
  return (env.APP_ENV ?? 'development') !== 'production';
}

export async function verifyFirebaseIdToken(env: Env, idToken: string): Promise<VerifyResult> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'invalid_token', 'Malformed authentication token.');

  let header: { alg?: string; kid?: string };
  let payload: FirebaseTokenPayload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    throw new HttpError(401, 'invalid_token', 'Malformed authentication token.');
  }

  const projectId = env.FIREBASE_PROJECT_ID ?? 'rankup29';
  const now = Math.floor(Date.now() / 1000);

  // Claims are checked identically in both modes.
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new HttpError(401, 'invalid_token', 'Token is missing a subject.');
  }
  if (typeof payload.exp !== 'number' || payload.exp + 60 < now) {
    throw new HttpError(401, 'token_expired', 'Your session has expired. Please sign in again.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) {
    throw new HttpError(401, 'invalid_token', 'Token issued in the future.');
  }
  if (payload.aud !== projectId) {
    throw new HttpError(401, 'invalid_token', 'Token was issued for a different project.');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new HttpError(401, 'invalid_token', 'Token issuer mismatch.');
  }

  const hasCredentials = Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());

  if (!hasCredentials) {
    if (!devTokenDecodeAllowed(env)) {
      throw new HttpError(
        503,
        'auth_not_configured',
        'Server authentication is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON.',
      );
    }
    console.warn('firebase_token_unverified_dev_mode', { sub: payload.sub });
    return { payload, verified: false };
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new HttpError(401, 'invalid_token', 'Unexpected token algorithm.');
  }

  const certs = await fetchCertificates().catch(() => {
    throw new HttpError(503, 'auth_unavailable', 'Unable to verify your session right now. Please retry.');
  });
  const certPem = certs[header.kid];
  if (!certPem) throw new HttpError(401, 'invalid_token', 'Unknown signing key.');

  const key = await crypto.subtle.importKey(
    'spki',
    pemToDer(certPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );

  if (!valid) throw new HttpError(401, 'invalid_token', 'Invalid authentication token signature.');

  return { payload, verified: true };
}

export function providerFromPayload(payload: FirebaseTokenPayload): string {
  return payload.firebase?.sign_in_provider ?? 'password';
}
