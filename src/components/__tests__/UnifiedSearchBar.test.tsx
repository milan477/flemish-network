import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UnifiedSearchBar from '../UnifiedSearchBar';

describe('UnifiedSearchBar', () => {
  it('does not change the search until Enter is pressed', () => {
    const onSearch = vi.fn();
    render(<UnifiedSearchBar onSearch={onSearch} isSearching={false} initialValue="berkeley" />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'harvard' } });
    expect(onSearch).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'h' });
    fireEvent.keyDown(input, { key: 'a' });
    expect(onSearch).not.toHaveBeenCalled();

    fireEvent.submit(input.closest('form')!);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('harvard');
  });
});
