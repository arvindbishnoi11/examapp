import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  ChevronRight,
  FileText,
  Flame,
  GraduationCap,
  PlayCircle,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Badge, Card, CardSkeletonGrid, EmptyState, ErrorState, ProgressBar, Skeleton } from '@/components/ui';
import { ExamCardItem, LectureCardItem, Thumb } from '@/components/ui/ContentCard';
import { formatRelative, formatDurationLabel } from '@/lib/format';
import type { Announcement, ExamCard, LectureCard } from '@shared/types';

type HomePayload = {
  classes: { id: string; name: string; slug: string; level: number; color?: string | null }[];
  examTypes: { id: string; name: string; slug: string; shortName?: string | null; color?: string | null }[];
  featuredCourses: {
    id: string;
    name: string;
    slug: string;
    shortDescription: string | null;
    coverImageUrl: string | null;
    className: string | null;
    examTypeName: string | null;
    lectureCount: number;
    examCount: number;
    isFree: boolean;
  }[];
  latestLectures: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    youtubeVideoId: string;
    courseName: string | null;
  }[];
  upcomingExams: ExamCard[];
  popularExams: (ExamCard & { attemptCount?: number })[];
  announcements: Announcement[];
  latestSeries: { id: string; title: string; thumbnailUrl: string | null; lectureCount: number; totalMinutes: number }[];
  continueLearning: {
    lectureId: string;
    percent: number;
    lastPosition: number;
    title: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    youtubeVideoId: string;
  }[];
  stats: { lecturesCompleted: number; examsTaken: number; bookmarks: number } | null;
  signedIn: boolean;
};

