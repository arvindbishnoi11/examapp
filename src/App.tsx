import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { StudentLayout } from '@/components/layout/StudentLayout';
import { RequireAuth, RequirePermission } from '@/components/ui/Guard';
import { AdminTaxonomyProvider } from '@/components/admin/AdminContext';
import { Spinner } from '@/components/ui';

// Student pages (lazy — keeps the initial bundle small for slow networks).
const HomePage = lazy(() => import('@/pages/student/HomePage'));
const CoursesPage = lazy(() => import('@/pages/student/CoursesPage'));
const CourseDetailPage = lazy(() => import('@/pages/student/CourseDetailPage'));
const LecturesPage = lazy(() => import('@/pages/student/LecturesPage'));
const LectureDetailPage = lazy(() => import('@/pages/student/LectureDetailPage'));
const SeriesDetailPage = lazy(() => import('@/pages/student/SeriesDetailPage'));
const TestsPage = lazy(() => import('@/pages/student/TestsPage'));
const ExamDetailPage = lazy(() => import('@/pages/student/ExamDetailPage'));
const ExamAttemptPage = lazy(() => import('@/pages/student/ExamAttemptPage'));
const ResultPage = lazy(() => import('@/pages/student/ResultPage'));
const PapersPage = lazy(() => import('@/pages/student/PapersPage'));
const PaperDetailPage = lazy(() => import('@/pages/student/PaperDetailPage'));
const ProfilePage = lazy(() => import('@/pages/student/ProfilePage'));
const AnnouncementsPage = lazy(() => import('@/pages/student/AnnouncementsPage'));
const NotificationsPage = lazy(() => import('@/pages/student/NotificationsPage'));
const BookmarksPage = lazy(() => import('@/pages/student/BookmarksPage'));

// Auth
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage'));
const OnboardingPage = lazy(() => import('@/pages/auth/OnboardingPage'));

// Admin
const AdminLayout = lazy(() => import('@/components/admin/AdminLayout'));
const AdminDashboardPage = lazy(() => import('@/pages/admin/DashboardPage'));
const AdminStudentsPage = lazy(() => import('@/pages/admin/StudentsPage'));
const AdminAdminsPage = lazy(() => import('@/pages/admin/AdminsPage'));
const AdminCoursesPage = lazy(() => import('@/pages/admin/CoursesPage'));
const AdminTaxonomyPage = lazy(() => import('@/pages/admin/TaxonomyPage'));
const AdminLecturesPage = lazy(() => import('@/pages/admin/LecturesPage'));
const AdminYouTubePage = lazy(() => import('@/pages/admin/YouTubePage'));
const AdminTestSeriesPage = lazy(() => import('@/pages/admin/TestSeriesPage'));
const AdminExamsPage = lazy(() => import('@/pages/admin/ExamsPage'));
const AdminExamBuilderPage = lazy(() => import('@/pages/admin/ExamBuilderPage'));
const AdminQuestionsPage = lazy(() => import('@/pages/admin/QuestionsPage'));
const AdminPapersPage = lazy(() => import('@/pages/admin/PapersPage'));
const AdminResultsPage = lazy(() => import('@/pages/admin/ResultsPage'));
const AdminNotificationsPage = lazy(() => import('@/pages/admin/NotificationsPage'));
const AdminAnnouncementsPage = lazy(() => import('@/pages/admin/AnnouncementsPage'));
const AdminSheetsPage = lazy(() => import('@/pages/admin/SheetsPage'));
const AdminAnalyticsPage = lazy(() => import('@/pages/admin/AnalyticsPage'));
const AdminAuditPage = lazy(() => import('@/pages/admin/AuditPage'));
const AdminSettingsPage = lazy(() => import('@/pages/admin/SettingsPage'));

const NotFoundPage = lazy(() => import('@/pages/student/NotFoundPage'));

