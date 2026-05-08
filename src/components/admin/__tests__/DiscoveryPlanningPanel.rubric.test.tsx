import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DiscoveryPlanningPanel, {
  type RecommendedAction,
} from '../DiscoveryPlanningPanel';

// ---------------------------------------------------------------------------
// Supabase mock – returns a minimal planning payload with one recommended
// action that has all rubric fields populated.
// ---------------------------------------------------------------------------

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

// Build a chainable query builder that resolves to empty data at the end
// of any method chain (select → gt → order → limit, or select → order → limit, etc.).
function makeChainable(): Record<string, unknown> {
  const terminalPromise = Promise.resolve({ data: [], error: null });
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in', 'not', 'order', 'limit', 'maybeSingle', 'single'];
  for (const method of methods) {
    chain[method] = () => ({ ...chain, then: terminalPromise.then.bind(terminalPromise) });
  }
  // Allow the chain itself to be awaited.
  Object.assign(chain, { then: terminalPromise.then.bind(terminalPromise) });
  return chain;
}

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
    from: () => makeChainable(),
  },
}));

// useNavigate is called inside DiscoveryPlanningPanel; MemoryRouter provides it.
// We also need to silence the lucide-react imports that are ESM-only in jsdom.

const RUBRIC_ACTION: RecommendedAction = {
  id: 'gap:boston-metro',
  action_type: 'gap_refresh',
  title: 'Refresh Boston Metro',
  detail: 'Gap score 0.82 with 3 approved and 1 pending.',
  query: '(Belgian OR Flemish) Technology Boston',
  priority_score: 0.82,
  rationale:
    'Boston Metro has a gap score of 0.82 with emphasis on Technology, indicating underrepresentation relative to expected coverage.',
  basis: {
    kind: 'coverage_gap',
    key: 'boston-metro',
  },
  target: {
    metro: 'Boston',
    sector: 'Technology',
  },
  expected_yield: 'high',
};

function makePlanningPayload(actions: RecommendedAction[]) {
  return {
    planning: {
      generated_at: new Date().toISOString(),
      coverage_summary: null,
      top_undercovered_metros: [],
      priority_states: [],
      top_entity_pivots: [],
      recent_refills: [],
      recommended_actions: actions,
    },
  };
}

