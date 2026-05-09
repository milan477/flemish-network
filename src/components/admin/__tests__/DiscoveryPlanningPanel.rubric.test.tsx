import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DiscoveryPlanningPanel from '../DiscoveryPlanningPanel';

// ---------------------------------------------------------------------------
// Supabase mock – returns empty reflection suggestions (the typical initial state)
// ---------------------------------------------------------------------------

vi.mock('../../../lib/supabase', () => {
  function makeChainable(): Record<string, unknown> {
    const terminalPromise = Promise.resolve({ data: [], error: null });
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
});

describe('DiscoveryPlanningPanel – basic rendering', () => {
  it('renders the page heading', async () => {
    renderPanel();
    expect(await screen.findByText('Where to look next')).toBeTruthy();
  });

  it('renders the Start discovery run button', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: /start discovery run/i })).toBeTruthy();
  });

  it('renders the Refresh suggestions button', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: /refresh suggestions/i })).toBeTruthy();
  });

  it('shows empty state when no reflection suggestions are available', async () => {
    renderPanel();
    expect(await screen.findByText(/no exploration suggestions yet/i)).toBeTruthy();
  });

  it('shows hint to refresh suggestions in empty state', async () => {
    renderPanel();
    expect(await screen.findByText(/click "refresh suggestions"/i)).toBeTruthy();
  });
});
