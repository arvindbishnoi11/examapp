# Architecture

PrepSetu is one Cloudflare Worker that serves a React PWA, a JSON API and a cron job against a single D1
database. This document explains the shape of the system and the reasoning behind the choices that are easy to
get wrong.

---

## Request path

```
GET /api/courses
      │
      ▼
assets layer ──► run_worker_first matches /api/* ──► Worker.fetch
                                                      │
                          ┌───────────────────────────┴────────────────────────────┐
                          ▼                                                        ▼
                    handleApi()                                          ASSETS.fetch (SPA)
                    • resolveCors
                    • router.match(method, path)
                    • handler(ctx) ──► services ──► D1
                    • CORS + X-Request-Id + security headers
```

Anything that is not `/api/*` or `/healthz` falls through to the static asset layer, which serves `dist/` and
falls back to `index.html` so client-side routes deep-link correctly. Hashed assets get
`cache-control: immutable`; `index.html`, `sw.js` and the messaging service worker get `no-cache`.

**`/healthz` must be listed in `run_worker_first`.** Without it the asset layer answers with the SPA shell and
every uptime monitor reports a false “OK”. This is asserted by the smoke test.

---

## Layers

| Layer | Responsibility | Never does |
| --- | --- | --- |
| `worker/routes/*` | Parse/validate the request, call services, shape the response | Touch D1 inline for anything non-trivial |
| `worker/services/*` | Domain rules (auth, sessions, exam engine, Sheets, FCM, YouTube) | Know about HTTP |
| `worker/lib/*` | Router, validators, errors, rate limits, audit, cache, slugs, CSV | Contain business rules |
| `src/pages/*` | Screens | Compute authoritative results |
| `src/lib/api.ts` | Fetch wrapper, retries, error mapping, blob downloads | Store tokens |

Validation is centralised in `Validator` (typed, coercing, field-level errors surfaced as
`error.details[]`). Handlers call `v.throwIfInvalid()` before any write, so a bad payload never reaches D1.

---

## Data model

38 tables. The important relationships:

```
classes ─┐                 ┌── subjects ── chapters
exam_types ─┴─ courses ────┤
                           └── lectures ── lecture_progress
                                 │
lecture_series ──────────────────┘

test_series ── exams ── exam_sections
                 │
                 ├── exam_questions ── questions ── question_options
                 │                        │ ├── answer_keys
                 │                        │ └── explanations
                 └── exam_attempts ── attempt_answers
                          │
                          └── results

users ── user_profiles
      ├── user_roles ── roles ── role_permissions ── permissions
      ├── user_permission_overrides
      ├── notification_tokens
      └── bookmarks

audit_logs · sync_logs · sync_locks · platform_settings · rate_limits · api_cache
```

Conventions:

- **Text UUID primary keys** (`crypto.randomUUID()`), so ids can be generated client-side and merged safely.
- **ISO-8601 text timestamps** for readability in D1 and JSON; **integer `*_at_ms` columns** wherever a
  comparison against `Date.now()` matters (`exam_attempts.expires_at_ms`). Never rely on SQLite string
  comparison for deadlines.
- **`external_id`** on content tables for spreadsheet idempotency, with a partial unique index.
- **Soft delete** on `users` (`status = 'deleted'`) so results and audit history keep their reference.
- **`is_published`** on results separate from `result_publish_mode`, so an admin can hide a single result
  without changing the exam's policy.
- **Denormalised totals** (`total_questions`, `total_marks`) are recomputed by the exam service after any
  attach/detach, never maintained by the client.

---

## Caching

Two layers, both invalidated on write:

1. **Edge cache** — public catalogue responses (`/api/home`, courses, lectures) are cached in `api_cache`
   (D1) keyed by path+query, with `DEFAULT_CACHE_TTL` (60 s). `invalidateAsync()` purges the namespace on any
   admin write so published content appears immediately.
2. **HTTP caching** — hashed assets are immutable; HTML/service workers are `no-cache`.

Anything authenticated is `cache-control: no-store`. There is no shared cache in front of per-user data.

---

## Rate limiting

`enforceRateLimit(env, bucket, key)` stores counters in `rate_limits`. The key is
`sha256(salt : bucket : ip + user id)` — privacy-preserving (no raw IPs are persisted anywhere) and stable
enough to stop scripted abuse. Expired rows are pruned by the cron.

| Bucket | Limit | Window |
| --- | --- | --- |
| `auth.verify` | 30 | 60 s |
| `auth.me` | 120 | 60 s |
| `read` | 240 | 60 s |
| `write` | 60 | 60 s |
| `exam.answer` | 600 | 60 s |
| `exam.start` | 20 | 5 min |
| `exam.submit` | 20 | 5 min |
| `youtube.metadata` | 20 | 60 s |
| `sheets.sync` | 6 | 5 min |
| `notifications.send` | 10 | 5 min |
| `upload` | 30 | 5 min |
| `audit` | 60 | 60 s |

