import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { syncPersonFlemishConnections } from '../flemishConnectionSync';

beforeEach(() => {
  rpcMock.mockReset();
});

describe('syncPersonFlemishConnections', () => {
  it('invokes the refresh RPC with id + raw text', async () => {
    rpcMock.mockResolvedValue({ error: null });
    await syncPersonFlemishConnections('person-1', 'KU Leuven alumnus');
    expect(rpcMock).toHaveBeenCalledWith('refresh_person_flemish_connections', {
      p_person_id: 'person-1',
      p_raw_text: 'KU Leuven alumnus',
    });
  });

  it('trims raw text and forwards', async () => {
    rpcMock.mockResolvedValue({ error: null });
    await syncPersonFlemishConnections('p2', '  Katholieke Universiteit Leuven  ');
    expect(rpcMock).toHaveBeenCalledWith(
      'refresh_person_flemish_connections',
      expect.objectContaining({
        p_raw_text: 'Katholieke Universiteit Leuven',
      })
    );
  });

  it('passes null when raw text is missing or whitespace', async () => {
    rpcMock.mockResolvedValue({ error: null });
    await syncPersonFlemishConnections('p3', '   ');
    expect(rpcMock).toHaveBeenCalledWith(
      'refresh_person_flemish_connections',
      { p_person_id: 'p3', p_raw_text: null }
    );

    rpcMock.mockClear();
    await syncPersonFlemishConnections('p4', null);
    expect(rpcMock).toHaveBeenCalledWith(
      'refresh_person_flemish_connections',
      { p_person_id: 'p4', p_raw_text: null }
    );

    rpcMock.mockClear();
    await syncPersonFlemishConnections('p5');
    expect(rpcMock).toHaveBeenCalledWith(
      'refresh_person_flemish_connections',
      { p_person_id: 'p5', p_raw_text: null }
    );
  });

  it('rethrows the supabase error', async () => {
    const err = new Error('rpc-failed');
    rpcMock.mockResolvedValue({ error: err });
    await expect(syncPersonFlemishConnections('p6', 'x')).rejects.toBe(err);
  });
});
