import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { staffUser, loading, authError } = useAuth();
  const redirect = searchParams.get('redirect') || '/';
  const shouldSetPassword = searchParams.get('setPassword') === '1';

  useEffect(() => {
    if (loading) return;

    if (staffUser) {
      if (shouldSetPassword || staffUser.password_reset_required) {
        navigate(
          `/account?setPassword=1&redirect=${encodeURIComponent(redirect)}`,
          { replace: true }
        );
        return;
      }

      navigate(redirect, { replace: true });
      return;
    }

    if (authError) {
      navigate(`/login?redirect=${encodeURIComponent(redirect)}`, {
        replace: true,
      });
      return;
    }

    navigate(`/login?redirect=${encodeURIComponent(redirect)}`, {
      replace: true,
    });
  }, [authError, loading, navigate, redirect, shouldSetPassword, staffUser]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
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
