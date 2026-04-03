import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { staffUser, loading, authError } = useAuth();
  const redirect = searchParams.get('redirect') || '/';

  useEffect(() => {
    if (loading) return;

    if (staffUser) {
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
  }, [authError, loading, navigate, redirect, staffUser]);

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
