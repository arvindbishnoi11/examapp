// =============================================================================
// Shared API contract types (Worker ⇄ frontend)
// =============================================================================

export type ApiError = { error: { code: string; message: string; details?: unknown; requestId?: string } };

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ExamKind =
  | 'practice'
  | 'chapter'
  | 'topic'
  | 'full_mock'
  | 'previous_year'
  | 'board'
  | 'custom';

export type QuestionType =
  | 'single_correct'
  | 'multiple_correct'
  | 'numerical'
  | 'numeric'
  | 'integer'
  | 'passage'
  | 'image_based';

export type ContentStatus = 'draft' | 'published' | 'archived';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type AttemptStatus =
  | 'in_progress'
  | 'submitted'
  | 'auto_submitted'
  | 'expired'
  | 'evaluated'
  | 'abandoned';

export type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  photoUrl: string | null;
  status: 'active' | 'suspended' | 'deleted';
  roles: string[];
  permissions: string[];
  isStaff: boolean;
  isSuperAdmin: boolean;
  profile: StudentProfile | null;
};

export type StudentProfile = {
  fullName: string | null;
  classId: string | null;
  targetExamTypeId: string | null;
  city: string | null;
  state: string | null;
  school: string | null;
  bio: string | null;
  language: string;
  avatarUrl: string | null;
  onboardingCompleted: boolean;
  notificationPrefs: {
    push: boolean;
    email: boolean;
    examReminders: boolean;
    newContent: boolean;
  };
  studyGoalMinutes: number;
  streakDays: number;
};

// ---- Catalogue --------------------------------------------------------------

export type ClassRef = { id: string; name: string; slug: string; level: number; color?: string | null };

export type ExamTypeRef = {
  id: string;
  name: string;
  slug: string;
  shortName?: string | null;
  color?: string | null;
};

export type CourseCard = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  coverImageUrl: string | null;
  classId: string | null;
  examTypeId: string | null;
  className?: string | null;
  examTypeName?: string | null;
  isFree: boolean;
  isFeatured: boolean;
  status: ContentStatus;
  subjectCount?: number;
  lectureCount?: number;
  examCount?: number;
  progressPercent?: number;
  tags?: string[] | null;
};

export type SubjectRef = {
  id: string;
  courseId: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  chapterCount?: number;
};

export type ChapterRef = {
  id: string;
  subjectId: string;
  courseId: string;
  name: string;
  slug: string;
  sortOrder: number;
  lectureCount?: number;
  examCount?: number;
};

export type LectureCard = {
  id: string;
  title: string;
  description: string | null;
  youtubeVideoId: string;
  thumbnailUrl: string | null;
  channelName: string | null;
  durationSeconds: number | null;
  lectureNumber: number | null;
  isFree: boolean;
  status: ContentStatus;
  seriesId: string | null;
  seriesTitle?: string | null;
  courseId: string | null;
  courseName?: string | null;
  subjectName?: string | null;
  chapterName?: string | null;
  viewCount: number;
  publishedAt: string | null;
  createdAt: string;
  progressPercent?: number;
};

export type LectureSeriesCard = {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  courseId: string;
  courseName?: string | null;
  chapterName?: string | null;
  lectureCount: number;
  totalMinutes: number;
  isFree: boolean;
  status: ContentStatus;
};

export type ExamCard = {
  id: string;
  title: string;
  description: string | null;
  examKind: ExamKind;
  courseId: string | null;
  courseName?: string | null;
  examTypeName?: string | null;
  subjectName?: string | null;
  durationMinutes: number;
  totalMarks: number;
  totalQuestions: number;
  negativeMarks: number;
  negativeMarkingEnabled: boolean;
  startAt: string | null;
  endAt: string | null;
  maxAttempts: number;
  isFree: boolean;
  status: string;
  attemptsUsed?: number;
  bestScore?: number | null;
};

