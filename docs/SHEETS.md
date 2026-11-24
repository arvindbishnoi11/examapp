# Google Sheets content sync

The spreadsheet is an **authoring surface**, not the production database. D1 is always the source of truth for
delivery; a sync copies (upserts) validated rows from the sheet into D1. **Nothing is ever written back to the
spreadsheet**, and a sync never deletes rows.

This is optional: every one of these entities can be maintained through the admin console instead.

---

## 1. One-time setup

1. **Create a service account** in Google Cloud for the project that owns the spreadsheet.
2. Enable the **Google Sheets API** for that project.
3. Copy the service-account JSON to a single-line string and store it as a Worker secret:

   ```bash
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
   # paste: {"type":"service_account","project_id":"…","private_key":"-----BEGIN PRIVATE KEY-----\n…",
   #        "client_email":"…@….iam.gserviceaccount.com", …}
   ```

4. **Share the spreadsheet** with `client_email` as an **Editor**. Read access is technically enough, but
   Editor avoids confusion when the owner later enables write features.
5. Set the spreadsheet id:

   ```bash
   npx wrangler secret put GOOGLE_SHEETS_SPREADSHEET_ID   # or use the GOOGLE_SHEETS_SPREADSHEET_ID var
   ```

6. Open **Admin → Sheets sync**. The status panel should show the spreadsheet title, its worksheets and which
   entity each one maps to. If it says “not configured”, the secret is missing or malformed.

Locally, the same checks work from `.dev.vars`, though the sandbox may not reach Google at all — in that case
the UI must show the documented “not configured” state rather than an error.

---

## 2. Worksheet contract

A worksheet is matched by **name** (case/space/punctuation-insensitive, with aliases) and mapped by **header
row** (row 1). Renaming a column to a known alias is fine; deleting a *required* column makes that sheet
report a failure without touching existing data.

| Worksheet (aliases) | Entity | Required columns |
| --- | --- | --- |
| `Classes` (`class`) | classes | `name` |
| `ExamTypes` (`exams`, `types`) | exam_types | `name` |
| `Courses` | courses | `name` |
| `Subjects` | subjects | `name`, `course` |
| `Chapters` | chapters | `name`, `subject` |
| `LectureSeries` (`series`) | lecture_series | `title`, `course` |
| `Lectures` | lectures | `title`, `youtube_url` or `youtube_video_id`, `course` |
| `TestSeries` | test_series | `name` |
| `Exams` | exams | `title` |
| `ExamSections` | exam_sections | `exam`, `title` |
| `Questions` | questions | `question` |
| `QuestionOptions` (`Options`) | question_options | `question`, `key` |
| `AnswerKeys` (`Keys`) | answer_keys | `question` |
| `Explanations` (`Solutions`) | explanations | `question` |
| `Announcements` (`Notices`) | announcements | `title`, `body` |
| `TestPapers` (`Papers`) | test_papers | `title`, `file_url` |
| `Settings` | settings | `key`, `value` |

Any other worksheet is ignored. A missing worksheet is simply skipped.

### References

Child rows point at their parent by **name or id** — `course`, `subject`, `chapter`, `exam`, `question`. The
importer resolves both, so a spreadsheet can be authored entirely with human-readable names.

### Questions in one row

The `Questions` worksheet supports the fast path: `option_a` … `option_e`, plus `correct_answer`
(`B`, `A,C` for multi-select, or a number for numerical/integer questions). Use the separate
`QuestionOptions` / `AnswerKeys` worksheets only when you need images, more than five options, or explicit
per-option metadata.

### Header aliasing

For each field there is an alias list, e.g. `question_text` accepts `question | questiontext | text | body`.
`duration_mins` and `Duration` both map to `duration_minutes`. **Unknown columns are ignored and reported**,
never guessed at.

---

## 3. Sync semantics

| | Preview (`POST /api/admin/sheets/preview-sync`) | Sync (`POST /api/admin/sheets/sync`) |
| --- | --- | --- |
| Reads the spreadsheet | Yes | Yes |
| Writes to D1 | **No** | Yes (upsert) |
| Takes the lock | No | Yes |
| Creates a `sync_logs` row | Yes, marked preview | Yes |
| Cache effect | None | Purges the catalogue cache |

