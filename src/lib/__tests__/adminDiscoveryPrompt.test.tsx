import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentDashboard from '../../components/admin/AgentDashboard';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
    from: (table: string) => {
      if (table === 'agent_runs') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [] }),
              }),
            }),
          }),
        };
      }

      if (table === 'api_quotas') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [] }),
          }),
        };
      }

      if (table === 'discovered_contacts') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0 }),
          }),
        };
      }

      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

vi.mock('../toast', () => ({
  notifyError: vi.fn(),
}));

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe('Admin Discovery prompt handoff', () => {
  it('prefills the Discovery query without calling the scheduler', async () => {
    render(
      <AgentDashboard initialDiscoveryPrompt="Find KU Leuven alumni in Boston biotech" />
    );

    expect(
      await screen.findByDisplayValue('Find KU Leuven alumni in Boston biotech')
    ).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('only calls the scheduler when staff explicitly starts Discovery', async () => {
    invokeMock.mockResolvedValue({ error: null });
    render(
      <AgentDashboard initialDiscoveryPrompt="Find Flemish climate founders in California" />
    );

    await screen.findByDisplayValue('Find Flemish climate founders in California');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('agent-scheduler', {
        body: {
          action: 'trigger',
          agent_type: 'discovery',
          params: { query: 'Find Flemish climate founders in California' },
        },
      });
    });
  });
});
