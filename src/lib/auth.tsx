import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { supabase, type AppRole, type StaffUser } from './supabase';

interface AuthContextValue {
  session: Session | null;
  staffUser: StaffUser | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  refreshStaffUser: () => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  canEdit: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ROLE_RANK: Record<AppRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

function FullScreenSpinner({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-yellow-500" />
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
}

function normalizeAuthError(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return 'Authentication failed.';
  if (trimmed.includes('not approved')) {
    return 'This email address is not approved for the Flemish Network workspace.';
  }
  if (trimmed.includes('disabled')) {
    return 'This account has been disabled.';
  }
  return trimmed;
}

const STAFF_CACHE_KEY = 'fln_staff_v1';

function readCache(): StaffUser | null {
  try {
    const raw = localStorage.getItem(STAFF_CACHE_KEY);
    return raw ? (JSON.parse(raw) as StaffUser) : null;
  } catch {
    return null;
  }
}

function writeCache(user: StaffUser | null) {
  if (user) localStorage.setItem(STAFF_CACHE_KEY, JSON.stringify(user));
  else localStorage.removeItem(STAFF_CACHE_KEY);
}

async function loadStaffUser(session: Session): Promise<StaffUser> {
  // RPC (validates approval/status + updates last_sign_in_at) runs in parallel with profile fetch
  const [activateResult, profileResult] = await Promise.all([
    supabase.rpc('activate_staff_user_session'),
    supabase
      .from('staff_users')
      .select('id, user_id, email, full_name, role, status, password_reset_required, last_sign_in_at, created_at, updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle(),
  ]);

  if (activateResult.error) throw new Error(normalizeAuthError(activateResult.error.message));
  if (profileResult.error) throw new Error(normalizeAuthError(profileResult.error.message));
  if (!profileResult.data) throw new Error('Unable to load your staff profile.');

  return profileResult.data as StaffUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const staffUserRef = useRef<StaffUser | null>(null);

  const updateSession = useCallback((nextSession: Session | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
  }, []);

  const updateStaffUser = useCallback((nextStaffUser: StaffUser | null) => {
    staffUserRef.current = nextStaffUser;
    setStaffUser(nextStaffUser);
  }, []);

  const hydrateSession = useCallback(async (
    nextSession: Session | null,
    options: { showLoading?: boolean } = {}
  ) => {
    updateSession(nextSession);

    if (!nextSession) {
      updateStaffUser(null);
      writeCache(null);
      setLoading(false);
      return;
    }

    // Returning user: serve cached staff profile immediately, revalidate in background
    const cached = readCache();
    if (cached?.user_id === nextSession.user.id) {
      updateStaffUser(cached);
      setLoading(false);
      void loadStaffUser(nextSession)
        .then(fresh => {
          updateStaffUser(fresh);
          writeCache(fresh);
        })
        .catch(async err => {
          updateStaffUser(null);
          writeCache(null);
          setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
          await supabase.auth.signOut();
          updateSession(null);
        });
      return;
    }

    // First login or cache miss: block until loaded
    if (options.showLoading ?? true) setLoading(true);
    try {
      const fresh = await loadStaffUser(nextSession);
      updateStaffUser(fresh);
      writeCache(fresh);
      setAuthError(null);
    } catch (error) {
      updateStaffUser(null);
      writeCache(null);
      setAuthError(
        error instanceof Error ? error.message : 'Authentication failed.'
      );
      await supabase.auth.signOut();
      updateSession(null);
    } finally {
      setLoading(false);
    }
  }, [updateSession, updateStaffUser]);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      void hydrateSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      queueMicrotask(() => {
        if (!active) return;
        const currentSession = sessionRef.current;
        const currentStaffUser = staffUserRef.current;
        const sameStaffSession =
          Boolean(currentStaffUser) &&
          Boolean(nextSession) &&
          currentSession?.user.id === nextSession?.user.id;

        void hydrateSession(nextSession, { showLoading: !sameStaffSession });
      });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [hydrateSession]);

  const refreshStaffUser = useCallback(async () => {
    writeCache(null); // force fresh load, don't serve stale cache
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();
    await hydrateSession(currentSession);
  }, [hydrateSession]);

  const signOut = useCallback(async () => {
    setAuthError(null);
    await supabase.auth.signOut();
    updateStaffUser(null);
    updateSession(null);
  }, [updateSession, updateStaffUser]);

  const hasRole = useCallback(
    (role: AppRole) => {
      if (!staffUser) return false;
      return ROLE_RANK[staffUser.role] >= ROLE_RANK[role];
    },
    [staffUser]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      staffUser,
      loading,
      authError,
      clearAuthError: () => setAuthError(null),
      refreshStaffUser,
      signOut,
      hasRole,
      canEdit: hasRole('editor'),
      isAdmin: hasRole('admin'),
    }),
    [session, staffUser, loading, authError, refreshStaffUser, signOut, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

export function RequireAuth() {
  const { session, staffUser, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <FullScreenSpinner label="Checking your staff session..." />;
  }

  if (!session || !staffUser) {
    const redirect = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(redirect)}`}
        replace
      />
    );
  }

  if (
    staffUser.password_reset_required &&
    location.pathname !== '/account'
  ) {
    const redirect = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/account?setPassword=1&redirect=${encodeURIComponent(redirect)}`}
        replace
      />
    );
  }

  return <Outlet />;
}

export function RequireRole({ role }: { role: AppRole }) {
  const { loading, hasRole } = useAuth();

  if (loading) {
    return <FullScreenSpinner label="Checking your access level..." />;
  }

  if (!hasRole(role)) {
    return (
      <div className="min-h-[calc(100vh-64px)] bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <ShieldAlert className="h-6 w-6 text-red-500" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Access denied</h1>
          <p className="mt-2 text-sm text-gray-500">
            Your account does not have permission to use this section.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-lg bg-yellow-400 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-yellow-500"
          >
            Return to Network
          </Link>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
