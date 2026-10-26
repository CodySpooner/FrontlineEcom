// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { OfficeSeat } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { SeatEditor } from './SeatEditor';
import { appearanceFor } from './characters';
import { DEPARTMENT_DECOR, OFFICE_THEMES, themeId } from './themes';

vi.mock('./WorkerPortrait', () => ({ WorkerPortrait: () => <span>Portrait</span> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('worker changes use the persistent seat endpoint and exclude another occupied desk', async () => {
  const seat: OfficeSeat = { agentId: 'glow:copywriter', deskId: 'copywriting-1', displayName: 'Nova', appearance: appearanceFor('nova'), position: null, archived: false, updatedAt: '' };
  const fetch = stubApi((url, init) => init?.method === 'PATCH' ? seat : url.endsWith('/seats') ? [seat, { ...seat, agentId: 'other', deskId: 'copywriting-2' }] : []);
  const saved = vi.fn();
  renderApp(<SeatEditor seat={seat} onSaved={saved} />);
  await waitFor(() => expect(screen.queryByRole('option', { name: /copywriting-2/ })).toBeNull());
  fireEvent.change(screen.getByLabelText('Office name'), { target: { value: 'Nova Prime' } });
  fireEvent.change(screen.getByLabelText('Outfit'), { target: { value: 'suit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save worker appearance' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith('/api/ecosystem/seats/glow%3Acopywriter', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Nova Prime', appearance: { ...seat.appearance, outfit: 'suit' }, deskId: seat.deskId }) }));
});
test('theme catalog validates preferences and decor covers every department', () => {
  expect(themeId('__proto__')).toBe('frontline');
  expect(themeId('midnight')).toBe('midnight');
  expect(Object.keys(DEPARTMENT_DECOR)).toHaveLength(10);
  expect(Object.values(OFFICE_THEMES).every((t) => /^#[\da-f]{6}$/i.test(t.rail))).toBe(true);
});
