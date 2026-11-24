# Exam engine

The examination engine is the most sensitive part of PrepSetu. This document describes exactly what happens
between “student taps Start” and “student sees a score”, and the rules that make those numbers defensible.

---

## Lifecycle

```
draft ──publish──► scheduled ──(start_at reached)──► published
  ▲                   │                                 │
  └────unpublish──────┴─────────────archive─────────────┘
```

| Status | Visible to students | Can be started |
| --- | --- | --- |
| `draft` | No | No |
| `scheduled` | Yes (countdown) | Only after `start_at` |
| `published` | Yes | Yes, inside the window if `end_at` is set |
| `archived` | No | No |

Publishing requires **at least one question**; the API recomputes `total_questions` / `total_marks` and returns
`409` otherwise. Deleting an examination that has attempts is refused — archive it instead.

---

## Timing model

**The server owns the clock.** Nothing about the deadline is stored in the browser.

1. `POST /api/exams/:id/start` creates an attempt row with `started_at_ms` and `expires_at_ms`
   (`started_at_ms + duration_minutes × 60 000`). A partial unique index guarantees **one live attempt per
   (exam, student)**; a second `start` resumes the existing attempt instead of creating another.
2. The session payload returns `serverNowMs`. The runner computes `offset = serverNowMs − Date.now()` once and
   renders the countdown from `expires_at_ms − (Date.now() + offset)`. Changing the device clock does nothing.
3. Every write re-validates the deadline server-side. Past the deadline the API refuses new answers.
4. **Grace window: 45 s** (`GRACE_SECONDS`). A submit that lands up to 45 s after expiry is still accepted —
   this absorbs mobile network stalls without giving anyone extra thinking time (the recorded
   `time_spent_seconds` is capped at `duration + grace`).
5. The client auto-submits at zero, and the server also auto-submits on the next heartbeat/session read if the
   deadline passed. A killed tab cannot leave an attempt open forever.
6. Result rows are stamped `auto_submitted` when the server closed the attempt, so admins can tell them apart.

### Client cadence

| Interval | Action |
| --- | --- |
| 2.5 s (debounced) | Autosave changed answers (`POST /api/exams/attempts/:id/answers`) |
| On `visibilitychange` → hidden, or `online` | Immediate flush |
| 60 s | Heartbeat (`POST /api/exams/attempts/:id/heartbeat`) — refreshes liveness and can trigger auto-submit |

Answers are posted as a delta keyed by `examQuestionId`; the server upserts `attempt_answers`.

---

## Question types and grading

| `questionType` | Stored key | Evaluation |
| --- | --- | --- |
| `single_correct` | `correct_options` | Full marks for the one correct key, else `−negative_marks` |
| `multiple_correct` | `correct_options` (JSON array) | Full marks for an exact match; **partial** = `marks × selected / correct` when every selected option is correct; any incorrect selection = `−negative_marks` |
| `numerical` | `numeric_answer` + `numeric_tolerance` | Correct when `abs(answer − key) ≤ tolerance` |
| `integer` | `integer_answer` | Exact integer match |
| `passage` / `image_based` | as MCQ | Graded on the underlying answer type |

Unattempted questions score `0` and are never penalised. Negative marking applies only when
`negative_marking_enabled = 1`, and the per-question `negative_marks` (set on the examination question) wins
over the question bank default.

`results` stores `score`, `max_score`, `percentage`, `accuracy`, `correct_count`, `wrong_count`,
`unattempted_count`, `time_spent_seconds`, `passed` (vs `passing_percentage`) plus JSON subject/chapter
breakdowns. Scores are computed **once at submission** — the result page never recomputes.

### Shuffling

`shuffle_questions` / `shuffle_options` use a seed derived from the attempt id, so a reload shows the same order
but two students see different orders. Option keys survive shuffling — the answer key maps to keys, not
positions.

---

## Answer-key secrecy

The session endpoint (`GET /api/exams/attempts/:attemptId`) builds its payload from a **projection** that
contains only:

```ts
{ examQuestionId, questionType, marks, negativeMarks,
  options: [{ key, text, imageUrl }] }
```

`is_correct`, `correct_options`, `numeric_answer`, `integer_answer` and explanations are not selected. The API
smoke test asserts that the serialised session contains none of those strings. Answer keys appear only in
`GET /api/results/:id`, and only when the result is visible to that student.

---

## Result release

A result becomes visible according to `result_publish_mode` **and** the row's `is_published` flag:

| Mode | Visible when |
| --- | --- |
| `immediate` | As soon as the attempt is submitted and the result row exists |
| `after_window` | After `exams.end_at` has passed |
| `manual` | Only after an admin publishes (per exam or per result set) |

`POST /api/admin/results/publish { examId | resultIds, publish }` flips visibility in bulk. Publishing never
re-scores. While a result is hidden, the student API returns `{ isPublished: false, message }` and no review.

### Ranking

`computeRanking()` runs on first read of a visible result:

- **Cohort** = published results for that exam.
- If the cohort is smaller than **5**, `rank` and `percentile` stay `null` — a rank among three people is noise.
- `rank = (number of strictly higher scores) + 1`; `percentile = (total − rank + 0.5) / total × 100`.
- Ranks require `rank_enabled = 1` on the examination.
- The computed values are persisted so later reads are cheap and stable.

---

## Per-question review

`GET /api/results/:id` returns `review` (a `ResultReviewQuestion[]`) once visible:

```ts
{ examQuestionId, questionId, questionText, questionType,
  options: [{ key, text, isCorrect }],
  selectedOptions, numericAnswer, correctOptions, numericAnswerValue, correctInteger,
  explanation, evaluation: 'correct' | 'wrong' | 'partial' | 'unattempted',
  marksAwarded, status }
```

`marksAwarded` is the **effective** award (positive, negative or zero), so the UI can sum to the score without
re-deriving partial credit.

---

## Anti-abuse rules

- One live attempt enforced by a partial unique index, not just application logic.
- `max_attempts` is checked on start; exceeding it returns `409`.
- Free vs paid and course visibility are checked before an attempt can start.
- Suspended students cannot start or save.
- Every examination write (start, save, submit, publish, force-submit, export) is audit-logged.
- Force-submit (`POST /api/admin/attempts/:id/submit`) exists for support cases, requires `results.view` and is
  recorded with the acting administrator.

---

## Admin workflow (recommended order)

1. **Question bank** → create questions with options, answer keys and explanations. Keep them `draft` until
   reviewed; `published` questions are the only ones attachable from the builder.
2. **Examinations → New** → set title, kind, duration, marking scheme and release mode.
3. Open the builder → add sections (optional) → attach questions → adjust per-question marks if needed.
4. Preview (`/tests/:id`) as a student would see it.
5. Publish. For a scheduled window, set `startAt`/`endAt` and choose `after_window` release.
6. After the window, publish results in bulk from **Results** and export the CSV if you need a report.

---

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| Duration | 1–600 minutes | `exams.duration_minutes` |
| Attempts | 1–100 | `exams.max_attempts` |
| Questions per exam | practical limit ≈ 500 per section | `exam_sections.max_questions` |
| Answers per save request | 500 | `POST …/answers` validator |
| Answers per attempt | unbounded (one row per question) | D1 |
| CSV export | 5 000 rows | `/api/admin/results/export` |
| Grace window | 45 s | `GRACE_SECONDS` |
| Result cohort for ranking | ≥ 5 published results | `computeRanking` |
