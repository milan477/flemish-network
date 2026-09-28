import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionAwareFetch, onEdgeAuthFailure } from '../sessionEvents';

const SUPABASE_URL = 'https://project.supabase.co';

let unsubscribe: (() => void) | null = null;

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
});

function setup(status: number) {
  const listener = vi.fn();
  unsubscribe = onEdgeAuthFailure(listener);
  const baseFetch = vi.fn(async () => new Response('{}', { status }));
  return { listener, fetchFn: createSessionAwareFetch(SUPABASE_URL, baseFetch) };
}

describe('createSessionAwareFetch', () => {
  it('notifies listeners when an edge function returns 401', async () => {
    const { listener, fetchFn } = setup(401);

    const response = await fetchFn(`${SUPABASE_URL}/functions/v1/agent-scheduler`, { method: 'POST' });

    expect(response.status).toBe(401);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores 401s from other Supabase services', async () => {
    const { listener, fetchFn } = setup(401);

    await fetchFn(`${SUPABASE_URL}/rest/v1/people`);
    await fetchFn(`${SUPABASE_URL}/auth/v1/user`);

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores non-401 edge function failures', async () => {
    const { listener, fetchFn } = setup(500);

    await fetchFn(new Request(`${SUPABASE_URL}/functions/v1/agent-scheduler`, { method: 'POST' }));

    expect(listener).not.toHaveBeenCalled();
  });
});
