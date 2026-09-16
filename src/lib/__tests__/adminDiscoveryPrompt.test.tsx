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
        const result = () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: agentRuns }),
          }),
        });
        return {
          select: () => ({
            eq: result,
            in: result,
            order: () => ({
              limit: () => Promise.resolve({ data: agentRuns }),
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
  notifySuccess: vi.fn(),
  notifyInfo: vi.fn(),
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

  it('opens Runs after the scheduler accepts a discovery run', async () => {
    invokeMock.mockResolvedValue({ data: { status: 'running' }, error: null });
    const onDiscoveryStarted = vi.fn();
    render(
      <AddContactPanel
        sectors={[]}
        onContactAdded={vi.fn()}
        onDiscoveryStarted={onDiscoveryStarted}
        initialDiscoveryPrompt="Find Flemish founders in Texas"
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Run Discovery' }));

    await waitFor(() => expect(onDiscoveryStarted).toHaveBeenCalledTimes(1));
  });

  it('forces the quota-free official Fayat discovery path past the manual cooldown', async () => {
    invokeMock.mockResolvedValue({ error: null });
    const prompt =
      'Find all laureates of Fayatbeurzen (Fayat Scholarships) who studied in the United States.';
    render(
      <AddContactPanel
        sectors={[]}
        onContactAdded={vi.fn()}
        initialDiscoveryPrompt={prompt}
      />
    );

    await screen.findByDisplayValue(prompt);
    fireEvent.click(screen.getByRole('button', { name: 'Run Discovery' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('agent-scheduler', {
        body: {
          action: 'trigger',
          agent_type: 'discovery',
          force: true,
          params: { query: prompt },
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

  it('renders a focused active-runs view', async () => {
    render(<AgentDashboard activeOnly />);

    expect(await screen.findByText('Ongoing runs')).toBeTruthy();
    expect(screen.getByText('Nothing is running right now.')).toBeTruthy();
  });

  it('renders the combined run history view', async () => {
    render(<AgentDashboard historyScope="all" />);

    expect(await screen.findByText('Run History')).toBeTruthy();
    expect(screen.getByText('No runs yet.')).toBeTruthy();
  });

  it('labels running verification correctly and shows who started it', async () => {
    agentRuns.push({
      id: 'run-verification-active',
      agent_type: 'verification',
      status: 'running',
      params: { record_type: 'discovered_contact' },
      started_at: '2026-09-15T23:03:00.000Z',
      completed_at: null,
      results: null,
      error_message: null,
      error_kind: null,
      initiated_by_staff_id: 'staff-1',
      initiated_by_name: 'Local Test Admin',
      llm_calls_made: 0,
      web_searches_made: 0,
      web_search_provider: null,
      cost_estimate_usd: 0,
      created_at: '2026-09-15T23:03:00.000Z',
    });

    render(<AgentDashboard historyScope="all" />);

    expect(await screen.findByText('Verification in progress')).toBeTruthy();
    expect(screen.getByText('Checking sources and profile details.')).toBeTruthy();
    expect(screen.getByText('Local Test Admin')).toBeTruthy();
    expect(screen.queryByText('Discovery in progress')).toBeNull();
  });

  it('summarizes verification as people checked and verified instead of new records', async () => {
    agentRuns.push({
      id: 'run-verification-complete',
      agent_type: 'verification',
      status: 'completed',
      params: { record_type: 'discovered_contact' },
      started_at: '2026-09-15T23:00:00.000Z',
      completed_at: '2026-09-15T23:01:30.000Z',
      results: {
        records_processed: 5,
        verified: 2,
        errors: 1,
        returned_to_queue: 2,
      },
      error_message: null,
      error_kind: null,
      initiated_by_staff_id: 'staff-1',
      initiated_by_name: 'Local Test Admin',
      llm_calls_made: 2,
      web_searches_made: 6,
      web_search_provider: 'mixed',
      cost_estimate_usd: 0.005,
      created_at: '2026-09-15T23:00:00.000Z',
    });

    render(<AgentDashboard historyScope="all" />);

    expect(await screen.findByText('2 people verified')).toBeTruthy();
    expect(screen.getByText('5 people checked · 2 verified · 1 failed')).toBeTruthy();
    expect(screen.getByText('Profile information and sources updated · 2 people returned to queue')).toBeTruthy();
    expect(screen.queryByText('No new records')).toBeNull();
  });

  it('summarizes discovery run results for people and organizations', async () => {
    const prompt = 'Find Flemish climate founders in California';
    agentRuns.push({
      id: 'run-1',
      agent_type: 'discovery',
      status: 'completed',
      params: { query: prompt },
      started_at: '2026-05-07T12:00:00.000Z',
      completed_at: '2026-05-07T12:01:00.000Z',
      results: {
        suggestions_created: 4,
        suggestions_merged: 1,
        organizations_inserted: 2,
        organizations_merged: 1,
        duplicates_skipped: 3,
        organization_duplicates_skipped: 2,
        steps: [
          {
            step: 'frontier_claim',
            timestamp: '2026-05-07T12:00:10.000Z',
            elapsed: '10s',
            status: 'ok',
            detail: { claimed_count: 6 },
          },
        ],
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

    expect(await screen.findByText('6 new records')).toBeTruthy();
    expect(screen.getByText(prompt)).toBeTruthy();
    expect(screen.getByText('4 people · 2 organizations')).toBeTruthy();
    expect(screen.getByText('2 records merged · 5 duplicates skipped')).toBeTruthy();

    const detailsButton = screen.getByRole('button', { name: 'View details' });
    expect(detailsButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(detailsButton);
    expect(screen.getByRole('button', { name: 'Hide details' })).toBeTruthy();
    expect(screen.getByText('Claim Frontier')).toBeTruthy();
  });

  it('uses red only for the failed status in a failed run row', async () => {
    agentRuns.push({
      id: 'run-failed',
      agent_type: 'discovery',
      status: 'failed',
      params: { query: 'Find Flemish founders in Texas' },
      started_at: '2026-05-07T12:00:00.000Z',
      completed_at: '2026-05-07T12:00:10.000Z',
      results: null,
      error_message: 'The discovery provider could not be reached.',
      error_kind: 'provider_unavailable',
      llm_calls_made: 0,
      web_searches_made: 0,
      web_search_provider: null,
      cost_estimate_usd: 0,
      created_at: '2026-05-07T12:00:00.000Z',
    });

    render(<AgentDashboard historyScope="all" />);

    const failedStatus = await screen.findByText('failed');
    expect(failedStatus.className).toContain('text-rose-700');
    expect(screen.getByText('Run failed').className).toContain('text-gray-900');
    screen.getAllByText('The discovery provider could not be reached.').forEach((message) => {
      expect(message.className).not.toMatch(/text-(rose|red)/);
    });
    expect(screen.getByText('Failure details').className).not.toMatch(/text-(rose|red)/);
  });

  it('does not crash when stored run steps omit the step identifier', async () => {
    agentRuns.push({
      id: 'run-with-legacy-step',
      agent_type: 'discovery',
      status: 'completed',
      params: { query: 'Fayat scholarship alumni that have gone to Finland.' },
      started_at: '2026-09-16T02:34:17.000Z',
      completed_at: '2026-09-16T02:34:19.000Z',
      results: {
        suggestions_created: 0,
        organizations_inserted: 0,
        steps: [{ elapsed: '1.3s', status: 'ok', detail: { duplicates_skipped: 31 } }],
      },
      error_message: null,
      error_kind: null,
      llm_calls_made: 0,
      web_searches_made: 0,
      web_search_provider: 'official_vlaanderen_directory',
      cost_estimate_usd: 0,
      created_at: '2026-09-16T02:34:17.000Z',
    });

    render(<AgentDashboard historyScope="all" />);

    fireEvent.click(await screen.findByRole('button', { name: 'View details' }));
    expect(screen.getByText('Run step')).toBeTruthy();
    expect(screen.getByText('ok')).toBeTruthy();
  });
});
