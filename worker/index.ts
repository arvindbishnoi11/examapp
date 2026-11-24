// =============================================================================
// PrepSetu — Cloudflare Worker entry point
// =============================================================================
// Serves:
//   /api/*            → JSON API (this file + routes/*)
//   everything else   → the compiled React PWA via the ASSETS binding
//
// The same module also implements the cron trigger used for scheduled Google
// Sheets synchronisation and for closing expired exam attempts.
// =============================================================================

import type { Env, ExecutionContext, RouteCtx } from './env';
import { Router } from './lib/router';
import {
  errorResponse,
  HttpError,
  internalError,
  json,
  notFound,
  resolveCors,
  withSecurityHeaders,
} from './lib/http';

import { registerAuthRoutes } from './routes/auth';
import { registerCatalogueRoutes } from './routes/catalogue';
import { registerLectureRoutes } from './routes/lectures';
import { registerExamRoutes } from './routes/exams';
import { registerStudentRoutes } from './routes/student';
import { registerTestPaperRoutes } from './routes/test-papers';
import { registerNotificationRoutes } from './routes/notifications';
import { registerAdminRoutes } from './routes/admin/index';
import { runScheduledJobs } from './services/scheduler';

const router = new Router();

// ---- public -----------------------------------------------------------------
registerAuthRoutes(router);
registerCatalogueRoutes(router);
registerLectureRoutes(router);
registerExamRoutes(router);
registerStudentRoutes(router);
registerTestPaperRoutes(router);
registerNotificationRoutes(router);

// ---- administration ---------------------------------------------------------
registerAdminRoutes(router);

function requestId(): string {
  return crypto.randomUUID();
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const id = requestId();
  const cors = resolveCors(request, env);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const match = router.match(request.method, url.pathname);

  if (!match.handler) {
    if (match.allowed.length) {
      const err = new HttpError(405, 'method_not_allowed', 'Method not allowed for this route.', {
        allowed: match.allowed,
      });
      return new Response(errorResponse(err, id).body, {
        status: 405,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8', Allow: match.allowed.join(', ') },
      });
    }
    const near = router
      .list()
      .filter((r) => r.path.startsWith(url.pathname.slice(0, 14)))
      .slice(0, 5);
    return new Response(
      errorResponse(
        notFound(`No API route matches ${request.method} ${url.pathname}.`),
        id,
      ).body,
      { status: 404, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'x-suggested-routes': near.map((r) => `${r.method} ${r.path}`).join(' | ') } },
    );
  }

  const routeCtx: RouteCtx = {
    request,
    env,
    ctx,
    url,
    params: match.params ?? {},
    requestId: id,
  };

  try {
    const response = await match.handler(routeCtx);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    headers.set('X-Request-Id', id);
    // API responses are private by default; explicit cache headers win.
    if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (err) {
    if (err instanceof HttpError) {
      const response = errorResponse(err, id);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      headers.set('X-Request-Id', id);
      return new Response(response.body, { status: response.status, headers });
    }
    console.error('unhandled_api_error', {
      requestId: id,
      route: `${request.method} ${url.pathname}`,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join(' | ') : undefined,
    });
    const response = internalError(id);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    headers.set('X-Request-Id', id);
    return new Response(response.body, { status: 500, headers });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Self-documenting route inventory. Non-production only — it reveals the
    // full attack surface (paths, not data), which is useful in staging.
    if (url.pathname === '/api/__routes') {
      if ((env.APP_ENV ?? 'development') === 'production') {
        return withSecurityHeaders(json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 }));
      }
      const routes = router.list();
      return withSecurityHeaders(
        json({
          count: routes.length,
          groups: routes.reduce<Record<string, { method: string; path: string }[]>>((acc, route) => {
            const group = route.path.startsWith('/api/admin') ? 'admin' : (route.tag ?? 'public');
            (acc[group] ??= []).push({ method: route.method, path: route.path });
            return acc;
          }, {}),
        }),
      );
    }

    // API surface
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const response = await handleApi(request, env, ctx, url);
      return withSecurityHeaders(response);
    }

    // Health probe (useful for uptime checks and smoke tests)
    if (url.pathname === '/healthz') {
      let dbOk = false;
      try {
        const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
        dbOk = row?.ok === 1;
      } catch {
        dbOk = false;
      }
      return json(
        { status: dbOk ? 'ok' : 'degraded', db: dbOk, time: new Date().toISOString() },
        { status: dbOk ? 200 : 503 },
      );
    }

    // Static PWA (Workers static assets: SPA fallback configured in wrangler.jsonc)
    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);

    // Long-lived immutable caching for hashed build assets.
    if (url.pathname.startsWith('/assets/')) {
      headers.set('cache-control', 'public, max-age=31536000, immutable');
    } else if (url.pathname === '/index.html' || url.pathname === '/' || url.pathname.endsWith('/')) {
      headers.set('cache-control', 'no-cache');
    } else if (url.pathname === '/sw.js' || url.pathname === '/firebase-messaging-sw.js') {
      headers.set('cache-control', 'no-cache');
      headers.set('service-worker-allowed', '/');
    } else if (url.pathname === '/manifest.webmanifest') {
      headers.set('cache-control', 'public, max-age=3600');
    }

    const response = new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });

    // Security headers apply to documents; API handled above.
    if (url.pathname.endsWith('/') || url.pathname === '/index.html' || !url.pathname.includes('.')) {
      return withSecurityHeaders(response);
    }
    const h = new Headers(response.headers);
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return new Response(response.body, { status: response.status, headers: h });
  },

  /** Cron trigger: incremental Sheets sync + exam window housekeeping. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScheduledJobs(env).catch((err) => {
        console.error('scheduled_job_failed', err instanceof Error ? err.message : String(err));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
