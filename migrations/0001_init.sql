-- =============================================================================
-- PrepSetu — initial schema
-- =============================================================================
-- Conventions
--   * IDs: TEXT UUIDv4 generated server-side (never spreadsheet row numbers).
--   * Business timestamps: TEXT ISO-8601 UTC ("2026-01-31T10:00:00.000Z").
--   * Security-critical deadlines: INTEGER epoch milliseconds (no timezone
--     ambiguity; the server, never the browser, decides expiry).
--   * Booleans: INTEGER 0/1 with CHECK constraints.
--   * Every content table carries `external_id` so a Google Sheets row / import
--     can be re-matched without relying on row position, plus `updated_at`
--     maintained by triggers.
--   * Answer keys are stored ONLY in `answer_keys`; they are never selected by
--     any student-facing query.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. IDENTITY, ROLES AND PERMISSIONS
-- -----------------------------------------------------------------------------

CREATE TABLE users (
  id                TEXT PRIMARY KEY,                         -- Firebase UID
  email             TEXT NOT NULL,
  email_verified    INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0,1)),
  display_name      TEXT,
  photo_url         TEXT,
  phone             TEXT,
  auth_provider     TEXT NOT NULL DEFAULT 'password',
  status            TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','suspended','deleted')),
  last_login_at     TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));
CREATE INDEX ix_users_status_created ON users (status, created_at DESC);
CREATE INDEX ix_users_created ON users (created_at DESC);

CREATE TABLE user_profiles (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name              TEXT,
  class_id               TEXT,           -- FK added after classes table exists
  target_exam_type_id    TEXT,
  city                   TEXT,
  state                  TEXT,
  school                 TEXT,
  bio                    TEXT,
  language               TEXT NOT NULL DEFAULT 'en',
  avatar_url             TEXT,
  onboarding_completed   INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0,1)),
  notification_prefs     TEXT NOT NULL DEFAULT '{"push":true,"email":true,"examReminders":true,"newContent":true}',
  study_goal_minutes     INTEGER NOT NULL DEFAULT 60,
  streak_days            INTEGER NOT NULL DEFAULT 0,
  last_active_at         TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_profiles_class ON user_profiles (class_id);

