import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  ChevronDown,
  ClipboardList,
  FileQuestion,
  FileText,
  GraduationCap,
  Home,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  ScrollText,
  Settings,
  ShieldCheck,
  Sun,
  Table2,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { Spinner } from '@/components/ui';
import { appConfig } from '@/config';

type NavItem = { to: string; label: string; icon: typeof Home; permission?: string; end?: boolean };

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view', end: true },
      { to: '/admin/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics.view' },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/admin/students', label: 'Students', icon: Users, permission: 'students.view' },
      { to: '/admin/admins', label: 'Admin Management', icon: ShieldCheck, permission: 'admins.view' },
    ],
  },
  {
    title: 'Content',
    items: [
      { to: '/admin/courses', label: 'Courses', icon: BookOpen, permission: 'courses.view' },
      { to: '/admin/taxonomy', label: 'Classes, Subjects & Chapters', icon: Layers, permission: 'courses.view' },
      { to: '/admin/lectures', label: 'Lecture Series', icon: Video, permission: 'lectures.view' },
      { to: '/admin/youtube', label: 'YouTube Manager', icon: ClipboardList, permission: 'youtube.manage' },
    ],
  },
  {
    title: 'Examinations',
    items: [
      { to: '/admin/test-series', label: 'Test Series', icon: ListChecks, permission: 'exams.view' },
      { to: '/admin/exams', label: 'Examination Manager', icon: FileText, permission: 'exams.view' },
      { to: '/admin/questions', label: 'Question Bank', icon: FileQuestion, permission: 'questions.view' },
      { to: '/admin/results', label: 'Results', icon: GraduationCap, permission: 'results.view' },
      { to: '/admin/papers', label: 'Test Paper Manager', icon: FileText, permission: 'test_papers.manage' },
    ],
  },
  {
    title: 'Communication',
    items: [
      { to: '/admin/notifications', label: 'Notifications', icon: Bell, permission: 'notifications.manage' },
      { to: '/admin/announcements', label: 'Announcements', icon: Megaphone, permission: 'announcements.manage' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { to: '/admin/sheets', label: 'Google Sheets Manager', icon: Table2, permission: 'sheets.view' },
      { to: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText, permission: 'audit.view' },
      { to: '/admin/settings', label: 'Platform Settings', icon: Settings, permission: 'settings.view' },
    ],
  },
];

export default function AdminLayout() {
  const { user, isSuperAdmin, hasPermission, signOut } = useAuth();
  const { resolved, toggle } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  useEffect(() => {
    setOpen(false);
    setUserMenu(false);
  }, [location.pathname]);

  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || hasPermission(item.permission)),
  })).filter((group) => group.items.length);

  const currentLabel =
    visibleGroups.flatMap((g) => g.items).find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))?.label ??
    'Admin';

  return (
    <div className="min-h-dvh bg-slate-100 dark:bg-slate-950">
      {/* ---- Sidebar ---------------------------------------------------- */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-900 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Admin navigation"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-100 px-4 dark:border-slate-800">
          <Link to="/admin" className="flex items-center gap-2">
            <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-md" width={28} height={28} />
            <span className="font-display text-[15px] font-bold">{appConfig.name}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">Admin</span>
          </Link>
          <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 lg:hidden" aria-label="Close navigation">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {visibleGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group.title}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition ${
                          isActive
                            ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                            : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/70'
                        }`
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-slate-100 p-2 dark:border-slate-800">
          <Link to="/" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/70">
            <Home className="h-4 w-4" aria-hidden /> Student app
          </Link>
          <p className="px-2.5 pb-1 pt-2 text-[10px] text-slate-400">
            {isSuperAdmin ? 'Super Admin' : 'Administrator'} · v{appConfig.env}
          </p>
        </div>
      </aside>

      {open ? <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}

      {/* ---- Main ------------------------------------------------------- */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-5">
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-500 lg:hidden" aria-label="Open navigation">
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{currentLabel}</h1>

          <button
            type="button"
            onClick={toggle}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
          >
            {resolved === 'dark' ? <Sun className="h-4.5 w-4.5" aria-hidden /> : <Moon className="h-4.5 w-4.5" aria-hidden />}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setUserMenu((v) => !v)}
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-haspopup="menu"
              aria-expanded={userMenu}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                {(user?.displayName ?? user?.email ?? 'A').slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-[140px] truncate text-[12px] font-medium sm:block">{user?.displayName ?? user?.email}</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            </button>
            {userMenu ? (
              <div role="menu" className="absolute right-0 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-float dark:border-slate-700 dark:bg-slate-900">
                <p className="truncate px-2.5 py-1.5 text-[11px] text-slate-500">{user?.email}</p>
                {isSuperAdmin ? <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-600">Super Admin</p> : null}
                <Link role="menuitem" to="/profile" className="block rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-slate-100 dark:hover:bg-slate-800">My profile</Link>
                <button
                  role="menuitem"
                  type="button"
                  onClick={async () => { await signOut(); window.location.href = '/login'; }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="p-3 sm:p-5">
          <Suspense fallback={<div className="grid place-items-center py-20"><Spinner /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
