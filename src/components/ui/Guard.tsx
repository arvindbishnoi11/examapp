import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui';
import { Link } from 'react-router-dom';

/** Wraps student routes that need a signed-in user. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="container-app py-16">
        <Spinner label="Checking your session…" />
      </div>
    );
  }
  if (status !== 'authenticated') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <>{children}</>;
}

/** Wraps admin routes: requires staff role AND, optionally, a permission. */
export function RequirePermission({ permission, children }: { permission?: string; children: ReactNode }) {
  const { status, user, hasPermission } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Verifying administrator access…" />
      </div>
    );
  }
  if (status !== 'authenticated' || !user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (!user.isStaff) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="card max-w-md p-6 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">Administrator access required</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            You are signed in as a student. If you were recently promoted, sign out and back in, or ask the Super Admin to
            grant your role.
          </p>
          <Link to="/" className="btn-primary mt-4 inline-flex">
            Back to student app
          </Link>
        </div>
      </div>
    );
  }
  if (permission && !hasPermission(permission)) {
    return (
      <div className="container-app py-16">
        <div className="card mx-auto max-w-md p-6 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">Missing permission</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Your role does not include <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">{permission}</code>.
            Ask the Super Admin to grant it.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
