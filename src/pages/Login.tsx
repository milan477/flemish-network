import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { staffUser, loading, authError, clearAuthError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const redirect = searchParams.get('redirect') || '/';

  useEffect(() => {
    if (!loading && staffUser) {
      navigate(redirect, { replace: true });
    }
  }, [loading, navigate, redirect, staffUser]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return;

    setSending(true);
    setFormError(null);
    setMessage(null);
    clearAuthError();

    const { data: canRequest, error: precheckError } = await supabase.rpc(
      'can_request_staff_login',
      {
        p_email: normalizedEmail,
      }
    );

    if (precheckError) {
      setFormError(precheckError.message);
      setSending(false);
      return;
    }

    if (!canRequest) {
      setFormError(
        'This email address is not approved for the Flemish Network workspace.'
      );
      setSending(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      setFormError(error.message);
      setSending(false);
      return;
    }
    setSending(false);
  };

  const handleResetPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setFormError('Enter your email address before requesting a reset.');
      return;
    }

    setResetting(true);
    setFormError(null);
    setMessage(null);
    clearAuthError();

    const { data: canRequest, error: precheckError } = await supabase.rpc(
      'can_request_staff_login',
      {
        p_email: normalizedEmail,
      }
    );

    if (precheckError) {
      setFormError(precheckError.message);
      setResetting(false);
      return;
    }

    if (!canRequest) {
      setFormError(
        'This email address is not approved for the Flemish Network workspace.'
      );
      setResetting(false);
      return;
    }

    const callbackUrl = new URL('/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('setPassword', '1');
    if (redirect) {
      callbackUrl.searchParams.set('redirect', redirect);
    }

    const { error } = await supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      {
        redirectTo: callbackUrl.toString(),
      }
    );

    if (error) {
      setFormError(error.message);
      setResetting(false);
      return;
    }

    setMessage(`Password reset email sent to ${normalizedEmail}.`);
    setResetting(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-100">
            <ShieldCheck className="h-6 w-6 text-yellow-700" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Staff Sign In
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Access is limited to approved Flemish Network staff accounts.
          </p>
        </div>

        {(authError || formError) && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {authError || formError}
          </div>
        )}

        {message && (
          <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              Email
            </span>
            <div className="flex items-center rounded-xl border border-gray-200 bg-white px-3">
              <Mail className="h-4 w-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@organization.org"
                className="w-full rounded-xl px-3 py-3 text-sm text-gray-900 outline-none"
                autoComplete="email"
                autoFocus
                required
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              Password
            </span>
            <div className="flex items-center rounded-xl border border-gray-200 bg-white px-3">
              <KeyRound className="h-4 w-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl px-3 py-3 text-sm text-gray-900 outline-none"
                autoComplete="current-password"
                required
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={sending || resetting || !email.trim() || !password}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-yellow-400 px-4 py-3 text-sm font-medium text-gray-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            <span>{sending ? 'Signing in...' : 'Sign In'}</span>
          </button>

          <button
            type="button"
            onClick={handleResetPassword}
            disabled={sending || resetting || !email.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resetting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            <span>{resetting ? 'Sending reset...' : 'Reset Password'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
