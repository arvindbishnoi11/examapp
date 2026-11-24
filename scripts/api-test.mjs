#!/usr/bin/env node
// =============================================================================
// PrepSetu — API smoke test
// -----------------------------------------------------------------------------
// Exercises the real, compiled Worker over HTTP with the local D1 database.
// It signs in through the development-only token endpoint, walks the student
// journey (catalogue → lecture → exam start → answer → submit → result) and
// then verifies the admin surface (dashboard, taxonomy, question bank, exam
// builder, settings, audit). Uploads, YouTube, Sheets and FCM are checked only
// for their documented "not configured" behaviour, because they need external
// credentials.
//
// Usage:
//   npm run db:migrate:local
//   npx wrangler dev --port 8799 --local     # in another terminal
//   npm run test:api                          # BASE_URL=http://127.0.0.1:8799
//
// Exit code 0 = every assertion passed.
// =============================================================================

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:8799').replace(/\/$/, '');
const DEV_AUTH = process.env.DEV_AUTH !== 'false';

let passed = 0;
const failures = [];
const groups = [];

let currentGroup = null;

function group(name) {
  currentGroup = { name, ok: 0, failed: 0 };
  groups.push(currentGroup);
}

function record(ok, label, detail) {
  if (ok) {
    passed += 1;
    if (currentGroup) currentGroup.ok += 1;
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    if (currentGroup) currentGroup.failed += 1;
  }
}

function check(condition, label, detail) {
  record(Boolean(condition), label, detail);
  return Boolean(condition);
}

function eq(actual, expected, label) {
  const ok = actual === expected;
  record(ok, label, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return ok;
}

async function request(method, path, { token, body, headers = {}, raw = false } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch (err) {
    return { status: 0, error: err.message, data: null };
  }
  const contentType = response.headers.get('content-type') ?? '';
  let data = null;
  if (raw) {
    data = await response.text();
  } else if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }
  return { status: response.status, data, headers: response.headers, error: null };
}

const get = (path, options) => request('GET', path, options);
const post = (path, body, options = {}) => request('POST', path, { ...options, body });
const put = (path, body, options = {}) => request('PUT', path, { ...options, body });
const del = (path, body, options = {}) => request('DELETE', path, { ...options, body });

function firstId(list) {
  return Array.isArray(list) && list.length ? list[0].id : null;
}

