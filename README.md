# PrepSetu

A production-grade preparation platform for **Class 11, Class 12, JEE Main, JEE Advanced, NEET and CBSE boards**:
video lectures, chapter tests, full-length mocks with server-side evaluation, previous-year PDF papers,
progress tracking, announcements and push notifications — delivered as an installable PWA.

Everything runs on **Cloudflare Workers + D1 + static assets**. There is no separate backend server, no
container, no queue service and no payment gateway: the whole product is one Worker.

```
┌──────────────────────────────┐        ┌────────────────────────────────────────┐
│  React PWA (Vite)            │  /api  │  Cloudflare Worker (TypeScript)        │
│  student app + admin console │ ─────► │  router → services → D1                │
│  installable, offline shell  │        │  sessions · exams · sheets · fcm       │
└──────────────────────────────┘        └────────────────────────────────────────┘
                                                       │
                          ┌────────────────────────────┼─────────────────────────────┐
                          ▼                            ▼                             ▼
                    D1 (SQLite)               Google Sheets (content)      YouTube Data API
                    users, exams…            authoring + 15-min cron      metadata (optional)
```

---

## What is included

**Student app** — home feed, course catalogue, lecture player with resume, series pages, test list and
exam runner, results with per-question solutions, PDF library, bookmarks, announcements, notifications, profile.

**Exam engine** — server-authoritative timing (never trusts the browser clock), per-student seeded shuffling,
one live attempt at a time, 2.5 s debounced autosave with flush on tab-hide, 60 s heartbeat, auto-submit on
expiry with a 45 s grace window, MCQ partial credit, integer/numerical tolerance, precomputed ranks and
percentiles, and release modes (`immediate`, `after_window`, `manual`). **Answer keys never leave the Worker
before the result is released.**

**Admin console** — 18 screens covering dashboard, students, administrators and per-user permission overrides,
courses, taxonomy, lectures and YouTube playlists, test series, exam builder, question bank, PDF papers,
results, push composer, announcements, Sheets sync, analytics, audit log and platform settings.

**Security** — Firebase ID-token verification (or a gated development signer), 39 granular permissions across
10 groups, Super-Admin-only settings, D1-backed rate limiting, privacy-preserving IP hashing, full audit trail
with before/after snapshots, strict security headers and a CSP.

---

## Quick start

```bash
npm install                       # Node 20+ required
cp .dev.vars.example .dev.vars    # local Worker secrets (git-ignored)
npm run db:migrate:local          # create the schema
npm run db:seed:local             # optional demo content
npm run build                     # generates public/env.js + icons, then Vite
npx wrangler dev --port 8799 --local
```

Open <http://localhost:8799>. In development (`DEV_AUTH_ENABLED=true`) the sign-in screen accepts **any email**
without a password — use `arvindbishnoi@gmail.com` (the configured `SUPER_ADMIN_EMAIL`) to enter the admin console
at `/admin`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Build config, build the PWA, start `wrangler dev` |
| `npm run dev:ui` | Vite only (hot reload) — API calls need a Worker on port 8799 |
| `npm run build` | `build:config` → `vite build` into `dist/` |
| `npm run typecheck` | Strict TypeScript for both the browser and the Worker |
| `npm run test:api` | 144-assertion HTTP smoke test against a running Worker |
| `npm run test:e2e` | Browser journey test (needs `playwright` + Chromium) |
| `npm run lint:secrets` | Fails if a private key or credential reaches a tracked file |
| `npm run db:migrate:remote` | Apply migrations to the production D1 database |
| `npm run deploy` | Build and `wrangler deploy` |

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | First deploy, secrets, custom domains, cron, rollback, smoke tests |
| [docs/AUTH.md](docs/AUTH.md) | Firebase sign-in, ID-token verification, development signer, roles and permissions |
| [docs/EXAMS.md](docs/EXAMS.md) | Exam lifecycle, timing model, grading rules, result release |
| [docs/SHEETS.md](docs/SHEETS.md) | Spreadsheet authoring, column contract, sync semantics, troubleshooting |
| [docs/STORAGE.md](docs/STORAGE.md) | Firebase Storage vs R2 for PDFs, upload paths, limits |
| [docs/API.md](docs/API.md) | Endpoint reference (student + admin) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Schema overview, caching, rate limits, decisions and trade-offs |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Runbooks: incidents, rollbacks, backups, monitoring |

---

## Repository layout

```
migrations/          D1 schema (0001) + reference data (0002)
shared/              Types and constants shared by Worker and browser
worker/
  index.ts           Entry point: routing, CORS, security headers, cron
  lib/               Router, validators, rate limiting, audit, cache, slugs
  services/          Auth, sessions, YouTube, Google Sheets, FCM, exam engine
  routes/            HTTP handlers (auth, catalogue, lectures, exams, admin/*)
src/
  pages/             Student, auth and admin screens
  components/        UI kit, layout, exam runner, admin building blocks
  context/           Auth, theme, toast providers
  lib/               API client, formatting, Firebase glue, offline queue
scripts/             Build config, icon generator, seed data, tests
```

---

## Design decisions worth knowing

- **Server is the source of truth for time.** The runner receives `serverNowMs` and derives a clock offset;
  a laptop clock change cannot extend an attempt. Deadlines are re-checked on every write.
- **No answer keys in the exam payload.** The session response is built from a projection that omits
  `is_correct`, `correct_options` and explanations entirely, and a test asserts it.
- **Content authoring is spreadsheet-first, but optional.** Sheets sync is incremental, idempotent and
  audited; the admin console can do everything without Google at all.
- **Progressive enhancement, not a spinner.** The PWA ships a boot skeleton, an offline page and a
  stale-while-revalidate service worker; the API degrades to documented errors when an integration is
  unconfigured rather than 500ing.
- **No payment gateway.** Courses can be marked free/paid for visibility, but nothing charges a student.
  See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#no-payments-by-design).

---

## Licence

Proprietary — © PrepSetu. All rights reserved.
