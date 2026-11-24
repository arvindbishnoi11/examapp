// =============================================================================
// API client
// =============================================================================
// * Always sends the Firebase ID token (refreshed on demand) as a Bearer header.
// * Normalises server error envelopes into ApiError instances so pages can show
//   a precise message instead of "Something went wrong".
// * Retries only safe GETs, never exam submissions/answer saves.
// =============================================================================

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  requestId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

/** Registered by the auth provider so the client never imports Firebase itself. */
export function setTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

/** Optional hook used to force a re-authentication when a token is rejected. */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  raw?: boolean;
};

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.pathname + url.search;
}

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (response.status === 204) return null;
  if (type.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return await response.text();
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal, timeoutMs = 25_000, retries } = options;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';

  if (auth) {
    const token = tokenProvider ? await tokenProvider() : null;
    if (token) headers.authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  const maxAttempts = retries ?? (method === 'GET' ? 2 : 1);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'same-origin',
      });

      const payload = await readBody(response);

      if (!response.ok) {
        const envelope = payload as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | null;
        const error = new ApiError(
          response.status,
          envelope?.error?.code ?? `http_${response.status}`,
          envelope?.error?.message ?? `Request failed (${response.status}).`,
          envelope?.error?.details,
          envelope?.error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
        );
        if (response.status === 401 && auth) unauthorizedHandler?.();
        throw error;
      }

      return payload as T;
    } catch (err) {
      lastError = err;
      if (err instanceof ApiError) {
        // Do not retry deterministic client errors.
        if (err.status >= 400 && err.status < 500) throw err;
        if (attempt === maxAttempts - 1) throw err;
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ApiError(0, 'timeout', 'The request timed out. Check your connection and try again.');
      } else {
        if (attempt === maxAttempts - 1) {
          throw new ApiError(0, 'network_error', 'Could not reach PrepSetu. Check your internet connection.');
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new ApiError(0, 'unknown', 'Request failed.');
}

/** Raw authenticated fetch used for CSV/file downloads (returns a Blob). */
export async function apiBlob(path: string, query?: RequestOptions['query']): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = tokenProvider ? await tokenProvider() : null;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(buildUrl(path, query), { headers, credentials: 'same-origin' });
  if (!response.ok) {
    const payload = (await readBody(response)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? `http_${response.status}`,
      payload?.error?.message ?? 'The export could not be generated.',
    );
  }
  return await response.blob();
}

export const api = {
  get: <T = unknown>(path: string, query?: RequestOptions['query'], options: Partial<RequestOptions> = {}) =>
    apiRequest<T>(path, { ...options, method: 'GET', query }),
  post: <T = unknown>(path: string, body?: unknown, options: Partial<RequestOptions> = {}) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown, options: Partial<RequestOptions> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T = unknown>(path: string, body?: unknown, options: Partial<RequestOptions> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T = unknown>(path: string, body?: unknown, options: Partial<RequestOptions> = {}) =>
    apiRequest<T>(path, { ...options, method: 'DELETE', body }),
};

/** Human-friendly message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'rate_limited') return 'Too many attempts. Please wait a moment and try again.';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

/** Field-level validation errors from the API (Validator class). */
export function fieldErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && Array.isArray(err.details)) {
    const out: Record<string, string> = {};
    for (const item of err.details as { field?: string; message?: string }[]) {
      if (item?.field) out[item.field] = item.message ?? 'Invalid value';
    }
    return out;
  }
  return {};
}
