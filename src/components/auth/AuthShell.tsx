import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import type { ReactNode } from 'react';
import { appConfig } from '@/config';

/** Split layout used by every authentication screen. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel (desktop only) */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-violet-900 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-sky-400/20 blur-3xl" aria-hidden />
        <Link to="/" className="relative flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 backdrop-blur">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          <span className="font-display text-lg font-bold">{appConfig.name}</span>
        </Link>
        <div className="relative max-w-md">
          <h2 className="font-display text-3xl font-bold leading-tight">Clear your concepts. Build exam confidence.</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-white/75">
            Chapter-wise lectures, full-length mock examinations with real exam marking, previous-year papers with
            solutions, and analytics that show exactly which chapters cost you marks.
          </p>
          <ul className="mt-6 space-y-2.5 text-[13.5px] text-white/85">
            {[
              'JEE Main, JEE Advanced, NEET and Board preparation',
              'Timed tests with negative marking and rank',
              'Works offline on budget Android phones',
              'Progress saved across devices',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white/70" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[11.5px] text-white/50">Built for Indian students — Class 11, Class 12, JEE and NEET.</p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 lg:hidden">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
              <GraduationCap className="h-4 w-4" aria-hidden />
            </span>
            <span className="font-display text-[15px] font-bold">{appConfig.name}</span>
          </Link>
          <Link to="/" className="text-[12.5px] font-semibold text-brand-600">Skip</Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-6">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-2xl font-bold">{title}</h1>
            {subtitle ? <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
            <div className="mt-5">{children}</div>
            {footer ? <div className="mt-5 text-center text-[13px] text-slate-500 dark:text-slate-400">{footer}</div> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
