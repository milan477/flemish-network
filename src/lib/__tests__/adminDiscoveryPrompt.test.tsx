import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentDashboard from '../../components/admin/AgentDashboard';

const { invokeMock, tableCounts, agentRuns } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  tableCounts: {
    discovered_contacts: 0,
    discovered_organizations: 0,
  } as Record<string, number>,
  agentRuns: [] as Array<Record<string, unknown>>,
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
                limit: () => Promise.resolve({ data: agentRuns }),
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
            eq: () => Promise.resolve({ count: tableCounts.discovered_contacts }),
          }),
        };
      }

      if (table === 'discovered_organizations') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: tableCounts.discovered_organizations }),
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
  tableCounts.discovered_contacts = 0;
  tableCounts.discovered_organizations = 0;
  agentRuns.length = 0;
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

  it('shows pending people and organization counts', async () => {
    tableCounts.discovered_contacts = 3;
    tableCounts.discovered_organizations = 2;

    render(<AgentDashboard />);

    expect(await screen.findByText('Pending People')).toBeTruthy();
    expect(screen.getByText('Pending Organizations')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
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
