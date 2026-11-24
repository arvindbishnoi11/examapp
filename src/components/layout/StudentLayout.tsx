import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, FileText, Home, LayoutGrid, Moon, Search, Sun, UserRound, Bell } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui';
import { SearchOverlay } from '@/components/student/SearchOverlay';
import { appConfig } from '@/config';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/courses', label: 'Courses', icon: LayoutGrid, end: false },
  { to: '/lectures', label: 'Lectures', icon: BookOpen, end: false },
  { to: '/tests', label: 'Tests', icon: FileText, end: false },
  { to: '/profile', label: 'Profile', icon: UserRound, end: false },
];

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label={`${appConfig.name} home`}>
      <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg shadow-sm" width={32} height={32} />
      {!compact ? <span className="font-display text-[17px] font-bold tracking-tight text-slate-900 dark:text-white">{appConfig.name}</span> : null}
    </Link>
  );
}

export function StudentLayout() {
  const { resolved, toggle } = useTheme();
  const { status, user } = useAuth();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);

  // Scroll to the top on route change (but keep exam pages in control).
  useEffect(() => {
    if (!location.pathname.startsWith('/tests/') || location.pathname === '/tests') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [location.pathname]);

  // Keyboard shortcut: "/" focuses search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 dark:bg-slate-950">
      {/* ---- Top bar ------------------------------------------------------- */}
      <header className="safe-top sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/85">
        <div className="container-app flex h-14 items-center gap-3">
          <Logo />

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-500 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
              aria-label="Search courses, lectures and tests"
            >
              <Search className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Search</span>
              <kbd className="ml-1 hidden rounded border border-slate-300 px-1 text-[10px] font-semibold text-slate-400 dark:border-slate-700 sm:inline">/</kbd>
            </button>

            <Link
              to="/notifications"
              className="relative grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="Notifications"
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden />
            </Link>

            <button
              type="button"
              onClick={toggle}
              className="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {resolved === 'dark' ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
            </button>

            {status === 'authenticated' && user ? (
              <Link to="/profile" className="ml-1 hidden items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 dark:border-slate-800 sm:flex">
                {user.photoUrl ? (
                  <img src={user.photoUrl} alt="" className="h-7 w-7 rounded-full object-cover" width={28} height={28} />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                    {(user.displayName ?? user.email).slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="max-w-[9rem] truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {user.profile?.fullName ?? user.displayName ?? 'Student'}
                </span>
              </Link>
            ) : status !== 'loading' ? (
              <Link to="/login" className="btn-primary ml-1 !rounded-full px-4 py-1.5 text-xs">
                Sign in
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {/* ---- Main ---------------------------------------------------------- */}
      <main className="flex-1 pb-24 md:pb-10">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>

      {/* ---- Footer (desktop) ---------------------------------------------- */}
      <footer className="hidden border-t border-slate-200 py-6 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400 md:block">
        <div className="container-app flex flex-wrap items-center justify-between gap-3">
          <p>
            © {new Date().getFullYear()} {appConfig.name}. Built for Indian students preparing for Class 11, Class 12, JEE and NEET.
          </p>
          <nav className="flex gap-4" aria-label="Footer">
            <Link to="/papers" className="hover:text-brand-600">Papers</Link>
            <Link to="/announcements" className="hover:text-brand-600">Announcements</Link>
            <Link to="/profile" className="hover:text-brand-600">Profile</Link>
            <a href={appConfig.sheetUrl} target="_blank" rel="noreferrer noopener" className="hover:text-brand-600">Content source</a>
          </nav>
        </div>
      </footer>

      {/* ---- Bottom navigation (mobile) ----------------------------------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 md:hidden"
        aria-label="Primary"
      >
        <ul className="safe-bottom mx-auto flex max-w-md items-stretch justify-between px-2 pt-1">
          {NAV.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[10.5px] font-semibold transition ${
                    isActive ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`grid h-8 w-12 place-items-center rounded-full transition ${isActive ? 'bg-brand-50 dark:bg-brand-950/70' : ''}`}>
                      <item.icon className="h-[19px] w-[19px]" aria-hidden />
                    </span>
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
