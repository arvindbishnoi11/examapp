# API reference

Base URL: same origin as the app. Every path is under `/api`. **166 routes** are registered; this document
groups them by purpose.

Run the Worker locally and fetch the live inventory (non-production only):

```bash
curl -s http://127.0.0.1:8799/api/__routes | jq '.groups | keys, (.public|length), (.admin|length)'
```

---

## Conventions

**Auth** — `Authorization: Bearer <firebase-id-token>`. Routes marked 🔒 require a session; 🔐 require a
specific permission. Missing token ⇒ `401`, insufficient permission ⇒ `403`.

**Pagination** — every list accepts `page` (1-based) and `pageSize` (route-specific cap) and returns:

```json
{ "items": [], "page": 1, "pageSize": 25, "total": 0, "totalPages": 0 }
```

**Errors** — always that envelope:

```json
{ "error": { "code": "bad_request", "message": "Human readable.", "details": [], "requestId": "uuid" } }
```

| Status | Code examples | Meaning |
| --- | --- | --- |
| 400 | `bad_request`, `validation_failed` | Malformed body/params (`details` lists field errors) |
| 401 | `unauthorized` | Missing/expired token |
| 403 | `forbidden` | Valid session, missing permission |
| 404 | `not_found` | Unknown id or route |
| 405 | `method_not_allowed` | Wrong verb (`Allow` header lists valid ones) |
| 409 | `conflict`, `sync_in_progress` | Unique/resource conflict |
| 412 | `r2_not_configured` | Feature needs a binding/secret |
| 422 | `title_required` | Content needs manual input (YouTube metadata unavailable) |
| 429 | `rate_limited` | Back off |
| 502 | — | Upstream (FCM/Google) failure |

CSV endpoints (`/export`, `/download`) return `text/csv` instead of JSON.

---

## Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/healthz` | `{status, db, time}`; `503` when D1 is unreachable |
| GET | `/api/auth/config` | Site name, feature flags, `devAuthEnabled`, `authMode` |
| GET | `/api/home` | Classes, exam types, featured courses, latest lectures, upcoming/popular exams, announcements, series, `continueLearning`, `stats` (signed-in) |
| GET | `/api/classes` | `{ items }` |
| GET | `/api/exam-types` | `{ items }` |
| GET | `/api/courses` | Published courses; filters `classId`, `examTypeId`, `q`, `free` |
| GET | `/api/courses/:id` | Course + subjects + counts |
| GET | `/api/courses/:id/subjects` | Subjects in a course |
| GET | `/api/subjects?courseId=` | Subjects |
| GET | `/api/chapters?subjectId=&courseId=` | Chapters |
| GET | `/api/lectures` | Filters `courseId`, `chapterId`, `seriesId`, `q` |
| GET | `/api/lectures/:id` | Lecture + series navigation + progress (signed-in) |
| GET | `/api/lecture-series`, `/api/lecture-series/:id` | Series and their lectures |
| GET | `/api/exams` | Published/scheduled exams visible to the caller |
| GET | `/api/exams/:id` | Public exam detail (no answer keys, ever) |
| GET | `/api/search?q=` | `{ courses, lectures, exams, papers, query }` |
| GET | `/api/announcements` | Public announcements feed |
| GET | `/api/test-papers`, `/api/test-papers/:id` | PDF library |

---

## Auth

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/auth/me` 🔒 | User, roles, flattened permissions, onboarding state |
| PUT | `/api/auth/profile` 🔒 | `fullName`, `classId`, `targetExamTypeId`, `studyGoalMinutes`, … |
| POST | `/api/auth/onboarding` 🔒 | Requires `fullName`, `classId`, `targetExamTypeId`, `studyGoalMinutes`; validates references |
| POST | `/api/auth/verify` 🔒 | Server-side session verification after Firebase sign-in |
| POST | `/api/auth/logout` 🔒 | Audited |
| DELETE | `/api/auth/account` 🔒 | Erasure; body `{ "confirm": "DELETE" }` |
| POST | `/api/auth/dev-login` | **Development only** — `{ email, name? }` → `{ token, expiresAt }` |

---

## Student

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/student/dashboard` 🔒 | Continue learning, upcoming tests, streak, weekly minutes |
| GET | `/api/student/progress` 🔒 | Per-course/subject completion |
| POST | `/api/student/goal` 🔒 | Update the daily study goal |
| GET | `/api/progress/continue` 🔒 | Resume list |
| POST | `/api/lectures/:id/progress` 🔒 | `watchedSeconds`, `percent`, `completed`; throttled |
| GET | `/api/bookmarks` 🔒 | Saved items with hydrated titles |
| POST | `/api/bookmarks` 🔒 | `{ itemType, itemId }` toggles |
| GET | `/api/notifications` 🔒 | In-app feed |
| GET/PUT | `/api/notifications/preferences` 🔒 | `{ push, email, examReminders, newContent }`; unknown keys ignored |
| POST | `/api/notifications/register` 🔒 | FCM device token |
| POST | `/api/notifications/unregister` 🔒 | Deactivate a token |

