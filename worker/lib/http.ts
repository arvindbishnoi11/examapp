// =============================================================================
// HTTP primitives: envelopes, errors, CORS, body limits, pagination
// =============================================================================

import type { Env } from '../env';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required.') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'conflict', message, details);
export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new HttpError(429, 'rate_limited', message, { retryAfterSeconds }, {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });
export const upstreamError = (message: string, details?: unknown) =>
  new HttpError(502, 'upstream_error', message, details);

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function noContent(init: ResponseInit = {}): Response {
  return new Response(null, { ...init, status: init.status ?? 204 });
}

export function errorResponse(err: HttpError, requestId: string): Response {
  return json(
    {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
        requestId,
      },
    },
    { status: err.status, headers: err.headers },
  );
}

/** Never leak stack traces or SQL to clients; log them server-side instead. */
export function internalError(requestId: string): Response {
  return json(
    {
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side. Please try again.',
        requestId,
      },
    },
    { status: 500 },
  );
}

// ---------------------------------------------------------------------------
// Body parsing with hard size limits (Cloudflare also caps at 100 MB).
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BYTES = 512 * 1024; // 512 KB for JSON
const UPLOAD_MAX_BYTES = 32 * 1024 * 1024; // 32 MB for multipart PDF uploads

export async function readJson<T = Record<string, unknown>>(
  request: Request,
  options: { maxBytes?: number } = {},
): Promise<T> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  const max = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (declared && declared > max) {
    throw new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(max / 1024)} KB.`);
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw badRequest('Expected a JSON request body.');
  }
  const text = await request.text();
  if (text.length > max) {
    throw new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(max / 1024)} KB.`);
  }
  if (!text.trim()) return {} as T;
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw badRequest('Request body must be a JSON object.');
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest('Malformed JSON body.');
  }
}

export function assertUploadSize(request: Request, maxBytes = UPLOAD_MAX_BYTES): void {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared && declared > maxBytes) {
    throw new HttpError(413, 'payload_too_large', `Upload exceeds ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
}

// ---------------------------------------------------------------------------
// Validation helpers — small, explicit, dependency-free.
// ---------------------------------------------------------------------------

export type FieldError = { field: string; message: string };

export class Validator {
  private errors: FieldError[] = [];
  constructor(private body: Record<string, unknown>) {}

  fail(field: string, message: string): this {
    this.errors.push({ field, message });
    return this;
  }

  get valid(): boolean {
    return this.errors.length === 0;
  }

  throwIfInvalid(): void {
    if (this.errors.length) throw badRequest('Validation failed.', this.errors);
  }

  string(field: string, opts: { required?: boolean; min?: number; max?: number; pattern?: RegExp; trim?: boolean; allowEmpty?: boolean } = {}): string | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.fail(field, 'Is required.');
      return undefined;
    }
    if (typeof raw !== 'string') {
      this.fail(field, 'Must be a string.');
      return undefined;
    }
    const value = opts.trim === false ? raw : raw.trim();
    if (!value && opts.allowEmpty) return '';
    if (!value) {
      if (opts.required) this.fail(field, 'Is required.');
      return undefined;
    }
    if (opts.min && value.length < opts.min) this.fail(field, `Must be at least ${opts.min} characters.`);
    if (opts.max && value.length > opts.max) this.fail(field, `Must be at most ${opts.max} characters.`);
    if (opts.pattern && !opts.pattern.test(value)) this.fail(field, 'Has an invalid format.');
    return value;
  }

  email(field: string, opts: { required?: boolean } = {}): string | undefined {
    const value = this.string(field, { required: opts.required, max: 254 });
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) this.fail(field, 'Must be a valid email address.');
    return value?.toLowerCase();
  }

  number(field: string, opts: { required?: boolean; min?: number; max?: number; integer?: boolean } = {}): number | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.fail(field, 'Is required.');
      return undefined;
    }
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) {
      this.fail(field, 'Must be a number.');
      return undefined;
    }
    if (opts.integer && !Number.isInteger(num)) this.fail(field, 'Must be a whole number.');
    if (opts.min !== undefined && num < opts.min) this.fail(field, `Must be at least ${opts.min}.`);
    if (opts.max !== undefined && num > opts.max) this.fail(field, `Must be at most ${opts.max}.`);
    return num;
  }

  boolean(field: string, fallback?: boolean): boolean | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw === 'boolean') return raw;
    if (raw === 1 || raw === 0) return Boolean(raw);
    if (typeof raw === 'string') {
      if (['true', '1', 'yes', 'on'].includes(raw.toLowerCase())) return true;
      if (['false', '0', 'no', 'off'].includes(raw.toLowerCase())) return false;
    }
    this.fail(field, 'Must be true or false.');
    return fallback;
  }

  enum<T extends string>(field: string, allowed: readonly T[], opts: { required?: boolean; fallback?: T } = {}): T | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.fail(field, 'Is required.');
      return opts.fallback;
    }
    if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
      this.fail(field, `Must be one of: ${allowed.join(', ')}.`);
      return opts.fallback;
    }
    return raw as T;
  }

  /** ISO timestamp → normalised ISO string. */
  timestamp(field: string, opts: { required?: boolean } = {}): string | null | undefined {
    const raw = this.body[field];
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    if (typeof raw !== 'string') {
      this.fail(field, 'Must be an ISO date string.');
      return undefined;
    }
    const time = Date.parse(raw);
    if (Number.isNaN(time)) {
      this.fail(field, 'Must be a valid date.');
      return undefined;
    }
    return new Date(time).toISOString();
  }

  array(field: string, opts: { maxItems?: number } = {}): unknown[] | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null) return undefined;
    if (!Array.isArray(raw)) {
      this.fail(field, 'Must be an array.');
      return undefined;
    }
    if (opts.maxItems && raw.length > opts.maxItems) {
      this.fail(field, `Must contain at most ${opts.maxItems} items.`);
      return undefined;
    }
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export type PageParams = { page: number; pageSize: number; offset: number };

export function parsePage(url: URL, defaults: { pageSize?: number; maxPageSize?: number } = {}): PageParams {
  const maxPageSize = defaults.maxPageSize ?? 100;
  const page = Math.max(1, Math.min(100000, Number(url.searchParams.get('page') ?? 1) || 1));
  const pageSize = Math.max(1, Math.min(maxPageSize, Number(url.searchParams.get('pageSize') ?? defaults.pageSize ?? 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginated<T>(items: T[], total: number, params: PageParams) {
  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

// ---------------------------------------------------------------------------
// CORS — same-origin by default; explicit allow-list for extra origins.
// ---------------------------------------------------------------------------

export function resolveCors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sameOrigin = (() => {
    try {
      return new URL(origin).host === new URL(request.url).host;
    } catch {
      return false;
    }
  })();
  if (!sameOrigin && !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,If-None-Match,X-Request-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://www.gstatic.com https://www.google.com https://apis.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://firebasestorage.googleapis.com https://lh3.googleusercontent.com https://www.gstatic.com",
      "media-src 'self' https://firebasestorage.googleapis.com",
      "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://rankup29.firebaseapp.com https://accounts.google.com",
      "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://www.googleapis.com https://firebasestorage.googleapis.com https://firebase-messaging-sw.js",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'frame-ancestors ',
    ].join('; ').replace(/frame-ancestors $/, "frame-ancestors 'self'"),
  );
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
