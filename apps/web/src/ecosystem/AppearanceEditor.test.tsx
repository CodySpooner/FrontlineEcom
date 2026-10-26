// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { renderApp } from '../test-utils';
import { AppearanceEditor } from './AppearanceEditor';
import { appearanceFor } from './characters';

vi.mock('./WorkerPortrait', () => ({ WorkerPortrait: () => <span>Preview</span> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
test('reroll supplies a complete new saved look and individual controls preserve other traits', () => {
  const seed = '00000000-0000-4000-8000-000000000001';
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(seed);
  const look = appearanceFor('glow:copywriter'), change = vi.fn();
  renderApp(<AppearanceEditor value={look} onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Randomize look' }));
  expect(change).toHaveBeenLastCalledWith(appearanceFor(seed));
  expect(appearanceFor(seed)).not.toEqual(look);
  fireEvent.change(screen.getByLabelText('Character type'), { target: { value: 'mech' } });
  expect(change).toHaveBeenLastCalledWith({ ...look, archetype: 'mech' });
});
