-- =============================================================================
-- PrepSetu — reference data (safe for production)
-- =============================================================================
-- Only permissions, system roles, role→permission mappings and default platform
-- settings live here. Educational content is NEVER seeded into production: it
-- comes from Google Sheets synchronisation (or from the admin dashboard).
-- Demo content for local development lives in scripts/seed-local.sql.
-- =============================================================================

INSERT INTO permissions (key, group_name, description, is_dangerous) VALUES
  ('dashboard.view',      'Dashboard',    'View the admin dashboard overview', 0),

  ('students.view',       'Students',     'View student directory and profiles', 0),
  ('students.edit',       'Students',     'Edit student profile data', 0),
  ('students.suspend',    'Students',     'Suspend or reactivate student accounts', 1),
  ('students.delete',     'Students',     'Permanently delete a student account', 1),
  ('students.export',     'Students',     'Export student data (CSV)', 1),

  ('admins.view',         'Administration', 'View administrators and roles', 0),
  ('admins.create',       'Administration', 'Create administrators and grant roles', 1),
  ('admins.edit',         'Administration', 'Suspend administrators and change their roles', 1),
  ('admins.delete',       'Administration', 'Remove administrator access', 1),
  ('admins.permissions',  'Administration', 'Grant or revoke individual permissions', 1),

  ('courses.view',        'Content',      'View courses', 0),
  ('courses.manage',      'Content',      'Create, edit, publish and delete courses, classes, subjects and chapters', 0),
  ('lectures.view',       'Content',      'View lectures', 0),
  ('lectures.manage',     'Content',      'Create, edit, reorder and delete lectures and lecture series', 0),
  ('lectures.publish',    'Content',      'Publish or unpublish lectures', 0),
  ('youtube.manage',      'Content',      'Fetch YouTube metadata and manage playlists', 0),

  ('exams.view',          'Examinations', 'View examination configuration and results', 0),
  ('exams.manage',        'Examinations', 'Create and edit examinations, sections and scheduling', 0),
  ('exams.publish',       'Examinations', 'Publish, schedule or archive examinations', 0),
  ('questions.view',      'Examinations', 'View the question bank (including answer keys)', 0),
  ('questions.manage',    'Examinations', 'Create, edit and delete questions and answer keys', 0),
  ('test_series.manage',  'Examinations', 'Manage test series', 0),
  ('test_papers.manage',  'Examinations', 'Upload and manage PDF test papers', 0),
  ('results.view',        'Results',      'View student results and analytics', 0),
  ('results.publish',     'Results',      'Release results to students', 0),
  ('results.export',      'Results',      'Export result data', 1),

  ('notifications.manage','Communication','Compose and schedule notifications', 0),
  ('notifications.send',  'Communication','Send notifications to students', 1),
  ('announcements.manage','Communication','Create and publish announcements', 0),

  ('sheets.view',         'Data Sync',    'View Google Sheets connection status', 0),
  ('sheets.sync',         'Data Sync',    'Preview and run Google Sheets synchronisation', 1),
  ('sheets.configure',    'Data Sync',    'Change spreadsheet mappings and sync schedule', 1),

  ('analytics.view',      'Insights',     'View analytics and reports', 0),
  ('audit.view',          'Insights',     'View the administrative audit log', 0),

  ('settings.view',       'Platform',     'View platform settings', 0),
  ('settings.manage',     'Platform',     'Change platform settings', 1),
  ('storage.manage',      'Platform',     'Manage storage providers and media', 1),
  ('platform.export',     'Platform',     'Export platform-wide reports', 1)
ON CONFLICT (key) DO NOTHING;

INSERT INTO roles (id, key, name, description, level, is_system) VALUES
  ('role_super_admin',     'super_admin',     'Super Admin',          'Unrestricted platform control. Can create administrators and change any setting.', 100, 1),
  ('role_admin',           'admin',           'Administrator',        'Manages all educational content, examinations and students. Cannot manage administrators.', 80, 1),
  ('role_content_manager', 'content_manager', 'Content Manager',      'Manages courses, chapters, lectures and announcements.', 50, 1),
  ('role_exam_manager',    'exam_manager',    'Exam Manager',         'Manages test series, examinations, question bank and test papers.', 50, 1),
  ('role_moderator',       'moderator',       'Moderator',            'Reviews student-facing content and handles reports.', 30, 1),
  ('role_student',         'student',         'Student',              'Standard student account.', 0, 1)