async function main() {
  console.log(`PrepSetu API smoke test → ${BASE}\n`);

  // ---------------------------------------------------------------- health --
  group('Health & bootstrap');
  const health = await get('/healthz');
  if (!check(health.status === 200, 'GET /healthz returns 200', `got ${health.status}`)) {
    console.error('\nThe Worker is not reachable. Start it with:\n  npx wrangler dev --port 8799 --local\n');
    report();
    return;
  }
  check(health.data?.db === true, 'D1 reports healthy');
  check(typeof health.data?.time === 'string', 'healthz includes a timestamp');

  const security = await get('/api/auth/config');
  check(Boolean(security.headers?.get('x-request-id')), 'API responses carry X-Request-Id');

  const config = security;
  eq(config.status, 200, 'GET /api/auth/config');
  check(typeof config.data?.siteName === 'string' && config.data.siteName.length > 0, 'site name configured');
  if (config.data && config.data.devAuthEnabled === false) {
    console.log('\n  ! devAuthEnabled is false — skipping authenticated tests.');
    console.log('  ! Set DEV_AUTH_ENABLED=true in .dev.vars (and APP_ENV=development).\n');
    report();
    return;
  }
  check(config.data?.devAuthEnabled === true, 'development auth is enabled for tests');

  // -------------------------------------------------------------- sign-in --
  group('Authentication');
  const adminEmail = process.env.SUPER_ADMIN_EMAIL ?? 'arvindbishnoi@gmail.com';
  const adminLogin = await post('/api/auth/dev-login', { email: adminEmail, name: 'Smoke Admin' });
  const adminToken = adminLogin.data?.token;
  if (!check(adminLogin.status === 200 && Boolean(adminToken), 'super admin can sign in (dev-login)', `got ${adminLogin.status} ${JSON.stringify(adminLogin.data)?.slice(0, 180)}`)) {
    report();
    return;
  }
  const adminMe = await get('/api/auth/me', { token: adminToken });
  check(adminMe.data?.user?.isSuperAdmin === true || adminMe.data?.isSuperAdmin === true, '/api/auth/me identifies the super admin');
  check(typeof adminLogin.data?.expiresAt === 'string', 'dev-login returns an expiry timestamp');

  const studentEmail = `smoke.student.${Date.now()}@prepsetu.test`;
  const studentLogin = await post('/api/auth/dev-login', { email: studentEmail, name: 'Smoke Student' });
  const studentToken = studentLogin.data?.token;
  check(studentLogin.status === 200 && Boolean(studentToken), 'new student account is created on dev-login', `got ${studentLogin.status}`);

  const me = await get('/api/auth/me', { token: studentToken });
  eq(me.status, 200, 'GET /api/auth/me with a student token');
  check(!(me.data?.permissions ?? []).some((p) => p.startsWith('settings.')), 'students hold no admin permissions');

  const noToken = await get('/api/admin/dashboard');
  eq(noToken.status, 401, 'admin API rejects anonymous requests');

  const studentOnAdmin = await get('/api/admin/dashboard', { token: studentToken });
  eq(studentOnAdmin.status, 403, 'admin API rejects students (403)');

  // ------------------------------------------------------------- catalogue --
  group('Public catalogue');
  const home = await get('/api/home');
  eq(home.status, 200, 'GET /api/home');
  for (const key of ['classes', 'examTypes', 'featuredCourses', 'latestLectures', 'upcomingExams', 'popularExams', 'stats']) {
    check(home.data?.[key] !== undefined, `home payload has "${key}"`);
  }

  const classes = await get('/api/classes');
  eq(classes.status, 200, 'GET /api/classes');
  check(Array.isArray(classes.data?.items), 'classes list returns an items array');

  const examTypes = await get('/api/exam-types');
  eq(examTypes.status, 200, 'GET /api/exam-types');
  check(Array.isArray(examTypes.data?.items), 'exam types list returns an items array');

  const courses = await get('/api/courses');
  eq(courses.status, 200, 'GET /api/courses');

  const search = await get('/api/search?q=a');
  eq(search.status, 200, 'GET /api/search');

  const announcements = await get('/api/announcements');
  eq(announcements.status, 200, 'GET /api/announcements');

  // ---------------------------------------------------------------- admin ---
  group('Admin dashboard & system');
  const dashboard = await get('/api/admin/dashboard', { token: adminToken });
  eq(dashboard.status, 200, 'GET /api/admin/dashboard');
  check(typeof dashboard.data?.totalStudents === 'number', 'dashboard exposes totalStudents');
  check(typeof dashboard.data?.allCourses === 'number', 'dashboard exposes allCourses (incl. drafts)');
  check(typeof dashboard.data?.inProgressAttempts === 'number', 'dashboard exposes inProgressAttempts');
  check(Array.isArray(dashboard.data?.registrationsTrend), 'dashboard exposes registrationsTrend');

  const system = await get('/api/admin/system/status', { token: adminToken });
  eq(system.status, 200, 'GET /api/admin/system/status');
  for (const key of ['sheetsConfigured', 'youtubeConfigured', 'firebaseAdminConfigured', 'environment']) {
    check(system.data?.[key] !== undefined, `system status has "${key}"`);
  }

  const permissions = await get('/api/admin/meta/permissions', { token: adminToken });
  eq(permissions.status, 200, 'GET /api/admin/meta/permissions');
  const permissionList = permissions.data?.permissions ?? permissions.data?.items ?? [];
  check(Array.isArray(permissionList) && permissionList.length >= 30, 'permission catalogue is complete', `${permissionList.length} entries`);

  // ------------------------------------------------------------- taxonomy ---
  group('Taxonomy CRUD');
  const stamp = Date.now();
  const createdClass = await post('/api/admin/classes', { name: `Smoke Class ${stamp}`, sortOrder: 99 }, { token: adminToken });
  const classId = createdClass.data?.id;
  check([200, 201].includes(createdClass.status) && Boolean(classId), 'POST /api/admin/classes creates a class', `got ${createdClass.status}`);

  if (classId) {
    const renamed = await put(`/api/admin/classes/${classId}`, { name: `Smoke Class ${stamp} v2` }, { token: adminToken });
    eq(renamed.status, 200, 'PUT /api/admin/classes/:id updates it');

    const listed = await get('/api/admin/classes?pageSize=100', { token: adminToken });
    check((listed.data?.items ?? []).some((row) => row.id === classId), 'new class appears in the admin list');
  }

  const createdExamType = await post('/api/admin/exam-types', { name: `Smoke Exam ${stamp}`, sortOrder: 99 }, { token: adminToken });
  const examTypeId = createdExamType.data?.id;
  check([200, 201].includes(createdExamType.status) && Boolean(examTypeId), 'POST /api/admin/exam-types creates an exam type', `got ${createdExamType.status}`);

  const createdCourse = await post('/api/admin/courses', {
    name: `Smoke Course ${stamp}`,
    classId,
    examTypeId,
    description: 'Created by the API smoke test.',
    isFree: true,
    status: 'draft',
    visibility: 'public',
  }, { token: adminToken });
  const courseId = createdCourse.data?.id;
  check([200, 201].includes(createdCourse.status) && Boolean(courseId), 'POST /api/admin/courses creates a course', `got ${createdCourse.status} ${JSON.stringify(createdCourse.data)?.slice(0, 140)}`);

  let subjectId = null;
  let chapterId = null;
  if (courseId) {
    const subject = await post('/api/admin/subjects', { name: `Smoke Subject ${stamp}`, courseId }, { token: adminToken });
    subjectId = subject.data?.id;
    check([200, 201].includes(subject.status) && Boolean(subjectId), 'POST /api/admin/subjects creates a subject', `got ${subject.status}`);

    if (subjectId) {
      const chapter = await post('/api/admin/chapters', { name: `Smoke Chapter ${stamp}`, subjectId, courseId }, { token: adminToken });
      chapterId = chapter.data?.id;
      check([200, 201].includes(chapter.status) && Boolean(chapterId), 'POST /api/admin/chapters creates a chapter', `got ${chapter.status}`);
    }
  }

  // ------------------------------------------------------------ questions ---
  group('Question bank');
  let questionId = null;
  if (subjectId) {
    const question = await post('/api/admin/questions', {
      questionText: 'If 2x + 3 = 11, what is x? (smoke test)',
      questionType: 'single_correct',
      difficulty: 'easy',
      subjectId,
      chapterId,
      marks: 4,
      negativeMarks: 1,
      status: 'published',
      options: [
        { key: 'A', text: '2' },
        { key: 'B', text: '4' },
        { key: 'C', text: '5' },
        { key: 'D', text: '7' },
      ],
      correctOptions: ['B'],
      explanation: 'Subtract 3, then divide by 2 → x = 4.',
    }, { token: adminToken });
    questionId = question.data?.id;
    check([200, 201].includes(question.status) && Boolean(questionId), 'POST /api/admin/questions creates a question', `got ${question.status} ${JSON.stringify(question.data)?.slice(0, 160)}`);

    if (questionId) {
      const detail = await get(`/api/admin/questions/${questionId}`, { token: adminToken });
      eq(detail.status, 200, 'GET /api/admin/questions/:id');
      check(detail.data?.options?.length === 4, 'question has four stored options');
      check(detail.data?.options?.some((option) => option.isCorrect), 'answer key marks a correct option');

      const missingKey = await post('/api/admin/questions', {
        questionText: 'Invalid question without a key',
        questionType: 'single_correct',
        options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }],
      }, { token: adminToken });
      check(missingKey.status === 400, 'question without a correct option is rejected (400)', `got ${missingKey.status}`);
    }
  } else {
    record(false, 'question bank tests skipped (no subject created)');
  }

  // ---------------------------------------------------------------- exams ---
  group('Exam builder');
  let examId = null;
  let attemptId = null;
  let resultId = null;
  if (questionId) {
    const exam = await post('/api/admin/exams', {
      title: `Smoke Mock ${stamp}`,
      description: 'Created by the API smoke test.',
      instructions: 'One question. Choose carefully.',
      examKind: 'practice',
      courseId,
      examTypeId,
      durationMinutes: 30,
      marksPerQuestion: 4,
      negativeMarks: 1,
      negativeMarkingEnabled: true,
      maxAttempts: 1,
      resultPublishMode: 'immediate',
      isFree: true,
      status: 'draft',
    }, { token: adminToken });
    examId = exam.data?.id;
    check([200, 201].includes(exam.status) && Boolean(examId), 'POST /api/admin/exams creates an examination', `got ${exam.status}`);

    if (examId) {
      const attach = await post(`/api/admin/exams/${examId}/questions`, { questionIds: [questionId] }, { token: adminToken });
      eq(attach.status, 200, 'POST /api/admin/exams/:id/questions attaches a question');
      envless: {
        check(attach.data?.added === 1, 'attachment reports one question added', JSON.stringify(attach.data));
      }

      const duplicate = await post(`/api/admin/exams/${examId}/questions`, { questionIds: [questionId] }, { token: adminToken });
      check(duplicate.data?.skipped === 1, 're-attaching the same question is skipped, not duplicated');

      const section = await post(`/api/admin/exams/${examId}/sections`, { title: 'Section A', sortOrder: 0 }, { token: adminToken });
      check([200, 201].includes(section.status), 'POST /api/admin/exams/:id/sections creates a section', `got ${section.status}`);

      const builder = await get(`/api/admin/exams/${examId}`, { token: adminToken });
      eq(builder.status, 200, 'GET /api/admin/exams/:id (builder payload)');
      check(builder.data?.questions?.length === 1, 'builder lists the attached question');
      check(builder.data?.exam?.total_questions >= 1, 'total questions recomputed');

      const publishEmpty = await post('/api/admin/exams/00000000-0000-4000-8000-000000000000/publish', { publish: true }, { token: adminToken });
      check([400, 404].includes(publishEmpty.status), 'publishing a non-existent exam fails cleanly', `got ${publishEmpty.status}`);

      const publish = await post(`/api/admin/exams/${examId}/publish`, { publish: true }, { token: adminToken });
      eq(publish.status, 200, 'POST /api/admin/exams/:id/publish');

      const republished = await get(`/api/admin/exams/${examId}`, { token: adminToken });
      eq(republished.data?.exam?.status, 'published', 'published exam has status "published"');
    }
  } else {
    record(false, 'exam builder tests skipped (no question created)');
  }

  // --------------------------------------------------- student exam journey --
  group('Student exam journey');
  if (examId) {
    const examDetail = await get(`/api/exams/${examId}`, { token: studentToken });
    eq(examDetail.status, 200, 'GET /api/exams/:id as a student');

    const examList = await get('/api/exams', { token: studentToken });
    eq(examList.status, 200, 'GET /api/exams as a student');
    check((examList.data?.items ?? []).some((item) => item.id === examId), 'published exam is visible to students');

    const started = await post(`/api/exams/${examId}/start`, {}, { token: studentToken });
    attemptId = started.data?.attemptId ?? started.data?.attempt?.id;
    check([200, 201].includes(started.status) && Boolean(attemptId), 'POST /api/exams/:id/start creates an attempt', `got ${started.status} ${JSON.stringify(started.data)?.slice(0, 160)}`);

    if (attemptId) {
      const session = await get(`/api/exams/attempts/${attemptId}`, { token: studentToken });
      eq(session.status, 200, 'GET /api/exams/attempts/:attemptId returns the session');
      check(typeof session.data?.serverNowMs === 'number', 'session exposes serverNowMs (server clock wins)');
      const firstQuestion = (session.data?.questions ?? [])[0];
      check(Boolean(firstQuestion), 'session contains the attached question');
      const leaked = JSON.stringify(session.data ?? {});
      check(!/"isCorrect"|"correctOptions"|"answerKey"/.test(leaked), 'session payload never leaks answer keys');

      const secondStart = await post(`/api/exams/${examId}/start`, {}, { token: studentToken });
      check([200, 201, 409].includes(secondStart.status), 'starting twice resumes or is blocked (never errors 500)', `got ${secondStart.status}`);

      if (firstQuestion) {
        const optionKey = firstQuestion.options?.[1]?.key ?? 'B';
        const save = await post(`/api/exams/attempts/${attemptId}/answers`, {
          answers: [{ examQuestionId: firstQuestion.examQuestionId, selectedOptions: [optionKey] }],
        }, { token: studentToken });
        check([200, 204].includes(save.status), 'POST answers saves the response', `got ${save.status}`);

        const beat = await post(`/api/exams/attempts/${attemptId}/heartbeat`, {}, { token: studentToken });
        check([200, 204].includes(beat.status), 'POST heartbeat keeps the attempt alive', `got ${beat.status}`);

        const submit = await post(`/api/exams/attempts/${attemptId}/submit`, {}, { token: studentToken });
        check([200, 201].includes(submit.status), 'POST submit evaluates the attempt', `got ${submit.status} ${JSON.stringify(submit.data)?.slice(0, 160)}`);
        resultId = submit.data?.resultId;

        const afterSubmit = await get(`/api/exams/attempts/${attemptId}`, { token: studentToken });
        check(afterSubmit.data?.submitted === true, 'attempt reports submitted after submit');
        check(!afterSubmit.data?.questions?.length, 'questions are no longer exposed after submission');
      }
    }
  } else {
    record(false, 'student journey skipped (no exam created)');
  }

  // --------------------------------------------------------------- results --
  group('Results & review');
  if (resultId) {
    const result = await get(`/api/results/${resultId}`, { token: studentToken });
    eq(result.status, 200, 'GET /api/results/:id');
    check(Array.isArray(result.data?.review), 'result review is a question array');
    const review = result.data?.review?.[0];
    if (review) {
      check(typeof review.marksAwarded === 'number', 'review includes marksAwarded');
      check(review.options?.some((option) => option.isCorrect), 'answer key is revealed in a visible result');
      check(review.explanation !== undefined, 'review carries the explanation field');
    }
    check(typeof result.data?.percentage === 'number', 'result exposes a percentage');

    const history = await get('/api/student/dashboard', { token: studentToken });
    eq(history.status, 200, 'GET /api/student/dashboard');
  } else {
    const maybeResult = await get('/api/results/00000000-0000-4000-8000-000000000000', { token: studentToken });
    check([400, 404].includes(maybeResult.status), 'unknown result id fails cleanly', `got ${maybeResult.status}`);
  }

  // ------------------------------------------------------------- progress ---
  group('Student profile & progress');
  const prefs = await get('/api/notifications/preferences', { token: studentToken });
  eq(prefs.status, 200, 'GET /api/notifications/preferences');

  const savePrefs = await put('/api/notifications/preferences', { preferences: { push: false, examReminders: true, garbage: 'ignored' } }, { token: studentToken });
  eq(savePrefs.status, 200, 'PUT /api/notifications/preferences');
  eq(savePrefs.data?.preferences?.push, false, 'preference change is persisted');
  const reread = await get('/api/notifications/preferences', { token: studentToken });
  eq(reread.data?.preferences?.push, false, 'preference change survives a re-read');
  check(savePrefs.data?.preferences?.garbage === undefined, 'unknown preference keys are ignored');

  const profile = await put('/api/auth/profile', { fullName: 'Smoke Student Renamed' }, { token: studentToken });
  check([200, 204].includes(profile.status), 'PUT /api/auth/profile updates the profile', `got ${profile.status}`);

  const onboarding = await post('/api/auth/onboarding', {
    fullName: 'Smoke Student Renamed',
    classId,
    targetExamTypeId: examTypeId,
    studyGoalMinutes: 60,
  }, { token: studentToken });
  check([200, 204].includes(onboarding.status), 'POST /api/auth/onboarding completes onboarding', `got ${onboarding.status} ${JSON.stringify(onboarding.data)?.slice(0, 160)}`);
  check(onboarding.data?.user?.profile?.onboardingCompleted === true || onboarding.data?.user !== undefined, 'onboarding returns the refreshed session');
  if (onboarding.status === 200) {
    const invalidOnboarding = await post('/api/auth/onboarding', { fullName: 'X' }, { token: studentToken });
    check(invalidOnboarding.status === 400, 'incomplete onboarding payload is rejected (400)', `got ${invalidOnboarding.status}`);
  }

  const notifications = await get('/api/notifications', { token: studentToken });
  eq(notifications.status, 200, 'GET /api/notifications (feed)');

  const bookmarks = await get('/api/bookmarks', { token: studentToken });
  eq(bookmarks.status, 200, 'GET /api/bookmarks');

  // -------------------------------------------------------- announcements ---
  group('Announcements & notifications (admin)');
  const announcement = await post('/api/admin/announcements', {
    title: `Smoke announcement ${stamp}`,
    body: 'This row is created and deleted by the API smoke test.',
    priority: 'normal',
    status: 'published',
    target_audience: 'all',
  }, { token: adminToken });
  check([200, 201].includes(announcement.status), 'POST /api/admin/announcements creates one', `got ${announcement.status} ${JSON.stringify(announcement.data)?.slice(0, 140)}`);
  const announcementId = announcement.data?.id;
  if (announcementId) {
    const visible = await get('/api/notifications', { token: studentToken });
    check((visible.data?.items ?? visible.data?.announcements ?? []).some((item) => item.id === announcementId), 'new announcement reaches the student feed');

    const updated = await put(`/api/admin/announcements/${announcementId}`, { title: `Smoke announcement ${stamp} (edited)` }, { token: adminToken });
    eq(updated.status, 200, 'PUT /api/admin/announcements/:id');

    const removed = await del(`/api/admin/announcements/${announcementId}`, { confirm: 'DELETE' }, { token: adminToken });
    eq(removed.status, 200, 'DELETE /api/admin/announcements/:id');
  }

  const audience = await post('/api/admin/notifications/audience-preview', { targetType: 'all' }, { token: adminToken });
  eq(audience.status, 200, 'POST /api/admin/notifications/audience-preview');
  check(typeof audience.data?.recipients === 'number', 'audience preview reports a recipient count');

  const notificationHealth = await get('/api/admin/notifications/health', { token: adminToken });
  eq(notificationHealth.status, 200, 'GET /api/admin/notifications/health');

  // -------------------------------------------------------------- settings --
  group('Settings');
  const settings = await get('/api/admin/settings', { token: adminToken });
  eq(settings.status, 200, 'GET /api/admin/settings');
  check(Array.isArray(settings.data?.settings) && settings.data.settings.length > 0, 'settings rows are seeded');
  check(settings.data?.canManage === true, 'super admin can manage settings');

  const settingUpdate = await put('/api/admin/settings', { updates: [{ key: 'site.tagline', value: 'Your bridge to success' }] }, { token: adminToken });
  eq(settingUpdate.status, 200, 'PUT /api/admin/settings accepts a value');

  const badSetting = await put('/api/admin/settings', { updates: [{ key: 'nonexistent.key', value: 'x' }] }, { token: adminToken });
  check(badSetting.status === 400, 'unknown setting keys are rejected (400)', `got ${badSetting.status}`);

  const badBoolean = await put('/api/admin/settings', { updates: [{ key: 'site.maintenance_mode', value: 'maybe' }] }, { token: adminToken });
  check(badBoolean.status === 400, 'invalid booleans are rejected (400)', `got ${badBoolean.status}`);

  // ------------------------------------------------------------ audit/sync ---
  group('Audit, sheets & analytics');
  const audit = await get('/api/admin/audit-logs', { token: adminToken });
  eq(audit.status, 200, 'GET /api/admin/audit-logs');
  check(Array.isArray(audit.data?.items) && audit.data.items.length > 0, 'writes above produced audit entries');
  check((audit.data?.items ?? []).some((row) => String(row.action).startsWith('course.create') || String(row.action).startsWith('question.create')), 'audit log records content changes');
  check(Array.isArray(audit.data?.actions), 'audit log exposes the action filter list');

  const sheets = await get('/api/admin/sheets/status', { token: adminToken });
  eq(sheets.status, 200, 'GET /api/admin/sheets/status');
  check(sheets.data?.configured === false, 'Sheets reports "not configured" without credentials');
  check(Array.isArray(sheets.data?.specs), 'Sheets lists expected sheet specs');

  const syncAttempt = await post('/api/admin/sheets/sync', { mode: 'incremental' }, { token: adminToken });
  check([200, 409, 412, 502].includes(syncAttempt.status), 'Sheets sync fails gracefully when unconfigured', `got ${syncAttempt.status}`);
  if (syncAttempt.status === 200) {
    eq(syncAttempt.data?.report?.status, 'failed', 'unconfigured sync reports status "failed"');
    check(typeof syncAttempt.data?.report?.errorMessage === 'string', 'unconfigured sync explains the missing secret');
  }

  const analytics = await get('/api/admin/analytics/overview?days=30', { token: adminToken });
  eq(analytics.status, 200, 'GET /api/admin/analytics/overview');
  for (const key of ['signupsTrend', 'attemptsTrend', 'engagement', 'subjectPerformance', 'lectureCompletionRate']) {
    check(analytics.data?.[key] !== undefined, `analytics has "${key}"`);
  }

  if (examId) {
    const examAnalytics = await get(`/api/admin/analytics/exam/${examId}`, { token: adminToken });
    eq(examAnalytics.status, 200, 'GET /api/admin/analytics/exam/:id');
    check(examAnalytics.data?.summary !== undefined, 'exam analytics has a summary');
    check(Array.isArray(examAnalytics.data?.distribution), 'exam analytics has a score distribution');
  }

  const activeStudents = await get('/api/admin/analytics/students/active?days=7', { token: adminToken });
  eq(activeStudents.status, 200, 'GET /api/admin/analytics/students/active');

  const results = await get('/api/admin/results?pageSize=10', { token: adminToken });
  eq(results.status, 200, 'GET /api/admin/results');

  const resultsCsv = await get('/api/admin/results/export', { token: adminToken, raw: true });
  eq(resultsCsv.status, 200, 'GET /api/admin/results/export (CSV)');
  check(typeof resultsCsv.data === 'string' && resultsCsv.data.includes(','), 'CSV export contains comma-separated data');

  const auditCsv = await get('/api/admin/audit-logs/export', { token: adminToken, raw: true });
  eq(auditCsv.status, 200, 'GET /api/admin/audit-logs/export (CSV)');

  // ------------------------------------------------------------- external ---
  group('External integrations (unconfigured paths)');
  const youtubeMetadata = await post('/api/admin/youtube/metadata', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, { token: adminToken });
  check([200, 412, 422, 503].includes(youtubeMetadata.status), 'YouTube metadata degrades gracefully without an API key', `got ${youtubeMetadata.status}`);
  if (youtubeMetadata.status === 200) {
    check(youtubeMetadata.data?.ok === false, 'YouTube metadata reports ok:false when unavailable');
    check(typeof youtubeMetadata.data?.message === 'string', 'YouTube metadata explains why it is unavailable');
    check(youtubeMetadata.data?.fallback !== undefined, 'YouTube metadata returns a URL fallback');
  }

  const paperUpload = await post('/api/admin/test-papers/upload', {}, { token: adminToken });
  check([400, 412, 415].includes(paperUpload.status), 'paper upload requires multipart and R2 (412 without the binding)', `got ${paperUpload.status}`);

  // -------------------------------------------------------------- cleanup ---
  group('Cleanup');
  if (examId) {
    const removeExam = await del(`/api/admin/exams/${examId}`, { confirm: 'DELETE' }, { token: adminToken });
    check([200, 409].includes(removeExam.status), 'exam delete archives or reports attempts (never 500)', `got ${removeExam.status}`);
  }

  if (questionId) {
    const removeQuestion = await del(`/api/admin/questions/${questionId}`, { confirm: 'DELETE' }, { token: adminToken });
    check([200, 409].includes(removeQuestion.status), 'question delete succeeds or reports usage', `got ${removeQuestion.status}`);
  }

  if (courseId) {
    const removeCourse = await del(`/api/admin/courses/${courseId}`, { confirm: 'DELETE' }, { token: adminToken });
    check([200, 409].includes(removeCourse.status), 'course delete succeeds or reports usage', `got ${removeCourse.status}`);
  }

  if (examTypeId) {
    const removeExamType = await del(`/api/admin/exam-types/${examTypeId}`, { confirm: 'DELETE' }, { token: adminToken });
    check([200, 409].includes(removeExamType.status), 'exam type delete succeeds or reports usage', `got ${removeExamType.status}`);
  }

  if (classId) {
    const removeClass = await del(`/api/admin/classes/${classId}`, { confirm: 'DELETE' }, { token: adminToken });
    check([200, 409].includes(removeClass.status), 'class delete succeeds or reports usage', `got ${removeClass.status}`);
  }

  report();
}

function report() {
  console.log('');
  for (const entry of groups) {
    const icon = entry.failed === 0 ? '✓' : '✗';
    console.log(`  ${icon} ${entry.name.padEnd(42)} ${String(entry.ok).padStart(3)} passed${entry.failed ? `, ${entry.failed} failed` : ''}`);
  }
  console.log('');
  if (failures.length) {
    console.log(`${failures.length} failure(s):\n`);
    for (const failure of failures) console.log(`  • ${failure}`);
    console.log('');
    process.exit(1);
  }
  console.log(`All ${passed} assertions passed.\n`);
}

main().catch((err) => {
  console.error('\nThe smoke test crashed:', err);
  process.exit(1);
});
