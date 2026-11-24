// =============================================================================
// Permission catalogue — SHARED by the Worker (authority) and the admin UI.
// =============================================================================
// The frontend uses this only to *hide* controls for a nicer experience.
// Every privileged route MUST call requirePermission() on the server; hiding a
// button is never an authorization mechanism.
// =============================================================================

export const PERMISSIONS = [
  // dashboard
  { key: 'dashboard.view', group: 'Dashboard', label: 'View dashboard' },

  // students
  { key: 'students.view', group: 'Students', label: 'View students' },
  { key: 'students.edit', group: 'Students', label: 'Edit students' },
  { key: 'students.suspend', group: 'Students', label: 'Suspend students', dangerous: true },
  { key: 'students.delete', group: 'Students', label: 'Delete students', dangerous: true },
  { key: 'students.export', group: 'Students', label: 'Export students', dangerous: true },

  // administrators
  { key: 'admins.view', group: 'Administration', label: 'View administrators' },
  { key: 'admins.create', group: 'Administration', label: 'Create administrators', dangerous: true },
  { key: 'admins.edit', group: 'Administration', label: 'Edit administrators', dangerous: true },
  { key: 'admins.delete', group: 'Administration', label: 'Remove administrators', dangerous: true },
  { key: 'admins.permissions', group: 'Administration', label: 'Grant individual permissions', dangerous: true },

  // content
  { key: 'courses.view', group: 'Content', label: 'View courses' },
  { key: 'courses.manage', group: 'Content', label: 'Manage courses & taxonomy' },
  { key: 'lectures.view', group: 'Content', label: 'View lectures' },
  { key: 'lectures.manage', group: 'Content', label: 'Manage lectures' },
  { key: 'lectures.publish', group: 'Content', label: 'Publish lectures' },
  { key: 'youtube.manage', group: 'Content', label: 'YouTube manager' },

  // examinations
  { key: 'exams.view', group: 'Examinations', label: 'View examinations' },
  { key: 'exams.manage', group: 'Examinations', label: 'Manage examinations' },
  { key: 'exams.publish', group: 'Examinations', label: 'Publish examinations' },
  { key: 'questions.view', group: 'Examinations', label: 'View question bank' },
  { key: 'questions.manage', group: 'Examinations', label: 'Manage questions' },
  { key: 'test_series.manage', group: 'Examinations', label: 'Manage test series' },
  { key: 'test_papers.manage', group: 'Examinations', label: 'Manage test papers' },

  // results
  { key: 'results.view', group: 'Results', label: 'View results' },
  { key: 'results.publish', group: 'Results', label: 'Publish results' },
  { key: 'results.export', group: 'Results', label: 'Export results', dangerous: true },

  // communication
  { key: 'notifications.manage', group: 'Communication', label: 'Compose notifications' },
  { key: 'notifications.send', group: 'Communication', label: 'Send notifications', dangerous: true },
  { key: 'announcements.manage', group: 'Communication', label: 'Manage announcements' },

  // sync
  { key: 'sheets.view', group: 'Data Sync', label: 'View Sheets status' },
  { key: 'sheets.sync', group: 'Data Sync', label: 'Run Sheets synchronisation', dangerous: true },
  { key: 'sheets.configure', group: 'Data Sync', label: 'Configure Sheets synchronisation', dangerous: true },

  // insights
  { key: 'analytics.view', group: 'Insights', label: 'View analytics' },
  { key: 'audit.view', group: 'Insights', label: 'View audit log' },

  // platform
  { key: 'settings.view', group: 'Platform', label: 'View settings' },
  { key: 'settings.manage', group: 'Platform', label: 'Manage settings', dangerous: true },
  { key: 'storage.manage', group: 'Platform', label: 'Manage storage', dangerous: true },
  { key: 'platform.export', group: 'Platform', label: 'Export platform reports', dangerous: true },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as string[]).includes(value);
}

export const SYSTEM_ROLES = [
  {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Unrestricted control. Only a super admin can create another administrator.',
    level: 100,
  },
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Full content, examination and student management (no administration powers).',
    level: 80,
  },
  {
    key: 'content_manager',
    name: 'Content Manager',
    description: 'Courses, chapters, lectures and announcements.',
    level: 50,
  },
  {
    key: 'exam_manager',
    name: 'Exam Manager',
    description: 'Test series, examinations, question bank and test papers.',
    level: 50,
  },
  {
    key: 'moderator',
    name: 'Moderator',
    description: 'Read access plus announcements and notifications.',
    level: 30,
  },
  { key: 'student', name: 'Student', description: 'Standard student account.', level: 0 },
] as const;

export type RoleKey = (typeof SYSTEM_ROLES)[number]['key'];

export const ROLE_LEVEL: Record<string, number> = Object.fromEntries(
  SYSTEM_ROLES.map((r) => [r.key, r.level]),
);

export function isStaffRole(key: string): boolean {
  return key !== 'student';
}
