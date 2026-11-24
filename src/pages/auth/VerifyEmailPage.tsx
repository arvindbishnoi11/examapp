import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { firebaseAuthMessage } from '@/lib/firebaseErrors';

export default function VerifyEmailPage() {
  useDocumentTitle('Verify email');
  const { firebaseUser, resendVerification, refresh, status, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/onboarding';
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload the Firebase user so `emailVerified` reflects a click in another tab.
  useEffect(() => {
    if (status === 'authenticated' && user?.emailVerified) {
      navigate(next, { replace: true });
    }
  }, [status, user, navigate, next]);

  const resend = async () => {
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      await resendVerification();
      setMessage('Verification email sent. Check your inbox (and spam folder).');
    } catch (err) {
      setError(firebaseAuthMessage(err));
    } finally {
      setSending(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      await firebaseUser?.reload();
      await refresh();
      if (firebaseUser?.emailVerified || user?.emailVerified) {
        navigate(next, { replace: true });
      } else {
        setMessage('Not verified yet. Open the link in your email, then press the button again.');
      }
    } catch (err) {
      setError(firebaseAuthMessage(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthShell
      title="Verify your email"
      subtitle="One last step before you start preparing."
      footer={
        <button type="button" onClick={async () => { await signOut(); navigate('/login'); }} className="font-semibold text-brand-600 hover:underline">
          Use a different account
        </button>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl2 border border-brand-100 bg-brand-50/60 p-4 text-center dark:border-brand-900 dark:bg-brand-950/40">
          <MailCheck className="mx-auto h-10 w-10 text-brand-600 dark:text-brand-400" aria-hidden />
          <p className="mt-2 text-[13.5px] text-slate-700 dark:text-slate-300">
            We sent a verification link to{' '}
            <strong className="break-all">{firebaseUser?.email ?? user?.email ?? 'your email'}</strong>.
          </p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            Open it on this device or any other, then come back and confirm below.
          </p>
        </div>

        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Button fullWidth loading={checking} onClick={check} icon={<ShieldCheck className="h-4 w-4" aria-hidden />}>
          I have verified my email
        </Button>
        <Button fullWidth variant="secondary" loading={sending} onClick={resend} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
          Resend verification email
        </Button>
        <p className="text-center text-[11.5px] text-slate-400">
          You can still browse lectures and papers while unverified. Attempting tests needs a verified email on production.
        </p>
        <div className="text-center">
          <Link to="/" className="text-[12px] font-semibold text-slate-500 hover:text-brand-600">Skip for now</Link>
        </div>
      </div>
    </AuthShell>
  );
}
