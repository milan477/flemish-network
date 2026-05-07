import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, RequireAuth } from '../auth';

const { supabaseMock, authStateCallbacks } = vi.hoisted(() => {
  const authStateCallbacks: Array<(event: string, session: unknown) => void> = [];
  const supabaseMock = {
    auth: {
      getSession: vi.fn(),
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
  avatar_url: null,
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

function renderProtectedRoute() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<div>Protected content</div>} />
          </Route>
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

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
});
