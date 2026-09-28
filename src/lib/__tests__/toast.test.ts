import { afterEach, describe, expect, it, vi } from 'vitest';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }),
}));

import { notifyError } from '../toast';

// Shape of supabase-js FunctionsHttpError: generic message, raw Response in `context`.
function functionsHttpError(status: number, body: string) {
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(body, { status }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('notifyError', () => {
  it('shows the structured message from an edge function error body', async () => {
    notifyError(
      functionsHttpError(
        500,
        JSON.stringify({ error: { code: 'agent_failure', message: 'Failed to create agent run' } }),
      ),
      { hint: 'Could not start discovery.' },
    );

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to create agent run', {
        description: 'Could not start discovery.',
        duration: undefined,
      });
    });
  });

  it('tells the user to sign in again when the edge function rejects the session', async () => {
    notifyError(
      functionsHttpError(401, JSON.stringify({ error: { code: 'auth_failed', message: 'Session not found' } })),
      { hint: 'Could not start discovery.' },
    );

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Your session has ended. Please sign in again.', {
        description: 'Could not start discovery.',
        duration: undefined,
      });
    });
  });

  it('treats a non-JSON 401 as an ended session', async () => {
    notifyError(functionsHttpError(401, 'Unauthorized'));

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Your session has ended. Please sign in again.', {
        description: undefined,
        duration: undefined,
      });
    });
  });

  it('keeps plain errors synchronous', () => {
    notifyError(new Error('Boom'), { hint: 'Try again.' });

    expect(toastError).toHaveBeenCalledWith('Boom', { description: 'Try again.', duration: undefined });
  });
});
