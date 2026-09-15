import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DiscoveryPlanningPanel from '../DiscoveryPlanningPanel';

// ---------------------------------------------------------------------------
// Supabase mock – suggestions can be populated per test.
// ---------------------------------------------------------------------------

const { mockSuggestions } = vi.hoisted(() => ({
  mockSuggestions: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../lib/supabase', () => {
  function makeChainable(): Record<string, unknown> {
    const terminalPromise = Promise.resolve({ data: mockSuggestions, error: null });
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in', 'not', 'order', 'limit', 'maybeSingle', 'single'];
    for (const method of methods) {
      chain[method] = () => ({ ...chain, then: terminalPromise.then.bind(terminalPromise) });
    }
    Object.assign(chain, { then: terminalPromise.then.bind(terminalPromise) });
    return chain;
  }

  return {
    supabase: {
      functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
      from: () => makeChainable(),
    },
  };
});

function renderPanel() {
  return render(
    <MemoryRouter>
      <DiscoveryPlanningPanel
        onRunDiscovery={vi.fn()}
        onStartDiscovery={vi.fn()}
        onExploreSuggestion={vi.fn()}
        isRunning={false}
      />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  mockSuggestions.length = 0;
});

describe('DiscoveryPlanningPanel – basic rendering', () => {
  it('renders the page heading', async () => {
    renderPanel();
    expect(await screen.findByText('Where to look next')).toBeTruthy();
  });

  it('renders the next-proposal launch button', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: /launch next proposal/i })).toBeTruthy();
  });

  it('renders the Refresh proposals button', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: /refresh proposals/i })).toBeTruthy();
  });

  it('shows empty state when no reflection suggestions are available', async () => {
    renderPanel();
    expect(await screen.findByText(/no discovery proposals yet/i)).toBeTruthy();
  });

  it('shows hint to refresh proposals in empty state', async () => {
    renderPanel();
    expect(await screen.findByText(/select "refresh proposals"/i)).toBeTruthy();
  });

  it('breaks compound proposal context into categories and collapses the explanation', async () => {
    mockSuggestions.push({
      id: 'proposal-1',
      surface: 'company_team',
      lens: 'sector_geo',
      context_key: 'sector:finance,geo:midwest',
      rationale: 'A longer explanation that should stay collapsed until requested.',
      generated_at: '2026-09-14T12:00:00.000Z',
      consumed_attempt_count: 0,
      expires_at: '2026-09-28T12:00:00.000Z',
    });

    renderPanel();

    expect(await screen.findByRole('heading', { name: 'Finance in Midwest' })).toBeTruthy();
    expect(screen.getByText('Location')).toBeTruthy();
    expect(screen.queryByText('Domain')).toBeNull();
    expect(screen.getByText('Sector')).toBeTruthy();
    expect(screen.getByText('Source')).toBeTruthy();
    expect(screen.getByText('Approach')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Launch' })).toBeTruthy();

    const explanation = screen.getByText('View explanation').closest('details');
    expect(explanation?.open).toBe(false);
  });
});