function renderPanel(
  onRunDiscovery: (action: RecommendedAction) => void = vi.fn(),
  isRunning = false
) {
  return render(
    <MemoryRouter>
      <DiscoveryPlanningPanel
        onRunDiscovery={onRunDiscovery}
        isRunning={isRunning}
      />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

// ---------------------------------------------------------------------------
// Test group 1: Rubric fields are rendered on each recommendation card
// ---------------------------------------------------------------------------

describe('DiscoveryPlanningPanel – rubric field rendering', () => {
  it('renders the rationale text for a recommended action', async () => {
    invokeMock.mockResolvedValue({
      data: makePlanningPayload([RUBRIC_ACTION]),
      error: null,
    });

    renderPanel();

    expect(
      await screen.findByText(
        'Boston Metro has a gap score of 0.82 with emphasis on Technology, indicating underrepresentation relative to expected coverage.'
      )
    ).toBeTruthy();
  });

  it('renders the basis.kind chip for a recommended action', async () => {
    invokeMock.mockResolvedValue({
      data: makePlanningPayload([RUBRIC_ACTION]),
      error: null,
    });

    renderPanel();

    // The chip text is basis.kind with underscores replaced by spaces.
    expect(await screen.findByText('coverage gap')).toBeTruthy();
  });

  it('renders at least one target chip (metro or state) for a recommended action', async () => {
    invokeMock.mockResolvedValue({
      data: makePlanningPayload([RUBRIC_ACTION]),
      error: null,
    });

    renderPanel();

    // target.metro is "Boston"
    expect(await screen.findByText('Boston')).toBeTruthy();
  });

  it('renders the expected_yield badge as "high yield" for a high-yield action', async () => {
    invokeMock.mockResolvedValue({
      data: makePlanningPayload([RUBRIC_ACTION]),
      error: null,
    });

    renderPanel();

    expect(await screen.findByText('high yield')).toBeTruthy();
  });

  it('renders the expected_yield badge as "medium yield" for a medium-yield action', async () => {
    const mediumAction: RecommendedAction = {
      ...RUBRIC_ACTION,
      id: 'gap:medium',
      expected_yield: 'medium',
    };

    invokeMock.mockResolvedValue({
      data: makePlanningPayload([mediumAction]),
      error: null,
    });

    renderPanel();

    expect(await screen.findByText('medium yield')).toBeTruthy();
  });

  it('renders all rubric fields for an entity_pivot action', async () => {
    const pivotAction: RecommendedAction = {
      id: 'pivot:ku-leuven',
      action_type: 'entity_pivot',
      title: 'Expand KU Leuven',
      detail: '5 approved contacts and 2 strong evidence sources.',
      query: 'KU Leuven (Belgian OR Flemish OR Vlaams) team OR faculty OR people',
      priority_score: 0.75,
      rationale:
        'KU Leuven has 5 approved contacts and 2 strong evidence sources — expanding it may surface additional connected Flemish profiles.',
      basis: {
        kind: 'entity_pivot',
        key: 'KU Leuven',
      },
      target: {
        entity: 'KU Leuven',
      },
      expected_yield: 'high',
    };

    invokeMock.mockResolvedValue({
      data: makePlanningPayload([pivotAction]),
      error: null,
    });

    renderPanel();

    // rationale
    expect(
      await screen.findByText(
        'KU Leuven has 5 approved contacts and 2 strong evidence sources — expanding it may surface additional connected Flemish profiles.'
      )
    ).toBeTruthy();
    // basis chip — may appear alongside the action_type chip; verify at least one exists
    expect(screen.getAllByText('entity pivot').length).toBeGreaterThanOrEqual(1);
    // target chip
    expect(screen.getByText('KU Leuven')).toBeTruthy();
    // yield badge
    expect(screen.getAllByText('high yield').length).toBeGreaterThanOrEqual(1);
  });

  it('renders all rubric fields for a domain_revisit action', async () => {
    const domainAction: RecommendedAction = {
      id: 'domain:imec-int.com',
      action_type: 'domain_revisit',
      title: 'Revisit imec-int.com',
      detail: 'Yield 0.71 with 12 fetches left this week.',
      query:
        'site:imec-int.com (Belgian OR Flemish OR Vlaams) team OR faculty OR people',
      priority_score: 0.71,
      rationale:
        'imec-int.com has yielded 8 approved contacts and still has remaining weekly budget — revisiting it may surface untapped pages.',
      basis: {
        kind: 'proven_domain',
        key: 'imec-int.com',
      },
      target: {
        domain: 'imec-int.com',
      },
      expected_yield: 'high',
    };

    invokeMock.mockResolvedValue({
      data: makePlanningPayload([domainAction]),
      error: null,
    });

    renderPanel();

    // rationale
    expect(
      await screen.findByText(
        'imec-int.com has yielded 8 approved contacts and still has remaining weekly budget — revisiting it may surface untapped pages.'
      )
    ).toBeTruthy();
    // basis chip
    expect(screen.getByText('proven domain')).toBeTruthy();
    // target chip (domain)
    expect(screen.getByText('imec-int.com')).toBeTruthy();
    // yield badge
    expect(screen.getAllByText('high yield').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Test group 2: Run button hands off the full RecommendedAction object
// ---------------------------------------------------------------------------

describe('DiscoveryPlanningPanel – Run button handoff payload', () => {
  it('calls onRunDiscovery with the full RecommendedAction including basis, target, and rationale', async () => {
    invokeMock.mockResolvedValue({
      data: makePlanningPayload([RUBRIC_ACTION]),
      error: null,
    });

    const onRunDiscovery = vi.fn();
    renderPanel(onRunDiscovery);

    // Wait for the action Run button to appear after loading.
    // Use findAllByRole and pick the first enabled action Run button
    // (not the "Run Reflection Now" button which has a different label).
    const runButtons = await screen.findAllByRole('button', { name: /^run$/i });
    const runButton = runButtons[0];
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(onRunDiscovery).toHaveBeenCalledTimes(1);
    });

    const calledWith: RecommendedAction = onRunDiscovery.mock.calls[0][0];

    // Full object integrity
    expect(calledWith.id).toBe('gap:boston-metro');
    expect(calledWith.query).toBe('(Belgian OR Flemish) Technology Boston');
    expect(calledWith.priority_score).toBe(0.82);
    expect(calledWith.action_type).toBe('gap_refresh');

    // Rubric fields are present
    expect(calledWith.basis?.kind).toBe('coverage_gap');
    expect(calledWith.basis?.key).toBe('boston-metro');
    expect(calledWith.target?.metro).toBe('Boston');
    expect(calledWith.target?.sector).toBe('Technology');
    expect(calledWith.rationale).toContain('gap score of 0.82');
    expect(calledWith.expected_yield).toBe('high');
  });

  it('disables the Run button immediately after clicking it in the same session', async () => {
    invokeMock.mockResolvedValue({
      data: makePlanningPayload([RUBRIC_ACTION]),
      error: null,
    });

    const onRunDiscovery = vi.fn();
    renderPanel(onRunDiscovery);

    const runButtons = await screen.findAllByRole('button', { name: /^run$/i });
    const runButton = runButtons[0];
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(onRunDiscovery).toHaveBeenCalledTimes(1);
    });

    // After click the button must be disabled so accidental double-runs are prevented.
    // DiscoveryPlanningPanel tracks used IDs and disables the button; check the attribute directly.
    expect((runButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('hands off entity_pivot action with entity and domain in target', async () => {
    const pivotAction: RecommendedAction = {
      id: 'pivot:imec',
      action_type: 'entity_pivot',
      title: 'Expand imec',
      detail: '3 approved contacts and 1 strong evidence source.',
      query: 'site:imec-int.com imec (Belgian OR Flemish OR Vlaams)',
      priority_score: 0.65,
      rationale:
        'imec has 3 approved contacts and 1 strong evidence source — expanding it may surface additional connected Flemish profiles.',
      basis: { kind: 'entity_pivot', key: 'imec' },
      target: { entity: 'imec', domain: 'imec-int.com' },
      expected_yield: 'medium',
    };

    invokeMock.mockResolvedValue({
      data: makePlanningPayload([pivotAction]),
      error: null,
    });

    const onRunDiscovery = vi.fn();
    renderPanel(onRunDiscovery);

    const runButtons = await screen.findAllByRole('button', { name: /^run$/i });
    const runButton = runButtons[0];
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(onRunDiscovery).toHaveBeenCalledTimes(1);
    });

    const calledWith: RecommendedAction = onRunDiscovery.mock.calls[0][0];
    expect(calledWith.basis?.kind).toBe('entity_pivot');
    expect(calledWith.target?.entity).toBe('imec');
    expect(calledWith.target?.domain).toBe('imec-int.com');
    expect(calledWith.rationale).toContain('expanding it may surface');
  });
});
