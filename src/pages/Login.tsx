import { useEffect, useState } from 'react';
import { Mail, Loader2, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { staffUser, loading, authError, clearAuthError } = useAuth();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
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
    if (!normalizedEmail) return;

    setSending(true);
    setFormError(null);
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

    const callbackUrl = new URL('/auth/callback', window.location.origin);
    if (redirect) {
      callbackUrl.searchParams.set('redirect', redirect);
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: callbackUrl.toString(),
      },
    });

    if (error) {
      setFormError(error.message);
      setSending(false);
      return;
    }

    setSentTo(normalizedEmail);
    setSending(false);
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

        {sentTo ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-800">
            Magic link sent to <span className="font-medium">{sentTo}</span>.
            Open the email and follow the link to finish signing in.
          </div>
        ) : (
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

            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-yellow-400 px-4 py-3 text-sm font-medium text-gray-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              <span>{sending ? 'Sending magic link...' : 'Send Magic Link'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