export type BookmarkItem = {
  id: string;
  itemType: 'lecture' | 'course' | 'exam' | 'test_paper' | 'series';
  itemId: string;
  createdAt: string;
  /** Resolved title/subtitle come from `detail` on the API response. */
  title?: string | null;
  subtitle?: string | null;
  detail?: { id: string; title: string; thumbnailUrl?: string | null; [key: string]: unknown } | null;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  isPinned: boolean;
  publishAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type TestPaper = {
  id: string;
  title: string;
  description: string | null;
  className?: string | null;
  examTypeName?: string | null;
  subjectName?: string | null;
  year: number | null;
  category: string | null;
  coverImageUrl: string | null;
  fileUrl: string;
  fileSizeBytes: number | null;
  answerKeyUrl: string | null;
  solutionUrl: string | null;
  downloadCount: number;
  isFree: boolean;
  status: ContentStatus;
  visibility: 'public' | 'authenticated' | 'restricted';
  createdAt: string;
};

// ---- Examination engine -----------------------------------------------------

/** A question as delivered to the student DURING an attempt.
 *  Deliberately has no `isCorrect`, no answer key and no explanation. */
export type ExamQuestionView = {
  examQuestionId: string;
  questionId: string;
  sectionId: string | null;
  sectionTitle: string | null;
  questionType: QuestionType;
  difficulty: Difficulty;
  questionText: string;
  questionImageUrl: string | null;
  passageText: string | null;
  passageImageUrl: string | null;
  marks: number;
  negativeMarks: number;
  options: { key: string; text: string | null; imageUrl: string | null }[];
  sortOrder: number;
};

export type ExamSession = {
  attemptId: string;
  exam: {
    id: string;
    title: string;
    instructions: string | null;
    durationMinutes: number;
    totalMarks: number;
    totalQuestions: number;
    negativeMarkingEnabled: boolean;
    allowSectionNavigation: boolean;
    resultPublishMode: 'immediate' | 'after_window' | 'manual';
  };
  attemptNumber: number;
  startedAt: string;
  /** Epoch ms. The server enforces this; the client only displays it. */
  expiresAtMs: number;
  serverNowMs: number;
  questions: ExamQuestionView[];
  answers: SavedAnswer[];
  sections: { id: string; title: string; subjectName?: string | null; sortOrder: number }[];
};

export type SavedAnswer = {
  examQuestionId: string;
  selectedOptions: string[];
  numericAnswer: number | null;
  integerAnswer: number | null;
  status: 'not_answered' | 'answered' | 'marked_for_review' | 'answered_marked';
  timeSpentSeconds: number;
};

export type AnswerPayload = {
  examQuestionId: string;
  selectedOptions?: string[];
  numericAnswer?: number | null;
  integerAnswer?: number | null;
  status: 'not_answered' | 'answered' | 'marked_for_review' | 'answered_marked';
  timeSpentSeconds?: number;
};

export type ResultSummary = {
  id: string;
  attemptId: string;
  examId: string;
  examTitle: string;
  score: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  timeSpentSeconds: number;
  passed: boolean;
  rank: number | null;
  percentile: number | null;
  isPublished: boolean;
  computedAt: string;
  /** Present only once the result is released. */
  review?: ResultReview | null;
  subjectBreakdown?: SubjectBreakdown[] | null;
  chapterBreakdown?: ChapterBreakdown[] | null;
};

export type SubjectBreakdown = {
  subject: string;
  total: number;
  correct: number;
  wrong: number;
  unattempted: number;
  score: number;
  maxScore: number;
  accuracy: number;
};

export type ChapterBreakdown = SubjectBreakdown & { chapter: string };

export type ResultReviewQuestion = {
  examQuestionId: string;
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  options: { key: string; text: string | null; isCorrect: boolean }[];
  selectedOptions: string[];
  numericAnswer: number | null;
  correctOptions: string[];
  numericAnswerValue: number | null;
  correctInteger?: number | null;
  explanation: string | null;
  evaluation: 'correct' | 'wrong' | 'partial' | 'unattempted';
  marksAwarded: number;
  status: string;
};

export type ResultReview = ResultReviewQuestion[];

export type AttemptHistoryItem = {
  attemptId: string;
  examId: string;
  examTitle: string;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  resultPublished: boolean;
  resultId?: string | null;
};

// ---- Admin ------------------------------------------------------------------

export type DashboardStats = {
  totalStudents: number;
  activeStudents: number;
  newRegistrations: number;
  suspendedStudents?: number;
  staffCount?: number;
  totalCourses: number;
  allCourses: number;
  totalLectures: number;
  allLectures: number;
  totalSubjects?: number;
  totalChapters?: number;
  totalSeries?: number;
  totalExams: number;
  totalQuestions: number;
  totalAttempts: number;
  inProgressAttempts: number;
  totalResults: number;
  totalTestPapers: number;
  pendingSyncs: number;
  recentActivities: {
    id: string;
    action: string;
    actorEmail: string | null;
    entityType: string | null;
    createdAt: string;
    status: string;
  }[];
  popularLectures: { id: string; title: string; viewCount: number; thumbnailUrl: string | null }[];
  mostAttemptedExams: { id: string; title: string; attempts: number; totalQuestions: number }[];
  performanceOverview: { examTitle: string; avgScore: number; maxScore: number; attempts: number }[];
  registrationsTrend: { date: string; count: number }[];
  attemptsTrend: { date: string; count: number }[];
};

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  emailVerified: boolean;
  roles: string[];
  createdAt: string;
  lastLoginAt: string | null;
  classId: string | null;
  className?: string | null;
  targetExamTypeId: string | null;
  targetExamName?: string | null;
};

export type AuditLogRow = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  metaJson: string | null;
  createdAt: string;
};

export type SyncSheetReport = {
  sheet: string;
  entity: string;
  detected: boolean;
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
};

export type SyncReport = {
  id?: string;
  mode: 'preview' | 'full' | 'incremental' | 'scheduled';
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  sheets: SyncSheetReport[];
  errorMessage?: string | null;
};

export type SheetsStatus = {
  configured: boolean;
  spreadsheetId: string;
  spreadsheetTitle?: string | null;
  worksheets: { title: string; rowCount: number; mappedEntity: string | null; headerSample: string[] }[];
  lastSync: {
    id: string;
    mode: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    statsJson: string | null;
  } | null;
  schedulerEnabled: boolean;
  syncInProgress?: boolean;
  specs?: { entity: string; sheets: string[]; description: string; requiredColumns: string[] }[];
  message?: string;
};

export type NotificationComposerInput = {
  title: string;
  body: string;
  imageUrl?: string;
  deepLink?: string;
  targetType: 'all' | 'class' | 'exam_type' | 'course' | 'user' | 'users';
  targetValue?: string | null;
  scheduledAt?: string | null;
};

export type AdminLecture = LectureCard & {
  youtubeUrl?: string | null;
  visibility?: string;
  subjectId?: string | null;
  chapterId?: string | null;
  tags?: string | null;
  language?: string;
  sortOrder?: number;
  courseIds?: string[];
  updatedAt?: string;
};