function RouteFallback() {
  return (
    <div className="container-app py-16">
      <Spinner label="Loading…" />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* ---- Student app ------------------------------------------------- */}
        <Route element={<StudentLayout />}>
          <Route index element={<HomePage />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="courses/:id" element={<CourseDetailPage />} />
          <Route path="lectures" element={<LecturesPage />} />
          <Route path="lectures/:id" element={<LectureDetailPage />} />
          <Route path="series/:id" element={<SeriesDetailPage />} />
          <Route path="tests" element={<TestsPage />} />
          <Route path="tests/:id" element={<ExamDetailPage />} />
          <Route path="results/:id" element={<ResultPage />} />
          <Route path="papers" element={<PapersPage />} />
          <Route path="papers/:id" element={<PaperDetailPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route
            path="profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="bookmarks"
            element={
              <RequireAuth>
                <BookmarksPage />
              </RequireAuth>
            }
          />
          <Route
            path="history"
            element={
              <RequireAuth>
                <ProfilePage initialTab="history" />
              </RequireAuth>
            }
          />
        </Route>

        {/* Exam attempt runs full-bleed (no bottom nav) ---------------------- */}
        <Route
          path="/attempts/:attemptId"
          element={
            <RequireAuth>
              <ExamAttemptPage />
            </RequireAuth>
          }
        />

        {/* ---- Auth -------------------------------------------------------- */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <OnboardingPage />
            </RequireAuth>
          }
        />

        {/* ---- Admin ------------------------------------------------------- */}
        <Route
          path="/admin"
          element={
            <RequirePermission>
              <AdminTaxonomyProvider>
                <AdminLayout />
              </AdminTaxonomyProvider>
            </RequirePermission>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="students" element={<RequirePermission permission="students.view"><AdminStudentsPage /></RequirePermission>} />
          <Route path="admins" element={<RequirePermission permission="admins.view"><AdminAdminsPage /></RequirePermission>} />
          <Route path="courses" element={<RequirePermission permission="courses.view"><AdminCoursesPage /></RequirePermission>} />
          <Route path="taxonomy" element={<RequirePermission permission="courses.view"><AdminTaxonomyPage /></RequirePermission>} />
          <Route path="lectures" element={<RequirePermission permission="lectures.view"><AdminLecturesPage /></RequirePermission>} />
          <Route path="youtube" element={<RequirePermission permission="youtube.manage"><AdminYouTubePage /></RequirePermission>} />
          <Route path="test-series" element={<RequirePermission permission="exams.view"><AdminTestSeriesPage /></RequirePermission>} />
          <Route path="exams" element={<RequirePermission permission="exams.view"><AdminExamsPage /></RequirePermission>} />
          <Route path="exams/:id" element={<RequirePermission permission="exams.view"><AdminExamBuilderPage /></RequirePermission>} />
          <Route path="questions" element={<RequirePermission permission="questions.view"><AdminQuestionsPage /></RequirePermission>} />
          <Route path="papers" element={<RequirePermission permission="test_papers.manage"><AdminPapersPage /></RequirePermission>} />
          <Route path="results" element={<RequirePermission permission="results.view"><AdminResultsPage /></RequirePermission>} />
          <Route path="notifications" element={<RequirePermission permission="notifications.manage"><AdminNotificationsPage /></RequirePermission>} />
          <Route path="announcements" element={<RequirePermission permission="announcements.manage"><AdminAnnouncementsPage /></RequirePermission>} />
          <Route path="sheets" element={<RequirePermission permission="sheets.view"><AdminSheetsPage /></RequirePermission>} />
          <Route path="analytics" element={<RequirePermission permission="analytics.view"><AdminAnalyticsPage /></RequirePermission>} />
          <Route path="audit-logs" element={<RequirePermission permission="audit.view"><AdminAuditPage /></RequirePermission>} />
          <Route path="settings" element={<RequirePermission permission="settings.view"><AdminSettingsPage /></RequirePermission>} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
