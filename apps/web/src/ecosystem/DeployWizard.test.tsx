// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { OFFICE_DESKS, type Agent, type OfficeSeat } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { DeployWizard } from './DeployWizard';
import { appearanceFor } from './characters';

vi.mock('./WorkerPortrait', () => ({ WorkerPortrait: () => <span>Portrait</span> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const agent: Agent = { id: 'glow:copywriter', storeId: 'glow', role: 'copywriter', status: 'idle', level: 1, xp: 0 };
const seat = (id: string, deskId: string, archived = false): OfficeSeat => ({ agentId: id, deskId, archived, displayName: 'Nova', appearance: appearanceFor(id), position: null, updatedAt: '' });
test('restores an archived identity into a free desk, preserving backend conflicts', async () => {
  let conflict = true;
  const fetch = stubApi(() => conflict ? reply({ error: 'That workstation is occupied.' }, 409) : seat(agent.id, 'copywriting-2'));
  const close = vi.fn();
  renderApp(<DeployWizard agents={[agent]} seats={[seat(agent.id, 'copywriting-1', true), seat('other', 'copywriting-1')]} onClose={close} />);
  fireEvent.change(screen.getByLabelText('Agent and specialization'), { target: { value: agent.id } });
  expect((screen.getByLabelText('Office name (optional)') as HTMLInputElement).value).toBe('Nova');
  expect((screen.getByLabelText('Workstation') as HTMLSelectElement).value).toBe('copywriting-2');
  fireEvent.click(screen.getByRole('button', { name: 'Deploy to office' }));
  expect(await screen.findByText('That workstation is occupied.')).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  conflict = false;
  fireEvent.click(screen.getByRole('button', { name: 'Deploy to office' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenLastCalledWith('/api/ecosystem/seats', expect.objectContaining({ method: 'POST', body: JSON.stringify({ agentId: agent.id, deskId: 'copywriting-2', displayName: 'Nova', appearance: appearanceFor(agent.id) }) }));
});
test('capacity blocks deployment even if another agent exists', () => {
  renderApp(<DeployWizard agents={[agent]} seats={OFFICE_DESKS.map((d, i) => seat(String(i), d.id))} onClose={() => {}} />);
  expect(screen.getByText('Office full. Archive a worker to free a workstation.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Deploy to office' })).toBeNull();
});