ON CONFLICT (key) DO NOTHING;

-- Super admin: every permission.
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT 'role_super_admin', key FROM permissions;

-- Administrator: everything except administration, settings.manage, sheets.configure,
-- storage.manage and platform.export (those remain super-admin only).
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT 'role_admin', key FROM permissions
WHERE group_name NOT IN ('Administration')
  AND key NOT IN ('settings.manage','sheets.configure','storage.manage','platform.export');

-- Content manager
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT 'role_content_manager', key FROM permissions
WHERE key IN (
  'dashboard.view','courses.view','courses.manage','lectures.view','lectures.manage',
  'lectures.publish','youtube.manage','announcements.manage','sheets.view','analytics.view'
);

-- Exam manager
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT 'role_exam_manager', key FROM permissions
WHERE key IN (
  'dashboard.view','exams.view','exams.manage','exams.publish','questions.view',
  'questions.manage','test_series.manage','test_papers.manage','results.view',
  'results.publish','analytics.view','courses.view'
);

-- Moderator
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT 'role_moderator', key FROM permissions
WHERE key IN (
  'dashboard.view','students.view','announcements.manage','notifications.manage',
  'analytics.view','courses.view','lectures.view','exams.view'
);

-- Students have no administrative permissions.
DELETE FROM role_permissions WHERE role_id = 'role_student';

-- -----------------------------------------------------------------------------
-- Default platform settings
-- -----------------------------------------------------------------------------
INSERT INTO platform_settings (key, value, value_type, category, label, description, is_public) VALUES
  ('site.name',                    'PrepSetu', 'string',  'general',  'Site name', 'Shown in the PWA title and headers', 1),
  ('site.tagline',                 'Your bridge to success', 'string', 'general', 'Tagline', 'Student app subtitle', 1),
  ('site.support_email',           'support@prepsetu.in', 'string', 'general', 'Support email', 'Shown in the help section', 1),
  ('site.maintenance_mode',        'false',    'boolean', 'general',  'Maintenance mode', 'Show a maintenance screen to students', 1),
  ('features.registration_open',   'true',     'boolean', 'general',  'Registration open', 'Allow new student sign-ups', 1),
  ('features.google_signin',       'true',     'boolean', 'general',  'Google sign-in', 'Show the Google sign-in button', 1),
  ('features.push_notifications',  'true',     'boolean', 'general',  'Push notifications', 'Allow students to enable push notifications', 1),
  ('features.test_paper_downloads','true',     'boolean', 'general',  'Test paper downloads', 'Allow students to download PDF test papers', 1),
  ('exam.default_negative_marks',  '1',        'number',  'exams',    'Default negative marks', 'Applied to new questions', 1),
  ('exam.default_marks',           '4',        'number',  'exams',    'Default question marks', 'Applied to new questions', 1),
  ('exam.autosave_interval_seconds','10',      'number',  'exams',    'Autosave interval', 'Seconds between automatic answer saves', 1),
  ('exam.grace_seconds',           '45',       'number',  'exams',    'Server grace window', 'Seconds of network grace allowed past the server deadline', 0),
  ('results.publish_mode_default', 'immediate','string',  'exams',    'Default result publishing', 'immediate | after_window | manual', 0),
  ('sheets.spreadsheet_id',        '1tNqp66KgAnnhCRceOPkZubl1C-pMK_olzJkBlKGEnE4', 'string', 'sync', 'Spreadsheet ID', 'Google Sheets content source', 0),
  ('sheets.sync_enabled',          'true',     'boolean', 'sync',     'Scheduled sync', 'Run incremental synchronisation every 15 minutes', 0),
  ('sheets.sync_interval_minutes', '15',       'number',  'sync',     'Sync interval', 'Minutes between automatic synchronisations', 0),
  ('youtube.metadata_enabled',     'true',     'boolean', 'content',  'YouTube metadata', 'Fetch title/thumbnail from YouTube on save', 0),
  ('storage.test_paper_provider',  'firebase', 'string',  'storage',  'Test paper storage', 'firebase | r2 | external', 0),
  ('storage.max_pdf_mb',           '25',       'number',  'storage',  'Max PDF size (MB)', 'Upload limit for test papers', 0),
  ('cache.catalogue_ttl_seconds',  '60',       'number',  'performance', 'Catalogue cache TTL', 'Edge cache lifetime for public catalogue responses', 0)
ON CONFLICT (key) DO NOTHING;
