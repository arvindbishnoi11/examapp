# Authentication & authorisation

PrepSetu has exactly one identity source — **Firebase Authentication** — and one authority for what a
session may do — **the Worker's permission set**. The browser is never trusted.

```
browser                         Worker                                   D1
───────                         ──────                                   ──
Firebase SDK sign-in
  ↓ ID token (JWT, ~1 h)
Authorization: Bearer <idToken>
                            verifyFirebaseIdToken()
                              • signature (Google certs)
                              • aud / iss / exp
                              • email_verified
                                  ↓
                            upsert users row  ───────────────────────► users
                            load roles + overrides ─────────────────► roles,
                            resolve permission Set                    user_roles,
                                  ↓                                  user_permission_overrides
                            requireAuth() / requirePermission(key)
```

## Modes

| Mode | When it is active | How a token is produced |
| --- | --- | --- |
| **Firebase** (production) | `FIREBASE_SERVICE_ACCOUNT_JSON` is set | Firebase Web SDK → ID token |
| **Development** | `DEV_AUTH_ENABLED=true` **and** `APP_ENV !== production` **and** no service-account JSON | `POST /api/auth/dev-login { email }` → HMAC-signed `dev.` token |

`GET /api/auth/config` reports which mode is live (`authMode`, `devAuthEnabled`) so the login screen can adapt.
**A production deployment can never mint a development token** — all three rails must hold, and the token
carries `dev: true`, which the verifier rejects in production.

> Never set `DEV_AUTH_ENABLED=true` in a deployed environment. `npm run lint:secrets` fails on it, and the
> dashboard shows a red configuration banner when Firebase Admin is missing.

## First Super Admin

1. Set `SUPER_ADMIN_EMAIL` (a Worker var or secret) to the mailbox that should own the platform.
2. That account is promoted to `super_admin` the first time it signs in, and **only** that account.
3. Everything else starts as `student`. Staff who need access are invited from **Admin → Administrators**
   by a super admin; the API refuses to grant `super_admin` over HTTP.

## Roles

| Role | Level | Intended scope |
| --- | --- | --- |
| `super_admin` | 100 | Everything, including administrator management and locked settings |
| `admin` | 80 | Full content, exams, students, results, communication (no admin management) |
| `content_manager` | 50 | Courses, taxonomy, lectures, announcements |
| `exam_manager` | 50 | Test series, examinations, question bank, test papers, results |
| `moderator` | 30 | Read access plus announcements and notifications |
| `student` | 0 | The student app only |

A user can hold several roles; the effective permission set is the **union** of role permissions plus
individual grants, minus individual revocations. Overrides live in `user_permission_overrides` and are
editable per user in the admin console.

## Permissions

39 keys in 10 groups — defined once in [`shared/permissions.ts`](../shared/permissions.ts) and seeded into
D1. Keys marked *dangerous* are shown with a warning in the grant UI.

| Group | Keys |
| --- | --- |
| Dashboard | `dashboard.view` |
| Students | `students.view`, `.edit`, `.suspend`*, `.delete`*, `.export`* |
| Administration | `admins.view`, `.create`*, `.edit`*, `.delete`*, `.permissions`* |
| Content | `courses.view`, `courses.manage`, `lectures.view`, `lectures.manage`, `lectures.publish`, `youtube.manage` |
| Examinations | `exams.view`, `exams.manage`, `exams.publish`, `questions.view`, `questions.manage`, `test_series.manage`, `test_papers.manage` |
| Results | `results.view`, `results.publish`, `results.export`* |
| Communication | `notifications.manage`, `notifications.send`*, `announcements.manage` |
| Data Sync | `sheets.view`, `sheets.sync`*, `sheets.configure`* |
| Insights | `analytics.view`, `audit.view` |
| Platform | `settings.view`, `settings.manage`*, `storage.manage`*, `platform.export`* |

`*` dangerous. **The frontend uses permissions only to hide controls** — every privileged route re-checks
with `requirePermission()` on the server, and the API smoke test asserts that a student token gets a `403`.

### Super-admin-only settings

Regardless of the `settings.manage` permission, these keys are writable only by the Super Admin:

```
site.maintenance_mode      features.registration_open   features.push_notifications
storage.test_paper_provider storage.max_pdf_mb          sheets.spreadsheet_id
sheets.sync_enabled        sheets.sync_interval_minutes youtube.metadata_enabled
cache.catalogue_ttl_seconds
```

## Session lifecycle

| Step | Endpoint | Notes |
| --- | --- | --- |
| Bootstrap config | `GET /api/auth/config` | Public: site name, feature flags, `devAuthEnabled`, `authMode` |
| Current session | `GET /api/auth/me` | Returns user, roles, flattened permissions, onboarding state |
| Profile | `PUT /api/auth/profile` | Display name, class, target exam, goals |
| Onboarding | `POST /api/auth/onboarding` | `fullName`, `classId`, `targetExamTypeId`, `studyGoalMinutes`; validates the referenced rows |
| Logout | `POST /api/auth/logout` | Audited; Firebase tokens expire client-side |
| Delete account | `DELETE /api/auth/account` | GDPR-style erasure of personal data; requires `{ confirm: "DELETE" }` |

Tokens are **never** stored in `localStorage` in production — the Firebase SDK keeps them in IndexedDB and
the API client asks for a fresh ID token on every request. In development the HMAC token is kept under
`prepsetu.dev.token` so reloads survive.

## Security measures

- **ID tokens verified server-side** against Google's public certificates, with `aud` (project id), `iss`,
  `exp` and `email_verified` checks. A missing Admin credential means no Firebase sign-in — never an
  unverified bypass.
- **Rate limiting** on every auth write (`RATE_LIMITS.authVerify`, `RATE_LIMITS.write`), keyed by a hashed IP
  plus user id, backed by the `rate_limits` table.
- **No account enumeration**: password reset always reports success.
- **Suspension** is enforced on every request (`users.status`), not just at sign-in.
- **Audit trail** for logins, permission changes, role grants and account deletion, with before/after JSON.
- **Self-protection**: an administrator cannot suspend themselves, change their own roles, or remove the
  last super admin — enforced server-side.
- **Security headers** (`withSecurityHeaders`): CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, `Permissions-Policy`; API responses also carry `X-Request-Id` for support.
  These apply to HTML documents too, which requires `run_worker_first: ["/*"]` — a narrower value lets the
  asset layer answer navigations and the pages ship unprotected.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Sign-in succeeds, API returns 401 | Worker has no `FIREBASE_SERVICE_ACCOUNT_JSON` | Add the secret; or use development mode locally |
| `authMode: "firebase"` but login screen says “not configured” | `public/env.js` has no Firebase web config | `npm run build:config` with `.env` present, then rebuild |
| Admin console shows “no permission” | Account has no staff role | Promote via **Administrators**, or set `SUPER_ADMIN_EMAIL` to that mailbox |
| Everyone is an admin | `DEV_AUTH_ENABLED` leaked into production | Remove the var, rotate `ADMIN_SESSION_SECRET`, run `npm run lint:secrets` |
