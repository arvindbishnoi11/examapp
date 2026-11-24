# Deployment

PrepSetu is a single Cloudflare Worker that serves **both** the JSON API and the compiled PWA from `dist/`.
One deploy, one origin, no CORS to babysit.

---

## 0. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js **20+** | `node --version` |
| Cloudflare account | Workers + D1 (R2 optional) |
| Firebase project | Auth (Google + email/password), optional Storage and FCM |
| `wrangler` | Installed as a dev dependency; `npx wrangler login` |

```bash
npm ci
npx wrangler login
```

---

## 1. Create the D1 database

```bash
npx wrangler d1 create prepsetu
```

Copy the printed `database_id` into `wrangler.jsonc` → `d1_databases[0].database_id` (the repository ships a
placeholder id). Keep `database_name: "prepsetu"` — the npm scripts reference it.

```bash
npm run db:migrate:remote     # 0001 schema + 0002 reference data
```

> `0002_seed_reference_data.sql` seeds permissions, roles, role→permission mappings and default platform
> settings. It seeds **no content** — courses and questions come from Sheets or the admin console.

Optional: `npx wrangler r2 bucket create prepsetu-media`, then uncomment the `r2_buckets` binding
(see [STORAGE.md](STORAGE.md)).

---

## 2. Set secrets

```bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON   # verify ID tokens + FCM
npx wrangler secret put FIREBASE_PROJECT_ID             # e.g. rankup29
npx wrangler secret put SUPER_ADMIN_EMAIL               # first super admin
npx wrangler secret put ADMIN_SESSION_SECRET            # 32+ random bytes
npx wrangler secret put IP_HASH_SECRET                  # 16+ random bytes
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON     # optional: Sheets sync
npx wrangler secret put GOOGLE_SHEETS_SPREADSHEET_ID    # optional
npx wrangler secret put YOUTUBE_API_KEY                 # optional: metadata
```

Generate the secrets instead of inventing them:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Public** values (Firebase web config, spreadsheet id, VAPID key) do **not** go in Worker secrets — they are
compiled into `public/env.js` by `scripts/build-config.mjs` from `.env` / `.env.local` at build time. Copy
`.env.example` to `.env`, fill it in, and never add a private key there (the script refuses to build if it
detects one).

Non-secret Worker vars live in `wrangler.jsonc` → `vars` (`APP_NAME`, `APP_ENV`, `FIREBASE_PROJECT_ID`,
`SUPER_ADMIN_EMAIL`, `GOOGLE_SHEETS_SPREADSHEET_ID`, `ALLOWED_ORIGINS`, `DEFAULT_CACHE_TTL`). Set
`APP_ENV` to `production` **before** the first deploy — it disables the development signer permanently.

---

## 3. Build and deploy

```bash
npm run build      # build:config → vite build → dist/
npm run deploy     # build again + wrangler deploy
```

`wrangler.jsonc` serves `./dist` with `not_found_handling: "single-page-application"` and
`run_worker_first: ["/*"]` — every request enters the Worker, which answers `/api/*` itself and delegates the
rest to `ASSETS.fetch` (which supplies the `index.html` fallback for client-side routes).