CREATE TABLE roles (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  level         INTEGER NOT NULL DEFAULT 0,   -- higher = more authority
  is_system     INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE permissions (
  key          TEXT PRIMARY KEY,
  group_name   TEXT NOT NULL,
  description  TEXT NOT NULL,
  is_dangerous INTEGER NOT NULL DEFAULT 0 CHECK (is_dangerous IN (0,1))
);

CREATE TABLE role_permissions (
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key  TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_roles (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  granted_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at  TEXT,
  expires_at  TEXT,
  UNIQUE (user_id, role_id)
);
CREATE INDEX ix_user_roles_user ON user_roles (user_id, is_active);
CREATE INDEX ix_user_roles_role ON user_roles (role_id, is_active);

-- Extra, explicitly granted permissions on top of the role (super admin only).
CREATE TABLE user_permission_overrides (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  granted        INTEGER NOT NULL DEFAULT 1 CHECK (granted IN (0,1)),
  granted_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, permission_key)
);

-- -----------------------------------------------------------------------------
-- 2. CONTENT TAXONOMY  (Course -> Class / Exam type -> Subject -> Chapter)
-- -----------------------------------------------------------------------------

CREATE TABLE classes (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  level           INTEGER NOT NULL DEFAULT 0,     -- 11, 12, 0 for exam-only
  description     TEXT,
  icon            TEXT,
  color           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  external_id     TEXT,
  sheet_row       INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_classes_external ON classes (external_id) WHERE external_id IS NOT NULL;

-- Examination *types* (JEE Main, JEE Advanced, NEET, Board, CUET, custom…).
-- Super admin can add unlimited types without any code change.
CREATE TABLE exam_types (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  short_name      TEXT,
  description     TEXT,
  icon            TEXT,
  color           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  external_id     TEXT,
  sheet_row       INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_exam_types_external ON exam_types (external_id) WHERE external_id IS NOT NULL;

CREATE TABLE courses (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  short_description TEXT,
  cover_image_url TEXT,
  thumbnail_url   TEXT,
  class_id        TEXT REFERENCES classes(id) ON DELETE SET NULL,
  exam_type_id    TEXT REFERENCES exam_types(id) ON DELETE SET NULL,
  tags            TEXT,                            -- comma separated
  difficulty      TEXT NOT NULL DEFAULT 'all' CHECK (difficulty IN ('beginner','intermediate','advanced','all')),
  price_inr       INTEGER NOT NULL DEFAULT 0,
  is_free         INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0,1)),
  is_featured     INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  visibility      TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','restricted')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  external_id     TEXT,
  sheet_row       INTEGER,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_courses_external ON courses (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_courses_status ON courses (status, sort_order);
CREATE INDEX ix_courses_class ON courses (class_id, status);
CREATE INDEX ix_courses_exam_type ON courses (exam_type_id, status);

CREATE TABLE subjects (
  id              TEXT PRIMARY KEY,
  course_id       TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  icon            TEXT,
  color           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  external_id     TEXT,
  sheet_row       INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (course_id, slug)
);
CREATE UNIQUE INDEX ux_subjects_external ON subjects (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_subjects_course ON subjects (course_id, sort_order);

CREATE TABLE chapters (
  id              TEXT PRIMARY KEY,
  subject_id      TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  course_id       TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  weightage       INTEGER,
  estimated_minutes INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  external_id     TEXT,
  sheet_row       INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (subject_id, slug)
);
CREATE UNIQUE INDEX ux_chapters_external ON chapters (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_chapters_subject ON chapters (subject_id, sort_order);
CREATE INDEX ix_chapters_course ON chapters (course_id);

-- -----------------------------------------------------------------------------
-- 3. LECTURES / YOUTUBE
-- -----------------------------------------------------------------------------

CREATE TABLE lecture_series (
  id              TEXT PRIMARY KEY,
  course_id       TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id      TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  subject_id      TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  slug            TEXT,
  description     TEXT,
  thumbnail_url   TEXT,
  youtube_playlist_id TEXT,
  lecture_count   INTEGER NOT NULL DEFAULT 0,
  total_minutes   INTEGER NOT NULL DEFAULT 0,
  is_free         INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0,1)),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  external_id     TEXT,
  sheet_row       INTEGER,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_series_external ON lecture_series (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_series_course ON lecture_series (course_id, status, sort_order);
CREATE INDEX ix_series_chapter ON lecture_series (chapter_id, sort_order);

CREATE TABLE lectures (
  id                TEXT PRIMARY KEY,
  course_id         TEXT REFERENCES courses(id) ON DELETE SET NULL,
  subject_id        TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  chapter_id        TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  series_id         TEXT REFERENCES lecture_series(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  youtube_video_id  TEXT NOT NULL,
  youtube_url       TEXT,
  thumbnail_url     TEXT,
  channel_name      TEXT,
  duration_seconds  INTEGER,
  published_at      TEXT,
  lecture_number    INTEGER,
  language          TEXT NOT NULL DEFAULT 'en',
  tags              TEXT,
  is_free           INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0,1)),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  visibility        TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','restricted')),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  view_count        INTEGER NOT NULL DEFAULT 0,
  external_id       TEXT,
  sheet_row         INTEGER,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (youtube_video_id, series_id)
);
CREATE UNIQUE INDEX ux_lectures_external ON lectures (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_lectures_series ON lectures (series_id, sort_order);
CREATE INDEX ix_lectures_course ON lectures (course_id, status, sort_order);
CREATE INDEX ix_lectures_chapter ON lectures (chapter_id, status);
CREATE INDEX ix_lectures_video ON lectures (youtube_video_id);
CREATE INDEX ix_lectures_status_created ON lectures (status, created_at DESC);

-- A lecture may be attached to additional courses.
CREATE TABLE lecture_courses (
  lecture_id  TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (lecture_id, course_id)
);
CREATE INDEX ix_lecture_courses_course ON lecture_courses (course_id);

CREATE TABLE youtube_playlists (
  id                    TEXT PRIMARY KEY,
  youtube_playlist_id   TEXT NOT NULL UNIQUE,
  title                 TEXT NOT NULL,
  description           TEXT,
  thumbnail_url         TEXT,
  channel_name          TEXT,
  item_count            INTEGER NOT NULL DEFAULT 0,
  course_id             TEXT REFERENCES courses(id) ON DELETE SET NULL,
  series_id             TEXT REFERENCES lecture_series(id) ON DELETE SET NULL,
  is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_synced_at        TEXT,
  created_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE youtube_playlist_items (
  id                TEXT PRIMARY KEY,
  playlist_id       TEXT NOT NULL REFERENCES youtube_playlists(id) ON DELETE CASCADE,
  youtube_video_id  TEXT NOT NULL,
  title             TEXT,
  thumbnail_url     TEXT,
  position          INTEGER NOT NULL DEFAULT 0,
  duration_seconds  INTEGER,
  lecture_id        TEXT REFERENCES lectures(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (playlist_id, youtube_video_id)
);
CREATE INDEX ix_playlist_items_playlist ON youtube_playlist_items (playlist_id, position);

CREATE TABLE lecture_progress (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lecture_id        TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  watched_seconds   INTEGER NOT NULL DEFAULT 0,
  duration_seconds  INTEGER,
  percent           REAL NOT NULL DEFAULT 0,
  last_position     INTEGER NOT NULL DEFAULT 0,
  completed         INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, lecture_id)
);
CREATE INDEX ix_progress_user ON lecture_progress (user_id, updated_at DESC);
CREATE INDEX ix_progress_lecture ON lecture_progress (lecture_id, completed);

CREATE TABLE bookmarks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type   TEXT NOT NULL CHECK (item_type IN ('lecture','course','exam','test_paper','series')),
  item_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, item_type, item_id)
);
CREATE INDEX ix_bookmarks_user ON bookmarks (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. EXAMINATION ENGINE
-- -----------------------------------------------------------------------------

CREATE TABLE test_series (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  course_id       TEXT REFERENCES courses(id) ON DELETE SET NULL,
  exam_type_id    TEXT REFERENCES exam_types(id) ON DELETE SET NULL,
  thumbnail_url   TEXT,
  is_free         INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0,1)),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  external_id     TEXT,
  sheet_row       INTEGER,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_test_series_external ON test_series (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_test_series_status ON test_series (status, sort_order);

CREATE TABLE exams (
  id                    TEXT PRIMARY KEY,
  test_series_id        TEXT REFERENCES test_series(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  slug                  TEXT,
  description           TEXT,
  instructions          TEXT,
  exam_kind             TEXT NOT NULL DEFAULT 'practice'
                        CHECK (exam_kind IN ('practice','chapter','topic','full_mock','previous_year','board','custom')),
  course_id             TEXT REFERENCES courses(id) ON DELETE SET NULL,
  exam_type_id          TEXT REFERENCES exam_types(id) ON DELETE SET NULL,
  subject_id            TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  chapter_id            TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  duration_minutes      INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 1 AND 600),
  total_marks           REAL NOT NULL DEFAULT 0,
  total_questions       INTEGER NOT NULL DEFAULT 0,
  marks_per_question    REAL NOT NULL DEFAULT 4,
  negative_marks        REAL NOT NULL DEFAULT 1,
  negative_marking_enabled INTEGER NOT NULL DEFAULT 1 CHECK (negative_marking_enabled IN (0,1)),
  shuffle_questions     INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_questions IN (0,1)),
  shuffle_options       INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_options IN (0,1)),
  allow_section_navigation INTEGER NOT NULL DEFAULT 1 CHECK (allow_section_navigation IN (0,1)),
  start_at              TEXT,
  end_at                TEXT,
  max_attempts          INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 100),
  result_publish_mode   TEXT NOT NULL DEFAULT 'immediate'
                        CHECK (result_publish_mode IN ('immediate','after_window','manual')),
  passing_percentage    REAL NOT NULL DEFAULT 0,
  rank_enabled          INTEGER NOT NULL DEFAULT 1 CHECK (rank_enabled IN (0,1)),
  is_free               INTEGER NOT NULL DEFAULT 1 CHECK (is_free IN (0,1)),
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','scheduled','archived')),
  external_id           TEXT,
  sheet_row             INTEGER,
  created_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_exams_external ON exams (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_exams_status ON exams (status, start_at);
CREATE INDEX ix_exams_course ON exams (course_id, status);
CREATE INDEX ix_exams_series ON exams (test_series_id, status);
CREATE INDEX ix_exams_kind ON exams (exam_kind, status);

CREATE TABLE exam_sections (
  id              TEXT PRIMARY KEY,
  exam_id         TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  subject_id      TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  chapter_id      TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  instructions    TEXT,
  is_optional     INTEGER NOT NULL DEFAULT 0 CHECK (is_optional IN (0,1)),
  max_questions   INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  external_id     TEXT,
  sheet_row       INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_sections_external ON exam_sections (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_sections_exam ON exam_sections (exam_id, sort_order);

CREATE TABLE questions (
  id                  TEXT PRIMARY KEY,
  subject_id          TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  chapter_id          TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  exam_type_id        TEXT REFERENCES exam_types(id) ON DELETE SET NULL,
  course_id           TEXT REFERENCES courses(id) ON DELETE SET NULL,
  question_type       TEXT NOT NULL DEFAULT 'single_correct'
                      CHECK (question_type IN ('single_correct','multiple_correct','numerical','integer','passage','image_based')),
  difficulty          TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  question_text       TEXT NOT NULL,
  question_image_url  TEXT,
  passage_text        TEXT,
  passage_image_url   TEXT,
  marks               REAL NOT NULL DEFAULT 4,
  negative_marks      REAL NOT NULL DEFAULT 1,
  source              TEXT,
  year                INTEGER,
  tags                TEXT,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  external_id         TEXT,
  sheet_row           INTEGER,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_questions_external ON questions (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_questions_subject ON questions (subject_id, status);
CREATE INDEX ix_questions_chapter ON questions (chapter_id, status);
CREATE INDEX ix_questions_status ON questions (status, created_at DESC);
CREATE INDEX ix_questions_type ON questions (question_type, difficulty);

CREATE TABLE question_options (
  id              TEXT PRIMARY KEY,
  question_id     TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_key      TEXT NOT NULL,
  option_text     TEXT,
  option_image_url TEXT,
  is_correct      INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0,1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (question_id, option_key)
);
CREATE INDEX ix_options_question ON question_options (question_id, sort_order);

-- Canonical answer storage. SERVER-ONLY: no student route may select this table
-- before the attempt is submitted and results are released.
CREATE TABLE answer_keys (
  id                TEXT PRIMARY KEY,
  question_id       TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  answer_type       TEXT NOT NULL DEFAULT 'single' CHECK (answer_type IN ('single','multiple','numeric','integer')),
  correct_options   TEXT,          -- JSON array of option keys, e.g. ["A","C"]
  numeric_answer    REAL,
  numeric_tolerance REAL NOT NULL DEFAULT 0,
  integer_answer    INTEGER,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE explanations (
  id                TEXT PRIMARY KEY,
  question_id       TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  explanation_text  TEXT,
  video_url         TEXT,
  image_url         TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE exam_questions (
  id              TEXT PRIMARY KEY,
  exam_id         TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  section_id      TEXT REFERENCES exam_sections(id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  marks           REAL NOT NULL DEFAULT 4,
  negative_marks  REAL NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (exam_id, question_id)
);
CREATE INDEX ix_exam_questions_exam ON exam_questions (exam_id, sort_order);
CREATE INDEX ix_exam_questions_section ON exam_questions (section_id, sort_order);

CREATE TABLE exam_attempts (
  id                  TEXT PRIMARY KEY,
  exam_id             TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_number      INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'in_progress'
                      CHECK (status IN ('in_progress','submitted','auto_submitted','expired','evaluated','abandoned')),
  started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at_ms       INTEGER NOT NULL,
  expires_at_ms       INTEGER NOT NULL,     -- server-authoritative deadline
  submitted_at        TEXT,
  submitted_at_ms     INTEGER,
  duration_seconds    INTEGER,
  time_spent_seconds  INTEGER NOT NULL DEFAULT 0,
  total_questions     INTEGER NOT NULL DEFAULT 0,
  answered_count      INTEGER NOT NULL DEFAULT 0,
  question_order      TEXT,                 -- JSON array of exam_questions.id
  option_order        TEXT,                 -- JSON object { questionId: ["B","A","D","C"] }
  score               REAL,
  correct_count       INTEGER,
  wrong_count         INTEGER,
  unattempted_count   INTEGER,
  accuracy            REAL,
  percentage          REAL,
  ip_hash             TEXT,
  user_agent          TEXT,
  submit_channel      TEXT,                 -- manual | timer | admin | cron
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (exam_id, user_id, attempt_number)
);
CREATE INDEX ix_attempts_user ON exam_attempts (user_id, created_at DESC);
CREATE INDEX ix_attempts_exam ON exam_attempts (exam_id, status);
-- At most one live attempt per student per exam, enforced by the database.
CREATE UNIQUE INDEX ux_attempts_in_progress ON exam_attempts (exam_id, user_id) WHERE status = 'in_progress';
CREATE INDEX ix_attempts_expiry ON exam_attempts (status, expires_at_ms);

CREATE TABLE attempt_answers (
  id                TEXT PRIMARY KEY,
  attempt_id        TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  exam_question_id  TEXT NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  question_id       TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_options  TEXT,          -- JSON array of option keys (shuffled presentation keys resolved to canonical keys)
  numeric_answer    REAL,
  integer_answer    INTEGER,
  status            TEXT NOT NULL DEFAULT 'not_answered'
                    CHECK (status IN ('not_answered','answered','marked_for_review','answered_marked')),
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  is_correct        INTEGER,
  marks_awarded     REAL,
  evaluation        TEXT,          -- correct | wrong | partial | unattempted
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX ix_attempt_answers_attempt ON attempt_answers (attempt_id);

CREATE TABLE results (
  id                  TEXT PRIMARY KEY,
  attempt_id          TEXT NOT NULL UNIQUE REFERENCES exam_attempts(id) ON DELETE CASCADE,
  exam_id             TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score               REAL NOT NULL DEFAULT 0,
  max_score           REAL NOT NULL DEFAULT 0,
  percentage          REAL NOT NULL DEFAULT 0,
  accuracy            REAL NOT NULL DEFAULT 0,
  correct_count       INTEGER NOT NULL DEFAULT 0,
  wrong_count         INTEGER NOT NULL DEFAULT 0,
  unattempted_count   INTEGER NOT NULL DEFAULT 0,
  time_spent_seconds  INTEGER NOT NULL DEFAULT 0,
  subject_breakdown   TEXT,       -- JSON
  chapter_breakdown   TEXT,       -- JSON
  rank                INTEGER,
  percentile          REAL,
  passed              INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0,1)),
  is_published        INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1)),
  published_at        TEXT,
  computed_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (attempt_id)
);
CREATE INDEX ix_results_user ON results (user_id, computed_at DESC);
CREATE INDEX ix_results_exam ON results (exam_id, score DESC);
CREATE INDEX ix_results_published ON results (exam_id, is_published);

-- -----------------------------------------------------------------------------
-- 5. TEST PAPERS (PDF library)
-- -----------------------------------------------------------------------------

CREATE TABLE test_papers (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT,
  class_id          TEXT REFERENCES classes(id) ON DELETE SET NULL,
  exam_type_id      TEXT REFERENCES exam_types(id) ON DELETE SET NULL,
  course_id         TEXT REFERENCES courses(id) ON DELETE SET NULL,
  subject_id        TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  year              INTEGER,
  category          TEXT,
  cover_image_url   TEXT,
  file_url          TEXT NOT NULL,
  file_key          TEXT,
  storage_provider  TEXT NOT NULL DEFAULT 'firebase' CHECK (storage_provider IN ('firebase','r2','external')),
  file_size_bytes   INTEGER,
  mime_type         TEXT,
  page_count        INTEGER,
  answer_key_url    TEXT,
  solution_url      TEXT,
  visibility        TEXT NOT NULL DEFAULT 'authenticated' CHECK (visibility IN ('public','authenticated','restricted')),
  is_free           INTEGER NOT NULL DEFAULT 1 CHECK (is_free IN (0,1)),
  download_count    INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  external_id       TEXT,
  sheet_row         INTEGER,
  uploaded_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_test_papers_external ON test_papers (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_test_papers_status ON test_papers (status, year DESC);
CREATE INDEX ix_test_papers_filters ON test_papers (exam_type_id, subject_id, year);

-- -----------------------------------------------------------------------------
-- 6. ANNOUNCEMENTS, NOTIFICATIONS, DEVICE TOKENS
-- -----------------------------------------------------------------------------

CREATE TABLE announcements (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  image_url       TEXT,
  link_url        TEXT,
  target_audience TEXT NOT NULL DEFAULT 'all'
                  CHECK (target_audience IN ('all','class','exam_type','course','selected')),
  class_id        TEXT REFERENCES classes(id) ON DELETE SET NULL,
  exam_type_id    TEXT REFERENCES exam_types(id) ON DELETE SET NULL,
  course_id       TEXT REFERENCES courses(id) ON DELETE SET NULL,
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  is_pinned       INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  publish_at      TEXT,
  expires_at      TEXT,
  external_id     TEXT,
  sheet_row       INTEGER,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_announcements_external ON announcements (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX ix_announcements_feed ON announcements (status, is_pinned DESC, publish_at DESC);

CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  image_url       TEXT,
  deep_link       TEXT,
  target_type     TEXT NOT NULL DEFAULT 'all'
                  CHECK (target_type IN ('all','class','exam_type','course','user','users')),
  target_value    TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at    TEXT,
  sent_at         TEXT,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  payload         TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_notifications_status ON notifications (status, scheduled_at);
CREATE INDEX ix_notifications_created ON notifications (created_at DESC);

CREATE TABLE notification_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  platform      TEXT NOT NULL DEFAULT 'web' CHECK (platform IN ('web','android','ios')),
  device_info   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_tokens_user ON notification_tokens (user_id, is_active);

CREATE TABLE notification_log (
  id               TEXT PRIMARY KEY,
  notification_id  TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id          TEXT,
  token_id         TEXT,
  status           TEXT NOT NULL CHECK (status IN ('success','failure')),
  error            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_notification_log_n ON notification_log (notification_id, status);

-- -----------------------------------------------------------------------------
-- 7. OPS: AUDIT, SYNC, SETTINGS, RATE LIMITS
-- -----------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id            TEXT PRIMARY KEY,
  actor_id      TEXT,
  actor_email   TEXT,
  action        TEXT NOT NULL,              -- e.g. lecture.create
  entity_type   TEXT,
  entity_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','failure','denied')),
  before_json   TEXT,
  after_json    TEXT,
  meta_json     TEXT,
  ip_hash       TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_audit_created ON audit_logs (created_at DESC);
CREATE INDEX ix_audit_actor ON audit_logs (actor_id, created_at DESC);
CREATE INDEX ix_audit_action ON audit_logs (action, created_at DESC);
CREATE INDEX ix_audit_entity ON audit_logs (entity_type, entity_id);

CREATE TABLE sync_logs (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'google_sheets',
  mode            TEXT NOT NULL CHECK (mode IN ('preview','full','incremental','scheduled')),
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed')),
  started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at     TEXT,
  duration_ms     INTEGER,
  triggered_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  stats_json      TEXT,       -- {"lectures":{"inserted":4,"updated":2,...}}
  errors_json     TEXT,       -- [{"sheet":"Lectures","row":12,"message":"..."}]
  sheets_json     TEXT,       -- worksheet inventory found in the spreadsheet
  error_message   TEXT
);
CREATE INDEX ix_sync_started ON sync_logs (started_at DESC);

CREATE TABLE sync_locks (
  key         TEXT PRIMARY KEY,
  locked_at   TEXT NOT NULL,
  locked_by   TEXT,
  expires_at  TEXT NOT NULL
);

CREATE TABLE platform_settings (
  key          TEXT PRIMARY KEY,
  value        TEXT,
  value_type   TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string','number','boolean','json')),
  category     TEXT NOT NULL DEFAULT 'general',
  label        TEXT,
  description  TEXT,
  is_public    INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,   -- hashed bucket key (never raw IP)
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX ix_rate_limits_expiry ON rate_limits (expires_at);

CREATE TABLE api_cache (
  key         TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_api_cache_expiry ON api_cache (expires_at);

-- -----------------------------------------------------------------------------
-- 8. updated_at TRIGGERS
-- -----------------------------------------------------------------------------

CREATE TRIGGER trg_users_updated AFTER UPDATE ON users FOR EACH ROW
BEGIN UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_profiles_updated AFTER UPDATE ON user_profiles FOR EACH ROW
BEGIN UPDATE user_profiles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = NEW.user_id; END;
CREATE TRIGGER trg_classes_updated AFTER UPDATE ON classes FOR EACH ROW
BEGIN UPDATE classes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_exam_types_updated AFTER UPDATE ON exam_types FOR EACH ROW
BEGIN UPDATE exam_types SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_courses_updated AFTER UPDATE ON courses FOR EACH ROW
BEGIN UPDATE courses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_subjects_updated AFTER UPDATE ON subjects FOR EACH ROW
BEGIN UPDATE subjects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_chapters_updated AFTER UPDATE ON chapters FOR EACH ROW
BEGIN UPDATE chapters SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_series_updated AFTER UPDATE ON lecture_series FOR EACH ROW
BEGIN UPDATE lecture_series SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_lectures_updated AFTER UPDATE ON lectures FOR EACH ROW
BEGIN UPDATE lectures SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_test_series_updated AFTER UPDATE ON test_series FOR EACH ROW
BEGIN UPDATE test_series SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_exams_updated AFTER UPDATE ON exams FOR EACH ROW
BEGIN UPDATE exams SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_sections_updated AFTER UPDATE ON exam_sections FOR EACH ROW
BEGIN UPDATE exam_sections SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_questions_updated AFTER UPDATE ON questions FOR EACH ROW
BEGIN UPDATE questions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_test_papers_updated AFTER UPDATE ON test_papers FOR EACH ROW
BEGIN UPDATE test_papers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_announcements_updated AFTER UPDATE ON announcements FOR EACH ROW
BEGIN UPDATE announcements SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_notifications_updated AFTER UPDATE ON notifications FOR EACH ROW
BEGIN UPDATE notifications SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_attempts_updated AFTER UPDATE ON exam_attempts FOR EACH ROW
BEGIN UPDATE exam_attempts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
