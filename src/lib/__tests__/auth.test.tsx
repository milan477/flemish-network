import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, RequireAuth, SESSION_ENDED_MESSAGE, useAuth } from '../auth';
import { notifyEdgeAuthFailure } from '../sessionEvents';

const { supabaseMock, authStateCallbacks } = vi.hoisted(() => {
  const authStateCallbacks: Array<(event: string, session: unknown) => void> = [];
  const supabaseMock = {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn((callback) => {
        authStateCallbacks.push(callback);
        return {
          data: {
            subscription: {
              unsubscribe: vi.fn(),
            },
          },
        };
      }),
      signOut: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  };

  return { supabaseMock, authStateCallbacks };
});

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
}));

const session = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: 'auth-user-1',
    email: 'staff@example.org',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  },
};

const refreshedSession = {
  ...session,
  access_token: 'new-access-token',
};

const staffUser = {
  id: 'staff-user-1',
  user_id: 'auth-user-1',
  email: 'staff@example.org',
  full_name: 'Staff User',
  role: 'editor',
  status: 'active',
  password_reset_required: false,
  last_sign_in_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function ProtectedContent() {
  const { signOut } = useAuth();
  return (
    <div>
      Protected content
      <button type="button" onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}

function LoginPage() {
  const { authError } = useAuth();
  return <div>Login page {authError}</div>;
}

function renderProtectedRoute() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<ProtectedContent />} />
          </Route>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

function mockSignedInStaff() {
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session } });
  supabaseMock.rpc.mockResolvedValue({ error: null });
  supabaseMock.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: staffUser, error: null }),
  });
}

// supabase-js clears a revoked session and emits SIGNED_OUT from getUser().
function mockRevokedSession() {
  supabaseMock.auth.getUser.mockImplementation(async () => {
    authStateCallbacks.forEach((callback) => callback('SIGNED_OUT', null));
    return { data: { user: null }, error: new AuthSessionMissingError() };
  });
}

beforeEach(() => {
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: session.user }, error: null });
  supabaseMock.auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  authStateCallbacks.length = 0;
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  it('keeps protected content mounted during same-user auth refreshes', async () => {
    const refreshActivation = deferred<{ error: null }>();

    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session },
    });
    supabaseMock.rpc
      .mockResolvedValueOnce({ error: null })
      .mockReturnValueOnce(refreshActivation.promise);
    supabaseMock.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: staffUser, error: null }),
    });

    renderProtectedRoute();

    expect(screen.getByText('Checking your staff session...')).toBeTruthy();
    await screen.findByText('Protected content');

    authStateCallbacks[0]('TOKEN_REFRESHED', refreshedSession);

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByText('Protected content')).toBeTruthy();
    expect(screen.queryByText('Checking your staff session...')).toBeNull();

    refreshActivation.resolve({ error: null });

    await waitFor(() => {
      expect(screen.getByText('Protected content')).toBeTruthy();
    });
  });

  it('routes to login with a session-ended message when Supabase Auth reports the session is gone', async () => {
    mockSignedInStaff();
    mockRevokedSession();

    renderProtectedRoute();

    await screen.findByText(`Login page ${SESSION_ENDED_MESSAGE}`);
  });

  it('re-checks the session with Supabase Auth when an edge function returns 401', async () => {
    mockSignedInStaff();

    renderProtectedRoute();
    await screen.findByText('Protected content');
    await waitFor(() => expect(supabaseMock.auth.getUser).toHaveBeenCalledTimes(1));

    mockRevokedSession();
    act(() => notifyEdgeAuthFailure());

    await screen.findByText(`Login page ${SESSION_ENDED_MESSAGE}`);
    expect(supabaseMock.auth.getUser).toHaveBeenCalledTimes(2);
  });

  it('signs out only the current browser session', async () => {
    mockSignedInStaff();

    renderProtectedRoute();
    fireEvent.click(await screen.findByText('Sign out'));

    await waitFor(() => {
      expect(supabaseMock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });
  });
});
