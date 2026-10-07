import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FlemishConnectionSelector from '../FlemishConnectionSelector';
import type { FlemishConnection } from '../../lib/flemishConnections';

const options: FlemishConnection[] = [
  { id: '1', name: 'A Major Flemish University', type: 'university', is_filterable: false },
  { id: '2', name: 'BAEF', type: 'other', is_filterable: true },
  { id: '3', name: 'KU Leuven', type: 'university', is_filterable: true },
  { id: '4', name: 'UHasselt', type: 'university', is_filterable: false },
];

afterEach(cleanup);

function renderSelector() {
  render(
    <FlemishConnectionSelector
      options={options}
      value={[]}
      onChange={vi.fn()}
      onCreateOption={vi.fn()}
      placeholder="Search connections"
    />
  );
}

describe('FlemishConnectionSelector', () => {
  it('lists only the broad filterable connections before staff search', () => {
    renderSelector();

    expect(screen.getByText('BAEF')).toBeTruthy();
    expect(screen.getByText('KU Leuven')).toBeTruthy();
    expect(screen.queryByText('A Major Flemish University')).toBeNull();
    expect(screen.queryByText('UHasselt')).toBeNull();
  });

  it('finds specific connections by search, filterable ones first', () => {
    renderSelector();

    fireEvent.change(screen.getByPlaceholderText('Search connections'), {
      target: { value: 'u' },
    });

    const names = screen
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
      .filter((text) => /KU Leuven|UHasselt|A Major Flemish University|BAEF/.test(text));
    expect(names[0]).toContain('KU Leuven');
    expect(names.some((text) => text.includes('UHasselt'))).toBe(true);
  });
});
