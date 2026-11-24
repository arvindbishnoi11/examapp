// =============================================================================
// Worker bindings + configuration
// =============================================================================

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDIA?: R2Bucket;

  // --- public vars (wrangler.jsonc) ---
  APP_NAME?: string;
  APP_ENV?: string;
  FIREBASE_PROJECT_ID?: string;
  SUPER_ADMIN_EMAIL?: string;
  GOOGLE_SHEETS_SPREADSHEET_ID?: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_CACHE_TTL?: string;

  // --- secrets (wrangler secret put / .dev.vars) ---
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  YOUTUBE_API_KEY?: string;
  ADMIN_SESSION_SECRET?: string;
  IP_HASH_SECRET?: string;
  DEV_AUTH_ENABLED?: string;
}

export type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

export interface RouteCtx {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  /** Route params, e.g. { id: 'abc' } */
  params: Record<string, string>;
  /** Populated by requireAuth()/optionalAuth(). */
  auth?: AuthContext;
  /** Stable per-request id used in logs and error responses. */
  requestId: string;
}

export type AuthContext = {
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    displayName: string | null;
    photoUrl: string | null;
    status: 'active' | 'suspended' | 'deleted';
    authProvider: string;
  };
  roles: string[];
  permissions: Set<string>;
  isSuperAdmin: boolean;
  isStaff: boolean;
  /** Resolved once per request. */
  profile: Record<string, unknown> | null;
};

export type Handler = (ctx: RouteCtx) => Promise<Response> | Response;