---

## Exam attempt

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/exams/attempts` 🔒 | My attempts |
| POST | `/api/exams/:id/start` 🔒 | Creates or resumes the single live attempt → `{ attemptId, … }` |
| GET | `/api/exams/attempts/:attemptId` 🔒 | Session: `{ serverNowMs, expiresAtMs, questions[{examQuestionId,questionType,marks,negativeMarks,options[{key,text,imageUrl}]}], answers }` or `{ submitted, status, resultId }` |
| POST | `/api/exams/attempts/:attemptId/answers` 🔒 | `{ answers: [{ examQuestionId, selectedOptions?, numericAnswer? }] }` |
| POST | `/api/exams/attempts/:attemptId/heartbeat` 🔒 | Liveness; may auto-submit |
| POST | `/api/exams/attempts/:attemptId/submit` 🔒 | Grades, stores the result → `{ resultId }` |
| GET | `/api/results`, `/api/results/:id` 🔒 | Result summary + `review[]` when released |

Legacy aliases (`POST /api/exams/:id/answers`, `/submit`) remain registered for older clients.

---

## Admin — overview

All routes below require a staff session and the listed permission.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/admin/me` | — | Current admin + permissions |
| GET | `/api/admin/dashboard` | `dashboard.view` | Totals, trends, popular lectures, most-attempted exams |
| GET | `/api/admin/activity` | `dashboard.view` | Recent audit entries (paginated) |
| GET | `/api/admin/system/status` | `dashboard.view` | `{ sheetsConfigured, youtubeConfigured, firebaseAdminConfigured, superAdminEmail, environment, settings, time }` |
| GET | `/api/admin/meta/permissions` | `admins.view` | Permission catalogue `{key, group, label, dangerous}` |

## Admin — students

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/admin/students` | `students.view` — filters `q`, `status`, `classId`, `examTypeId`, `sort` |
| GET | `/api/admin/students/filters` | `students.view` — classes, exam types, statuses |
| GET | `/api/admin/students/:id` | `students.view` — profile + attempts + progress |
| PATCH | `/api/admin/students/:id` | `students.edit` |
| POST | `/api/admin/students/:id/status` | `students.suspend` — `{ status }` |
| DELETE | `/api/admin/students/:id` | `students.delete` — soft delete |
| GET | `/api/admin/students/export` | `students.export` — CSV |

## Admin — administrators & permissions

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/admin/admins` | `admins.view` |
| GET | `/api/admin/admins/roles` | `admins.view` — roles + role→permission matrix |
| GET | `/api/admin/admins/candidates` | `admins.create` |
| GET/PUT | `/api/admin/admins/:id/permissions` | `admins.permissions` — per-user overrides |
| POST | `/api/admin/admins/:id/status` | `admins.edit` |
| POST | `/api/admin/users` | `admins.create` — grant a staff role by email |
| PUT/DELETE | `/api/admin/users/:id/role` | `admins.edit` / `admins.delete` |
| PUT | `/api/admin/roles/:roleId/permissions` | `admins.permissions` |

Self-modification and any attempt to create a `super_admin` over HTTP are refused server-side.

## Admin — content & taxonomy

| Method | Path | Permission |
| --- | --- | --- |
| CRUD | `/api/admin/classes` | `courses.view` / `courses.manage` |
| CRUD | `/api/admin/exam-types` | `courses.view` / `courses.manage` |
| CRUD | `/api/admin/courses` (+ `/:id`) | `courses.view` / `courses.manage` |
| CRUD | `/api/admin/subjects?courseId=` | `courses.view` / `courses.manage` |
| CRUD | `/api/admin/chapters?subjectId=&courseId=` | `courses.view` / `courses.manage` |
| POST | `/api/admin/reorder` | `courses.manage` — bulk sort order |
| CRUD | `/api/admin/lectures` (+ `/:id`, `/:id/publish`) | `lectures.*` |
| CRUD | `/api/admin/lecture-series` | `lectures.manage` |
| POST | `/api/admin/youtube/metadata` | `youtube.manage` — URL → metadata (+ fallback) |
| GET/POST/DELETE | `/api/admin/youtube/playlists` (+ `/:id/sync`, `/:id/items`, `/:id/import`) | `youtube.manage` |

## Admin — examinations

