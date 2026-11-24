import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { firebaseAuthMessage } from '@/lib/firebaseErrors';

export default function RegisterPage() {
  useDocumentTitle('Create account');
  const { signUp, devMode, devSignIn, status } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/onboarding';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') {
    navigate(next, { replace: true });
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      if (devMode) {
        await devSignIn(email.trim(), fullName.trim());
      } else {
        const result = await signUp(email, password, fullName.trim());
        if (result.needsVerification) {
          navigate(`/verify-email?new=1&next=${encodeURIComponent(next)}`, { replace: true });
          return;
        }
      }
      navigate(next, { replace: true });
    } catch (err) {
      setError(firebaseAuthMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free to join. Takes less than a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3.5" noValidate>
        {devMode ? (
          <Alert tone="info" title="Development mode">
            Accounts created here exist only in the local D1 database. Email verification is skipped.
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div>
          <label className="label" htmlFor="name">Full name</label>
          <input
            id="name"
            autoComplete="name"
            required
            maxLength={80}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="input"
            placeholder="e.g. Ananya Sharma"
          />
        </div>
        <div>
          <label className="label" htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="input"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input pr-10"
              placeholder="At least 6 characters"
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
        <div>
          <label className="label" htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="input"
            placeholder="Re-enter your password"
          />
        </div>

        <Button type="submit" fullWidth loading={loading} icon={<UserPlus className="h-4 w-4" aria-hidden />}>
          Create account
        </Button>
      </form>

      {!devMode ? (
        <>
          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">or</span>
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>
          <GoogleButton label="Sign up with Google" />
        </>
      ) : null}
    </AuthShell>
  );
}