The per-bucket key includes the bucket name, so exhausting one never starves another.

---

## Audit trail

`writeAudit(env, request, auth, { action, entityType, entityId, before, after, meta, status })` records every
privileged mutation with:

- actor id + email snapshot (so history survives account deletion),
- before/after JSON (diffable in the UI),
- `ip_hash` (never the IP),
- status `success | failure | denied`.

Reads and exports are audited too — `results.export` and `audit-logs/export` are themselves log entries.

---

## Frontend

- **React 18 + Vite**, route-level code splitting (`React.lazy`) — the student bundle must stay small on 3G.
- **TanStack Query** for server state (retries, dedupe, background refresh) and **Context** for the three
  pieces of global state that matter: auth, theme, toasts.
- **`useApiQuery(path, query, { enabled, deps })`** wraps the fetch client; `apiBlob()` streams CSV downloads
  without buffering through the CORS layer.
- **Guards**: `RequireAuth` for signed-in routes, `RequirePermission(permission)` for staff routes — a
  convenience layer only; the API re-checks.
- **PWA**: a hand-written service worker with a versioned cache (`prepsetu-v3`), navigation
  stale-while-revalidate, an offline page, and no caching of API responses.
- **Admin building blocks**: `DataTable<T>` (typed columns), `ResourceManager<T>` (config-driven CRUD used by
  courses/taxonomy/test series) and `ResourceForm` (field descriptors → validated modal). Custom screens
  (exam builder, question editor, analytics, sheets) compose the same primitives instead.

---

## Decisions and trade-offs

### Server-authoritative time
**Decision:** all deadlines live on the server; the client only renders an offset clock.
**Cost:** one extra round trip on session load.
**Benefit:** cheating by changing the device clock is impossible, and a dropped connection cannot extend an
attempt. Enforced again on every write, not just at start.

### Answer keys are projected out, not filtered out
**Decision:** the session query never selects key columns.
**Cost:** a second query for the review page.
**Benefit:** there is no code path where a careless `JSON.stringify(row)` leaks an answer. A test asserts the
absence.

### Content in D1, authoring in Sheets
**Decision:** D1 is the delivery store; Sheets is an optional authoring surface.
**Cost:** one more integration to configure.
**Benefit:** the site never depends on Google availability, sync failures cannot take the platform down, and
non-technical staff can bulk-edit. The admin console is a complete alternative.

### No payments, by design
**Decision:** there is no payment gateway, no invoices and no entitlements ledger.
**Cost:** paid content cannot be monetised directly.
**Benefit:** no PCI scope, no refund/chargeback handling, no subscription state machine. `is_free`,
`price_inr` and `visibility` exist for **display and editorial** purposes only — do not describe a course as
“purchasable”. If monetisation is ever needed, add it as a separate service that issues entitlements; do not
bolt a checkout onto the exam tables.

### Development signer instead of a fake Firebase
**Decision:** when no Admin credential exists in a non-production environment, the Worker can mint its own
HMAC tokens (`dev.` prefix).
**Cost:** a second auth path to reason about.
**Benefit:** the whole product is testable offline with real permissions and real sessions, and the three
rails (flag, environment, missing credential) plus the `dev: true` claim make it impossible to enable in a
production deployment. 144 automated assertions run on this path.

### Forward-only migrations
**Decision:** numbered SQL files applied with `wrangler d1 migrations apply`.
**Cost:** reverting requires a new migration.
**Benefit:** production stays auditable; `--local` and `--remote` run identical SQL.

---

## Known limitations

| Area | Limitation | Mitigation |
| --- | --- | --- |
| Papers | No in-app PDF file picker; papers are registered by URL | Upload in Firebase/R2 first, then paste the URL (see STORAGE.md) |
| R2 media | `/api/media/*` is unlisted, not access-controlled | Use Firebase Storage token URLs for gated papers |
| Sheets | Sandboxed environments cannot reach Google; unconfigured syncs report `failed` | Admin console is a full alternative |
| Rankings | Cohort < 5 yields no rank | Documented and expected |
| Attempts | One live attempt per exam per student | By design; resume instead |
| CSV exports | Capped at 5 000–10 000 rows | Filter by exam, or page the API |
| Cron | 15-minute granularity | `scheduledAt` notifications have ±15 min resolution |
| Search | `LIKE`-based, no stemming | Adequate for the catalogue size; swap for FTS5 if needed |
| i18n | UI copy is English only | Content language is per-lecture (`language` column) |