const GREETING_ICONS = [Sparkles, Target, Flame, TrendingUp];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomePage() {
  useDocumentTitle();
  const { user, status } = useAuth();
  const { data, loading, error, refetch } = useApiQuery<HomePayload>('/api/home', undefined, {
    auth: status === 'authenticated',
    enabled: status !== 'loading',
  });

  if (error) {
    return (
      <div className="container-app py-8">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="container-app space-y-6 py-5">
        <Skeleton className="h-32 w-full rounded-xl2" />
        <CardSkeletonGrid count={3} />
        <CardSkeletonGrid count={3} />
      </div>
    );
  }

  if (!data) return null;

  const firstName = (user?.profile?.fullName ?? user?.displayName ?? '').split(' ')[0];
  const needsOnboarding = status === 'authenticated' && user && !user.profile?.onboardingCompleted;
  const topAnnouncement = data.announcements[0];

  return (
    <div className="container-app space-y-7 py-4 sm:py-6">
      {/* ---- Greeting hero ------------------------------------------------ */}
      <section className="relative overflow-hidden rounded-xl3 bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 p-5 text-white shadow-float sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-sky-400/20 blur-3xl" aria-hidden />
        <div className="relative">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-white/70">
            {status === 'authenticated' ? greeting() : 'Welcome to PrepSetu'}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold leading-tight sm:text-3xl">
            {status === 'authenticated'
              ? firstName
                ? `Keep going, ${firstName}`
                : 'Ready for today’s practice?'
              : 'Your bridge to JEE, NEET and Boards'}
          </h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-white/80">
            {status === 'authenticated'
              ? 'Short lectures, chapter tests and full-length mocks — everything you need in one place.'
              : 'Curated video lectures, chapter tests, full-length mock exams and previous-year papers for Class 11, Class 12, JEE and NEET.'}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {status === 'authenticated' ? (
              <>
                <Link to="/lectures" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-white/90">
                  <PlayCircle className="h-4 w-4" aria-hidden /> Continue learning
                </Link>
                <Link to="/tests" className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20">
                  <FileText className="h-4 w-4" aria-hidden /> Take a test
                </Link>
              </>
            ) : (
              <>
                <Link to="/register" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-white/90">
                  Create free account <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link to="/login" className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20">
                  Sign in
                </Link>
              </>
            )}
          </div>

          {status === 'authenticated' && data.stats ? (
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[
                { label: 'Lectures done', value: data.stats.lecturesCompleted },
                { label: 'Tests taken', value: data.stats.examsTaken },
                { label: 'Saved', value: data.stats.bookmarks },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                  <p className="font-display text-lg font-bold leading-none">{stat.value}</p>
                  <p className="mt-1 text-[10.5px] font-medium uppercase tracking-wide text-white/70">{stat.label}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* ---- Onboarding prompt -------------------------------------------- */}
      {needsOnboarding ? (
        <Link to="/onboarding" className="flex items-center gap-3 rounded-xl2 border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <BadgeCheck className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-amber-900 dark:text-amber-200">Finish setting up your profile</span>
            <span className="block text-xs text-amber-800/80 dark:text-amber-300/80">Pick your class and target exam to get personalised content.</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
        </Link>
      ) : null}

      {/* ---- Continue learning -------------------------------------------- */}
      {data.continueLearning.length ? (
        <section>
          <div className="section-title">
            <h2>Continue learning</h2>
            <Link to="/lectures" className="link-quiet">All lectures</Link>
          </div>
          <div className="scroll-x no-scrollbar">
            {data.continueLearning.map((item) => (
              <Link
                key={item.lectureId}
                to={`/lectures/${item.lectureId}`}
                className="card w-[248px] shrink-0 overflow-hidden transition hover:shadow-card-hover"
              >
                <div className="relative">
                  <Thumb src={item.thumbnailUrl} alt={item.title} fallbackIcon={<PlayCircle className="h-7 w-7" aria-hidden />} />
                  <span className="absolute bottom-2 right-2 rounded bg-slate-900/85 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">
                    {formatDurationLabel(item.durationSeconds) || 'Resume'}
                  </span>
                </div>
                <div className="p-3">
                  <p className="line-clamp-2-safe text-[13px] font-semibold leading-snug">{item.title}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <ProgressBar value={item.percent} className="flex-1" />
                    <span className="text-[10.5px] font-semibold text-slate-500">{Math.round(item.percent)}%</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Quick picks by class ----------------------------------------- */}
      {data.classes.length ? (
        <section>
          <div className="section-title">
            <h2>Choose your class</h2>
            <Link to="/courses" className="link-quiet">Browse all</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.classes.slice(0, 4).map((cls) => (
              <Link
                key={cls.id}
                to={`/courses?classId=${cls.id}`}
                className="group flex items-center gap-3 rounded-xl2 border border-slate-200 bg-white p-3.5 transition hover:border-brand-300 hover:shadow-card dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                  <GraduationCap className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{cls.name}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">View courses</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Exam goals --------------------------------------------------- */}
      {data.examTypes.length ? (
        <section>
          <div className="section-title">
            <h2>Prepare for</h2>
            <Link to="/courses" className="link-quiet">All exams</Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {data.examTypes.map((exam) => (
              <Link
                key={exam.id}
                to={`/courses?examTypeId=${exam.id}`}
                className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                {exam.shortName ?? exam.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Featured courses --------------------------------------------- */}
      {data.featuredCourses.length ? (
        <section>
          <div className="section-title">
            <h2>Recommended courses</h2>
            <Link to="/courses" className="link-quiet">See all</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.featuredCourses.map((course) => (
              <Link key={course.id} to={`/courses/${course.id}`} className="card card-hover flex gap-3 p-3">
                <div className="w-24 shrink-0">
                  <Thumb src={course.coverImageUrl} alt={course.name} aspect="square" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1">
                    {course.className ? <Badge tone="brand">{course.className}</Badge> : null}
                    {course.examTypeName ? <Badge tone="neutral">{course.examTypeName}</Badge> : null}
                  </div>
                  <p className="mt-1.5 line-clamp-2-safe text-[13.5px] font-semibold leading-snug">{course.name}</p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {course.lectureCount} lectures · {course.examCount} tests
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Latest lectures ---------------------------------------------- */}
      {data.latestLectures.length ? (
        <section>
          <div className="section-title">
            <h2>Latest lectures</h2>
            <Link to="/lectures" className="link-quiet">All</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.latestLectures.map((lecture) => (
              <LectureCardItem
                key={lecture.id}
                lecture={{
                  id: lecture.id,
                  title: lecture.title,
                  description: null,
                  youtubeVideoId: lecture.youtubeVideoId,
                  thumbnailUrl: lecture.thumbnailUrl,
                  channelName: null,
                  durationSeconds: lecture.durationSeconds,
                  lectureNumber: null,
                  isFree: false,
                  status: 'published',
                  seriesId: null,
                  courseId: null,
                  courseName: lecture.courseName,
                  viewCount: 0,
                  publishedAt: null,
                  createdAt: new Date().toISOString(),
                } as LectureCard}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Upcoming exams ------------------------------------------------ */}
      {data.upcomingExams.length ? (
        <section>
          <div className="section-title">
            <h2>Upcoming examinations</h2>
            <Link to="/tests" className="link-quiet">All tests</Link>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.upcomingExams.map((exam) => (
              <ExamCardItem key={exam.id} exam={exam} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Popular mock tests -------------------------------------------- */}
      {data.popularExams.length ? (
        <section>
          <div className="section-title">
            <h2>Popular mock tests</h2>
            <Link to="/tests?kind=full_mock" className="link-quiet">Full mocks</Link>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.popularExams.slice(0, 4).map((exam) => (
              <ExamCardItem key={exam.id} exam={exam} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Lecture series ------------------------------------------------ */}
      {data.latestSeries.length ? (
        <section>
          <div className="section-title">
            <h2>Lecture series</h2>
            <Link to="/lectures" className="link-quiet">Browse</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.latestSeries.map((series) => (
              <Link key={series.id} to={`/series/${series.id}`} className="card card-hover overflow-hidden">
                <Thumb src={series.thumbnailUrl} alt={series.title} aspect="wide" fallbackIcon={<BookOpen className="h-7 w-7" aria-hidden />} />
                <div className="p-3">
                  <p className="line-clamp-2-safe text-[13.5px] font-semibold leading-snug">{series.title}</p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {series.lectureCount} lectures · {Math.round(series.totalMinutes)} min
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Announcements ------------------------------------------------- */}
      {topAnnouncement ? (
        <section>
          <div className="section-title">
            <h2>Announcements</h2>
            <Link to="/announcements" className="link-quiet">View all</Link>
          </div>
          <div className="space-y-2.5">
            {data.announcements.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                    <Sparkles className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[13.5px] font-semibold">{item.title}</p>
                      {item.isPinned ? <Badge tone="warning">Pinned</Badge> : null}
                      {item.priority === 'urgent' ? <Badge tone="danger">Urgent</Badge> : null}
                    </div>
                    <p className="mt-1 line-clamp-2-safe text-[12.5px] text-slate-600 dark:text-slate-400">{item.body}</p>
                    <p className="mt-1.5 text-[10.5px] uppercase tracking-wide text-slate-400">
                      {formatRelative(item.publishAt ?? item.createdAt)}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Empty platform ------------------------------------------------- */}
      {!data.featuredCourses.length && !data.latestLectures.length && !data.popularExams.length ? (
        <EmptyState
          title="Content is being prepared"
          description="Your institute is still publishing courses, lectures and tests. Check back soon — or ask your teacher to sync the Google Sheets content source."
          icon={<BookOpen className="h-6 w-6" aria-hidden />}
        />
      ) : null}

      {/* ---- Trust footer --------------------------------------------------- */}
      <section className="rounded-xl2 border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: GraduationCap, title: 'Board aligned', text: 'NCERT-mapped Class 11 and Class 12 content.' },
            { icon: Target, title: 'Exam focused', text: 'JEE and NEET style questions with negative marking.' },
            { icon: TrendingUp, title: 'Track progress', text: 'Chapter-wise analysis after every test.' },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-2.5">
              <item.icon className="mt-0.5 h-4.5 w-4.5 text-brand-600 dark:text-brand-400" aria-hidden />
              <div>
                <p className="text-[13px] font-semibold">{item.title}</p>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