**Modes**

- `incremental` (default, and what the cron uses) — only rows whose content hash changed are written.
- `full` — every row in every mapped sheet is re-validated and upserted.
- `force: true` — ignore an in-flight lock (use only after a crashed run; the lease expires in 15 minutes anyway).

**Guarantees**

- Idempotent: running twice changes nothing the second time.
- Deleting a spreadsheet row does **not** delete content. Archive in the admin console.
- Every run records inserted / updated / skipped / failed counts per sheet, plus the first errors, in
  `sync_logs` (visible in Admin → Sheets sync → Sync history).
- A single bad row fails only that row; the rest of the sheet continues.
- Overlapping runs are prevented by a lease in `sync_locks`; a second caller gets `409 sync_in_progress`.

**Scheduling** — `wrangler.jsonc` registers a cron of `*/15 * * * *`. The scheduled handler: syncs when
`sheets.sync_enabled` is true and credentials exist, dispatches due notifications, and expires stale attempts.
Locally you can trigger it manually:

```bash
curl "http://127.0.0.1:8799/cdn-cgi/local/scheduled"
```

---

## 4. Row identity

| Column | Meaning |
| --- | --- |
| `external_id` | Stable business key owned by you (e.g. `PHY-LEC-014`). Recommended for every row. |
| `id` | An existing PrepSetu UUID — only needed when updating a row created in the admin console. |

A row with neither is treated as new and matched on the natural key (slug for taxonomy, name + parent for
children, YouTube video id for lectures). When a row has an `external_id`, changing its *name* updates the
existing record instead of creating a duplicate.

---

## 5. Column reference (most-used sheets)

### Courses
`external_id`, `name`*, `slug`, `short_description`, `description`, `cover_image_url`, `class`, `exam_type`,
`tags`, `difficulty`, `price_inr`, `is_free`, `is_featured`, `status`, `visibility`, `sort_order`

### Lectures
`external_id`, `title`*, `youtube_url` / `youtube_video_id`, `description`, `course`, `subject`, `chapter`,
`series`, `lecture_number`, `duration_seconds`, `language`, `is_free`, `status`, `visibility`, `sort_order`,
`published_at`, `tags`

### Exams
`external_id`, `title`*, `description`, `instructions`, `exam_kind`, `course`, `exam_type`, `subject`,
`chapter`, `test_series`, `duration_minutes`, `marks_per_question`, `negative_marks`,
`negative_marking_enabled`, `shuffle_questions`, `shuffle_options`, `allow_section_navigation`, `start_at`,
`end_at`, `max_attempts`, `result_publish_mode`, `passing_percentage`, `rank_enabled`, `is_free`, `status`

### Questions
`external_id`, `question`*, `question_type`, `difficulty`, `option_a`…`option_e`, `correct_answer`,
`numerical_answer`, `explanation`, `subject`, `chapter`, `exam_type`, `course`, `question_image_url`,
`passage_text`, `marks`, `negative_marks`, `source`, `year`, `tags`, `status`

Value coercion is lenient: `TRUE/FALSE/yes/no/1/0` are booleans; ISO dates and `YYYY-MM-DD` are timestamps;
blank cells become `NULL` (never `""`).

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `configured: false` | secret missing/invalid | Re-put `GOOGLE_SERVICE_ACCOUNT_JSON`; verify it parses |
| Status works, preview says “0 worksheets” | spreadsheet not shared with the service account | Share it with `client_email` as Editor |
| A sheet reports `detected: false` | worksheet name/headers not recognised | Rename the tab to a known alias (Admin → Sheets sync lists them) |
| “This worksheet is missing a required column” | header renamed beyond the alias list | Add the expected header (the message names it) |
| `409 sync_in_progress` | a run is active | Wait; or retry with `force` after 15 minutes |
| Content updated but the site shows stale data | catalogue cache | Admin → Sheets sync → **Purge catalogue cache** |
| Rows keep “failing” with the same key | duplicate `external_id` in the sheet | Make each business key unique |

Run `npm run test:api` after changing sheet handling: it asserts the unconfigured path returns a clean
`failed` report with an explanatory message, never a 500.