Routing everything through the Worker is deliberate: **Workers static assets have no header configuration**
(no `_headers` equivalent, unlike Pages), so the only way an HTML page gets a CSP, `X-Frame-Options` or HSTS
is for the Worker to add them. See [ARCHITECTURE.md](./ARCHITECTURE.md#layers).

First deploy on `*.workers.dev`:

```
https://prepsetu.<subdomain>.workers.dev
```

---

## 4. Verify

```bash
# Health: DB reachable
curl -s https://<host>/healthz
# {"status":"ok","db":true,"time":"…"}

# Modes and guards
curl -s https://<host>/api/auth/config
# → "authMode":"firebase", "devAuthEnabled":false

# Authenticated smoke test against the deployment
BASE_URL=https://<host> npm run test:api     # needs a super-admin session; see note
```

> The API smoke test signs in with `POST /api/auth/dev-login`, which is disabled in production by design.
> Run it locally (`npx wrangler dev --local`) for the full suite; in production use it as a read-only probe
> by setting `DEV_AUTH=false` (it then checks `/healthz`, `/api/auth/config`, the public catalogue and that
> admin routes return `401`).

Then in the browser:

1. Sign in **with the `SUPER_ADMIN_EMAIL` mailbox** → you land in the admin console with `super_admin`.
2. **Admin → Settings**: confirm the environment, integration statuses and that locked keys show a lock.
3. **Admin → Courses**: create a class, exam type, course, subject and chapter.
4. **Admin → Question bank → New question**, then **Examinations → New**, attach the question, publish.
5. Open `/tests` in a private window as a student and take the mock end to end.
6. **Admin → Results** → publish, then confirm the student sees the score and review.
7. **Admin → Audit log** should list every step above.

---

## 5. Custom domain & aliases

```toml
# wrangler.jsonc
"routes": [{ "pattern": "prepsetu.example.com", "custom_domain": true }]
```

Then add the hostname to `ALLOWED_ORIGINS` (comma-separated) only if the frontend is ever served from a
different origin. When the PWA and API share an origin, leave `ALLOWED_ORIGINS` empty — CORS then rejects
everything cross-origin, which is what you want.

### Firebase Authorized domains

Add the deployment hostname under **Firebase console → Authentication → Settings → Authorized domains**, or
Google sign-in fails with `auth/unauthorized-domain`.

---

## 6. Cron

`wrangler.jsonc` registers `*/15 * * * *`. Every run:

1. Incremental Sheets sync (skipped when credentials are absent or `sheets.sync_enabled=false`, and throttled
   to `sheets.sync_interval_minutes`).
2. Closes attempts whose server deadline + grace has passed, evaluating and publishing their results.
3. Sends scheduled push notifications whose time has arrived.
4. Purges expired cache and rate-limit rows.

All jobs are idempotent, fail independently, and log a single structured line. Watch them with:

```bash
npx wrangler tail --format pretty
```

---

## 6b. Web push (optional)

Push needs **three** things, and each fails independently:

| Piece | Where | Effect if missing |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Worker secret | The Worker cannot sign FCM v1 requests; sends fail with a provider error |
| `VITE_FIREBASE_VAPID_KEY` | `.env` → `public/env.js` at build time | The browser cannot obtain a device token; the profile toggle explains this |
| `firebase-messaging-sw.js` | Served from the site root | Background messages never display |

Get the key from **Firebase console → Project settings → Cloud Messaging → Web Push certificates → Key pair**,
put it in `.env` as `VITE_FIREBASE_VAPID_KEY`, then rebuild (`npm run build`) — it is baked into
`public/env.js` by `scripts/build-config.mjs`. The same project must back both halves; a token minted for
`rankup29` is useless to a Worker authenticating as another project.

Students enable push themselves from **Profile → Notifications → Push notifications**; the toggle requests
permission inside the click, registers the token, and the sign-out path unregisters it so a shared device stops
receiving the previous student's reminders. In-app notifications work with none of this configured.

---

## 7. Rollback

Workers keep version history:

```bash
npx wrangler deployments list
npx wrangler rollback            # previous version
```

A rollback reverts **code and bindings**, not the database. Migrations are forward-only in this project: write
a new migration to undo a change rather than editing an applied one.

---

## 8. CI checklist

```bash
npm ci
npm run typecheck        # browser + worker
npm run lint:secrets     # fails on private keys / tracked .dev.vars
npm run build
npm run db:migrate:local && npx wrangler dev --port 8799 --local &
npm run test:api
```

`test:e2e` (Playwright) is optional and exits **78** when no browser is installed, so it never blocks a build
in a bare image.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/healthz` returns HTML | `run_worker_first` not set to `["/*"]` | Restore `run_worker_first: ["/*"]` in `wrangler.jsonc` |
| Pages have no CSP / can be framed | `run_worker_first` narrowed to `/api/*` | Restore `["/*"]`; `npm run test:api` asserts the headers |
| `no such table` | migrations not applied to that database | `npm run db:migrate:remote` |
| 500 on every API call | `FIREBASE_PROJECT_ID`/secret mismatch | `npx wrangler tail` for the logged error |
| Sign-in works, API 401 | Admin SDK credential absent/enableable | Re-put `FIREBASE_SERVICE_ACCOUNT_JSON` |
| `auth/unauthorized-domain` | hostname not authorised in Firebase | Add it to Authorized domains |
| Blank page after deploy | `dist/` not built | `npm run build` then `wrangler deploy` |
| Old assets served | service worker cache | Bump `CACHE_VERSION` in `public/sw.js`; users get the new SW on next visit |
| `DEV_AUTH_ENABLED` accepted in prod | `APP_ENV` not `production` | Set it in `vars`; rotate `ADMIN_SESSION_SECRET` |
