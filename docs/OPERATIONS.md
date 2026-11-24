# Operations runbook

Day-two operations: monitoring, routine tasks, and what to do when something breaks.

---

## Monitoring

| What | How | Healthy looks like |
| --- | --- | --- |
| Liveness | `GET /healthz` from an uptime monitor every minute | `200 {"status":"ok","db":true}` |
| Errors | `npx wrangler tail --format pretty` | no `unhandled_api_error` lines |
| Cron | tail shows `scheduled_sync` once per 15 min | `status: success` or nothing (unconfigured) |
| Admin health | **Admin → Dashboard** banner | all three integrations green, or an explained gap |
| Sheets | **Admin → Sheets sync → Sync history** | latest run `success`, `failed` count 0 |
| Push | **Admin → Notifications → health** | `configured: true`, token count > 0 |
| Audit | **Admin → Audit log**, filter status `failure` | empty except known test entries |

Log lines are structured JSON-ish and always include the `X-Request-Id` that the client also receives — ask a
user for that id and you can find the exact request in the tail.

---

## Routine tasks

| Cadence | Task |
| --- | --- |
| Daily | Check `/healthz`, the dashboard banner, and yesterday's sync history |
| Weekly | Review `audit_logs` for `failure`/`denied`; check storage growth in R2/Firebase |
| Monthly | Re-run `npm run lint:secrets`; rotate `IP_HASH_SECRET` only with a plan (keys rehash); review staff roles |
| Per release | `typecheck` → `lint:secrets` → `build` → `test:api` → deploy → browser smoke |
| Per term | Archive finished courses/exams; review `platform_settings`; refresh announcements |

### Publish results for a finished mock

1. **Admin → Results** → choose the examination → **Export CSV** (keep a copy).
2. **Publish for filtered exam** → confirm. Students immediately see score, review and rank (if cohort ≥ 5).
3. Spot-check one student's result page.

### Recover a stuck attempt

```bash
# Find long-running attempts
npx wrangler d1 execute prepsetu --remote --command \
  "SELECT id, exam_id, user_id, expires_at_ms FROM exam_attempts WHERE status='in_progress' ORDER BY started_at_ms LIMIT 20"
```

The cron closes anything past `expires_at_ms + 45s` automatically. If you cannot wait, force-submit from the
admin API:

```bash
curl -X POST https://<host>/api/admin/attempts/<attemptId>/submit \
  -H "authorization: Bearer <admin-token>"
```

This evaluates and stores the result exactly as a normal submission would, and is audit-logged.

### Purge stale caches

- Catalogue: **Admin → Sheets sync → Purge catalogue cache** (or `POST /api/admin/sheets/cache/purge`).
- Browser/service worker: bump `VERSION` in `public/sw.js`, rebuild, deploy. Users pick up the new worker on
  their next navigation.
- Rate-limit rows: pruned by the cron; no action needed.

---

## Incident playbooks

### “Everyone is signed out” / all API calls 401

1. Confirm `FIREBASE_SERVICE_ACCOUNT_JSON` still exists: `npx wrangler secret list`.
2. `/api/auth/config` should say `authMode: "firebase"`. If it says `development`, the secret is missing —
   re-put it immediately (this is a security incident, see below).
3. Check the Firebase project status and that the service account was not disabled.
4. Tokens verify against Google's certs; a clock-skewed deployment is not a cause on Workers.

### Site is up but content is stale

1. Was a sync expected? Check **Sync history** for a recent `failed` run — the row carries the error message.
2. Purge the catalogue cache.
3. Re-run a **Preview** to see whether the spreadsheet itself is stale.

### A student claims their answers were lost

1. Look up the attempt: `SELECT * FROM exam_attempts WHERE id = '<attemptId>'` → check `status`,
   `submitted_at`, `time_spent_seconds`.
2. `SELECT question_id, selected_options, evaluation, marks_awarded FROM attempt_answers WHERE attempt_id = …`
   — autosaves land every ~2.5 s, so a lost answer is usually an unanswered question, not a lost write.
3. Compare `time_spent_seconds` against the duration to see whether the attempt auto-submitted.

### Push notifications are failing

1. **Admin → Notifications → health** — if `configured: false`, the FCM service-account secret is missing.
2. A `502` response from `send` includes the provider message; it is also stored on the notification row
   (`error_message`) and in the audit log.
3. Zero recipients means no active tokens — students must install the PWA and grant permission. In-app
   notifications still appear regardless.

### Suspected secret leak

1. **Rotate first, investigate second.**
   - `ADMIN_SESSION_SECRET` — invalidates all development tokens.
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — create a new key in Google Cloud, replace, delete the old one.
   - `GOOGLE_SERVICE_ACCOUNT_JSON` / `YOUTUBE_API_KEY` — same pattern.
2. `npm run lint:secrets` to confirm the working tree is clean.
3. Review `audit_logs` for actions by unexpected actors around the exposure window.
4. If `DEV_AUTH_ENABLED` was ever `true` in production, treat every session as forged: rotate the session
   secret, set `APP_ENV=production`, redeploy, and review data created in that window.

---

## Backups

D1 export (SQL dump):

```bash
npx wrangler d1 export prepsetu --remote --output=backup-$(date +%F).sql
```

Restore into a fresh database and repoint the binding:

```bash
npx wrangler d1 create prepsetu-restore
npx wrangler d1 execute prepsetu-restore --remote --file=backup-2026-11-24.sql
```

Take an export **before** every schema migration and before bulk content operations. Keep them outside the
repository (the `.gitignore` already excludes dumps).

Files: R2 objects are backed up with `npx wrangler r2 object get`, or rely on the bucket's own retention.
Firebase Storage is backed up in the Firebase console.

---

## Performance

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Slow home page | catalogue cache expired and a cold build | acceptable; raise `DEFAULT_CACHE_TTL` |
| Slow exam session | too many questions in one section | split into sections (≤ 50 questions each) |
| 429s under load | shared IP (school network) hitting per-IP limits | raise the bucket limit in `worker/lib/rate-limit.ts` |
| Large admin pages | `pageSize` too high | keep ≤ 50 |
| Worker CPU errors | CPU-heavy sync of huge sheets | reduce sheet size or split by entity |

Workers have a CPU ceiling (`limits.cpu_ms` in `wrangler.jsonc`); Sheets sync is the only operation that can
approach it. If a sync times out, run it per-entity by passing `sheets: ["questions"]`.

---

## Access management

| Need | Where |
| --- | --- |
| Add an administrator | Admin → Administrators → Add (requires `admins.create`) |
| Add a granular permission | Admin → Administrators → open user → permissions |
| Remove all access | Admin → Administrators → remove role (`admins.delete`) |
| Suspend a student | Admin → Students → status → suspended |
| Transfer super admin | Change `SUPER_ADMIN_EMAIL`, redeploy, sign in with the new mailbox |

An administrator cannot suspend themselves, change their own roles, or grant `super_admin` over HTTP. Those
guards live in the Worker, not the UI.

---

## Release checklist

```
□ npm run typecheck
□ npm run lint:secrets
□ npm run build
□ npx wrangler dev --port 8799 --local  +  npm run test:api     (all assertions green)
□ npm run db:migrate:remote            (if migrations changed — after taking a backup)
□ npm run deploy
□ curl https://<host>/healthz          → {"status":"ok","db":true}
□ Sign in as the super admin → Admin → Settings (integration status)
□ Open /tests as a student → start → submit → result
□ npx wrangler tail                    (watch for errors for a few minutes)
```