| Method | Path | Permission |
| --- | --- | --- |
| CRUD | `/api/admin/test-series` | `test_series.manage` |
| GET/POST | `/api/admin/exams` | `exams.view` / `exams.manage` |
| GET/PUT/DELETE | `/api/admin/exams/:id` | `exams.view` / `exams.manage` |
| POST | `/api/admin/exams/:id/publish` | `exams.publish` |
| POST | `/api/admin/exams/:id/sections` | `exams.manage` |
| PUT/DELETE | `/api/admin/exam-sections/:id` | `exams.manage` |
| POST | `/api/admin/exams/:id/questions` | `exams.manage` — `{ questionIds[], sectionId? }` |
| PUT | `/api/admin/exam-questions/:id` | `exams.manage` — marks, order, section |
| DELETE | `/api/admin/exams/:examId/questions/:questionId` | `exams.manage` |
| GET | `/api/admin/attempts` | `results.view` |
| POST | `/api/admin/attempts/:id/submit` | `results.view` — force submit |
| CRUD | `/api/admin/questions` (+ `/:id`, `/bulk-status`) | `questions.view` / `questions.manage` |

## Admin — results, papers, communication

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/admin/results` | `results.view` — filters `examId`, `published`, `q` |
| POST | `/api/admin/results/publish` | `results.publish` — `{ examId \| resultIds, publish }` |
| GET | `/api/admin/results/export?examId=` | `results.export` — CSV |
| GET/POST/PUT/DELETE | `/api/admin/test-papers` | `test_papers.manage` |
| POST | `/api/admin/test-papers/upload` | `test_papers.manage` — multipart → R2 (`412` without the binding) |
| GET | `/api/media/*` | public — streamed R2 object |
| GET | `/api/admin/notifications` (+ `/health`) | `notifications.manage` |
| POST | `/api/admin/notifications/send` | `notifications.send` |
| POST | `/api/admin/notifications/audience-preview` | `notifications.manage` |
| CRUD | `/api/admin/announcements` | `announcements.manage` |

## Admin — sheets, analytics, audit, settings

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/admin/sheets/status` \| `/mappings` \| `/logs` \| `/logs/:id` | `sheets.view` |
| POST | `/api/admin/sheets/preview-sync` \| `/sync` \| `/cache/purge` | `sheets.sync` |
| GET | `/api/admin/analytics/overview?days=` | `analytics.view` |
| GET | `/api/admin/analytics/exam/:id` | `analytics.view` |
| GET | `/api/admin/analytics/students/active?days=` | `analytics.view` |
| GET | `/api/admin/audit-logs` (+ `/export`) | `audit.view` |
| GET/PUT | `/api/admin/settings` | `settings.view` / `settings.manage` (+ super-admin-only keys) |
| GET | `/api/admin/settings/integrations` | `settings.view` |

---

## Examples

Start and submit an attempt:

```bash
TOKEN=$(curl -s -X POST localhost:8799/api/auth/dev-login \
  -H 'content-type: application/json' \
  -d '{"email":"student@prepsetu.test"}' | jq -r .token)

EXAM=90000000-0000-4000-8000-000000000093
ATTEMPT=$(curl -s -X POST localhost:8799/api/exams/$EXAM/start \
  -H "authorization: Bearer $TOKEN" | jq -r .attemptId)

curl -s localhost:8799/api/exams/attempts/$ATTEMPT -H "authorization: Bearer $TOKEN" | jq '{serverNowMs, q: (.questions|length)}'

curl -s -X POST localhost:8799/api/exams/attempts/$ATTEMPT/answers \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"answers":[{"examQuestionId":"<from the session>","selectedOptions":["B"]}]}'

curl -s -X POST localhost:8799/api/exams/attempts/$ATTEMPT/submit \
  -H "authorization: Bearer $TOKEN" | jq .
```

Publish results for an exam:

```bash
curl -s -X POST localhost:8799/api/admin/results/publish \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"examId":"90000000-0000-4000-8000-000000000093","publish":true}' | jq .
```

Register a PDF already hosted on Firebase Storage:

```bash
curl -s -X POST localhost:8799/api/admin/test-papers \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"title":"JEE Main 2025 Paper 1","fileUrl":"https://firebasestorage.googleapis.com/…pdf",
       "fileSizeBytes":2100000,"year":2025,"visibility":"authenticated","status":"published"}'
```

---

## Rate limits

D1-backed, keyed by a hashed IP plus user id. Buckets include `authVerify`, `write`, `upload`, `sheets`,
`notifications`, `audit`. Exceeding a bucket returns `429 rate_limited`; the client shows “Too many attempts.
Please wait a moment and try again.”
