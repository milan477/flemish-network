import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthApiError, AuthSessionMissingError } from '@supabase/supabase-js';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { AuthProvider, RequireAuth, SESSION_ENDED_MESSAGE, useAuth } from '../auth';
import { EMAIL_RATE_LIMIT_MESSAGE, USED_SIGN_IN_LINK_MESSAGE } from '../authMessages';
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
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  };

  return { supabaseMock, authStateCallbacks };
});

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
}));

vi.mock('../../pages/Collections', () => ({
  default: () => <div>Collections page</div>,
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

function mockSignedInStaff(profile = staffUser) {
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session } });
  supabaseMock.rpc.mockResolvedValue({ error: null });
  supabaseMock.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null }),
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <App />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>
  );
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

describe('password setup routing', () => {
  const PASSWORD_SETUP_PROMPT = 'Set a strong password before continuing to the workspace.';

  beforeEach(() => {
    localStorage.clear();
    mockSignedInStaff({ ...staffUser, password_reset_required: true });
  });

  it('lands an invite or recovery callback on the password form', async () => {
    renderApp('/auth/callback?setPassword=1&redirect=%2F');

    await screen.findByText(PASSWORD_SETUP_PROMPT);
    expect(screen.getByTestId('location').textContent).toBe(
      '/settings/account?setPassword=1&redirect=%2F'
    );

    // The password form leads the page and has focus, so it is never below the fold.
    const newPassword = screen.getByLabelText('New password');
    expect(document.activeElement).toBe(newPassword);
    expect(
      newPassword.compareDocumentPosition(screen.getByLabelText('Full name')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('sends a protected page to the password form and back afterwards', async () => {
    renderApp('/collections');

    await screen.findByText(PASSWORD_SETUP_PROMPT);
    expect(screen.getByTestId('location').textContent).toBe(
      '/settings/account?setPassword=1&redirect=%2Fcollections'
    );
  });

  it('saves the new password and continues to the original page', async () => {
    let passwordSet = false;
    const staffUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    supabaseMock.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({
        data: { ...staffUser, password_reset_required: !passwordSet },
        error: null,
      })),
      update: staffUpdate,
    });
    supabaseMock.auth.updateUser.mockImplementation(async () => {
      passwordSet = true;
      return { data: { user: session.user }, error: null };
    });

    renderApp('/collections');
    fireEvent.change(await screen.findByLabelText('New password'), {
      target: { value: 'Str0ng!Passw0rd' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Str0ng!Passw0rd' },
    });
    fireEvent.click(screen.getByText('Update Password'));

    await screen.findByText('Collections page');
    expect(screen.getByTestId('location').textContent).toBe('/collections');
    expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({ password: 'Str0ng!Passw0rd' });
    expect(staffUpdate).toHaveBeenCalledWith({ password_reset_required: false });
  });

  it('keeps legacy /account password links working', async () => {
    renderApp('/account?setPassword=1&redirect=%2F');

    await screen.findByText(PASSWORD_SETUP_PROMPT);
    expect(screen.getByTestId('location').textContent).toBe(
      '/settings/account?setPassword=1&redirect=%2F'
    );
  });
});

describe('sign-in email problems', () => {
  beforeEach(() => {
    localStorage.clear();
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
  });

  it('explains an already used or expired email link on the login page', async () => {
    renderApp(
      '/auth/callback?setPassword=1&redirect=%2F#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    );

    await screen.findByText(USED_SIGN_IN_LINK_MESSAGE);
    expect(screen.getByTestId('location').textContent).toBe('/login?redirect=%2F');
  });

  it('explains the hourly email limit when a reset email cannot be sent', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: true, error: null });
    supabaseMock.auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'),
    });

    renderApp('/login');
    fireEvent.change(await screen.findByPlaceholderText('name@organization.org'), {
      target: { value: 'staff@example.org' },
    });
    fireEvent.click(screen.getByText('Reset Password'));

    await screen.findByText(EMAIL_RATE_LIMIT_MESSAGE);
  });
});
