import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, LogIn, Mail, ShieldCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { firebaseAuthMessage } from '@/lib/firebaseErrors';
import { appConfig } from '@/config';

export default function LoginPage() {
  useDocumentTitle('Sign in');
  const { signIn, status, user, devMode, devSignIn, error: authError } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devEmail, setDevEmail] = useState('');
  const [devLoading, setDevLoading] = useState(false);

  // Already signed in → go where the user was headed.
  useEffect(() => {
    if (status === 'authenticated' && user) {
      navigate(next.startsWith('/') ? next : '/', { replace: true });
    }
  }, [status, user, navigate, next]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      navigate(next.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      setError(firebaseAuthMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const devSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setDevLoading(true);
    try {
      await devSignIn(devEmail.trim());
      navigate(next.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dev sign-in failed.');
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to continue your preparation."
      footer={
        <>
          New here?{' '}
          <Link to={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-600 hover:underline">
            Create a free account
          </Link>
        </>
      }
    >
      {!devMode ? (
        <form onSubmit={submit} className="space-y-3.5" noValidate>
          {authError ? <Alert tone="error">{authError}</Alert> : null}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div>
            <label className="label" htmlFor="email">Email address</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input pl-9"
                placeholder="you@example.com"
              />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label className="label" htmlFor="password">Password</label>
              <Link to="/forgot-password" className="mb-1.5 text-[11.5px] font-semibold text-brand-600 hover:underline">Forgot?</Link>
            </div>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input pr-10"
                placeholder="Your password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </div>
          <Button type="submit" fullWidth loading={loading} icon={<LogIn className="h-4 w-4" aria-hidden />}>
            Sign in
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <Alert tone="info" title="Development sign-in">
            Firebase Admin credentials are not configured on this server, so verified email sign-in is disabled. Use the
            development login below — it is only available on non-production deployments with <code>DEV_AUTH_ENABLED</code>.
          </Alert>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <form onSubmit={devSubmit} className="space-y-3">
            <div>
              <label className="label" htmlFor="dev-email">Email</label>
              <input
                id="dev-email"
                type="email"
                required
                value={devEmail}
                onChange={(event) => setDevEmail(event.target.value)}
                placeholder={appConfig.superAdminEmail}
                className="input"
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Use <code>{appConfig.superAdminEmail}</code> for Super Admin access, or any new email to create a student.
              </p>
            </div>
            <Button type="submit" fullWidth loading={devLoading} icon={<ShieldCheck className="h-4 w-4" aria-hidden />}>
              Continue in development mode
            </Button>
          </form>
        </div>
      )}

      {!devMode ? (
        <>
          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">or</span>
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>
          <GoogleButton />
        </>
      ) : null}

      <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
        By continuing you agree that your activity on this platform may be logged for security and academic integrity.
      </p>
    </AuthShell>
  );
}
