// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Minimap } from './Minimap';
import { MEETING } from './world';

afterEach(cleanup);
test('minimap has named keyboard buttons for ten rooms and the hub and can collapse', () => {
  const focus = vi.fn(); render(<Minimap onFocus={focus} />);
  expect(screen.getAllByRole('button', { name: /^Focus/ })).toHaveLength(11);
  fireEvent.click(screen.getByRole('button', { name: 'Focus central hub on minimap' })); expect(focus).toHaveBeenCalledWith(MEETING);
  fireEvent.click(screen.getByRole('button', { name: /Office map/ })); expect(screen.queryByRole('button', { name: /^Focus/ })).toBeNull();
});
