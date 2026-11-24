import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MailCheck, Send } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { firebaseAuthMessage } from '@/lib/firebaseErrors';

export default function ForgotPasswordPage() {
  useDocumentTitle('Reset password');
  const { resetPassword, devMode } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err) {
      const message = firebaseAuthMessage(err);
      // Do not leak whether the account exists.
      if (/user-not-found|no account/i.test(message)) setSent(true);
      else setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a secure link to choose a new password."
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to sign in
        </Link>
      }
    >
      {devMode ? (
        <Alert tone="warning" title="Not available in development mode">
          Firebase Authentication is not configured on this server, so password reset emails cannot be sent. Sign in with
          the development login instead.
        </Alert>
      ) : sent ? (
        <div className="space-y-3 text-center">
          <MailCheck className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
          <p className="text-sm text-slate-600 dark:text-slate-400">
            If an account exists for <strong>{email}</strong>, a password reset email is on its way. Check your spam folder
            too.
          </p>
          <Button variant="secondary" fullWidth onClick={() => setSent(false)}>Send again</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3.5" noValidate>
          {error ? <Alert tone="error">{error}</Alert> : null}
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
          <Button type="submit" fullWidth loading={loading} icon={<Send className="h-4 w-4" aria-hidden />}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
