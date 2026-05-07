import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AddContactPanel from '../../components/admin/AddContactPanel';
import AgentDashboard from '../../components/admin/AgentDashboard';

const { invokeMock, agentRuns } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  agentRuns: [] as Array<Record<string, unknown>>,
}));

vi.mock('../supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supabase')>();

  return {
    ...actual,
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
                limit: () => Promise.resolve({ data: agentRuns }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
  };
});

vi.mock('../toast', () => ({
  notifyError: vi.fn(),
}));

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  agentRuns.length = 0;
});

describe('Admin Discovery prompt handoff', () => {
  it('prefills the Discovery query without calling the scheduler', async () => {
    render(
      <AddContactPanel
        sectors={[]}
        onContactAdded={vi.fn()}
        initialDiscoveryPrompt="Find KU Leuven alumni in Boston biotech"
      />
    );

    expect(
      await screen.findByDisplayValue('Find KU Leuven alumni in Boston biotech')
    ).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('only calls the scheduler when staff explicitly starts Discovery', async () => {
    invokeMock.mockResolvedValue({ error: null });
    render(
      <AddContactPanel
        sectors={[]}
        onContactAdded={vi.fn()}
        initialDiscoveryPrompt="Find Flemish climate founders in California"
      />
    );

    await screen.findByDisplayValue('Find Flemish climate founders in California');
    fireEvent.click(screen.getByRole('button', { name: 'Run Discovery' }));

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

  it('keeps quota and summary cards out of Discovery history', async () => {
    render(<AgentDashboard />);

    expect(await screen.findByText('Discovery History')).toBeTruthy();
    expect(screen.queryByText('API Quotas')).toBeNull();
    expect(screen.queryByText('Summary')).toBeNull();
  });

  it('summarizes discovery run results for people and organizations', async () => {
    agentRuns.push({
      id: 'run-1',
      agent_type: 'discovery',
      status: 'completed',
      params: {},
      started_at: '2026-05-07T12:00:00.000Z',
      completed_at: '2026-05-07T12:01:00.000Z',
      results: {
        suggestions_created: 4,
        suggestions_merged: 1,
        organizations_inserted: 2,
        organizations_merged: 1,
        duplicates_skipped: 3,
        organization_duplicates_skipped: 2,
      },
      error_message: null,
      error_kind: null,
      llm_calls_made: 0,
      web_searches_made: 0,
      web_search_provider: null,
      cost_estimate_usd: 0,
      created_at: '2026-05-07T12:00:00.000Z',
    });

    render(<AgentDashboard />);

    expect(
      await screen.findByText(
        '4 people created, 1 person merged, 2 organizations created, 1 organization merged, 3 duplicate people, 2 duplicate organizations'
      )
    ).toBeTruthy();
  });
});
