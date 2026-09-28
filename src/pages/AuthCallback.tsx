import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { buildPasswordSetupPath } from '../lib/appRouting';
import { describeSignInLinkError } from '../lib/authMessages';
import LoadingGlobe from '../components/LoadingGlobe';

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { staffUser, loading } = useAuth();
  const redirect = searchParams.get('redirect') || '/';
  const shouldSetPassword = searchParams.get('setPassword') === '1';
  // Captured once: the link error only exists in the URL Supabase redirected to.
  const [linkError] = useState(() =>
    describeSignInLinkError(location.hash, location.search)
  );

  useEffect(() => {
    if (loading) return;

    if (staffUser) {
      if (shouldSetPassword || staffUser.password_reset_required) {
        navigate(buildPasswordSetupPath(redirect), { replace: true });
        return;
      }

      navigate(redirect, { replace: true });
      return;
    }

    navigate(`/login?redirect=${encodeURIComponent(redirect)}`, {
      replace: true,
      state: linkError ? { authMessage: linkError } : undefined,
    });
  }, [linkError, loading, navigate, redirect, shouldSetPassword, staffUser]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <LoadingGlobe label="Completing sign in" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            Completing sign in
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Verifying your staff access and loading your session.
          </p>
        </div>
      </div>
    </div>
  );
}
