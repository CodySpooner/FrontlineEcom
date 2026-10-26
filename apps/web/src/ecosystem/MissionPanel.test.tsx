// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { NewSquadMission, SquadMission } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { MissionPanel } from './MissionPanel';
import { emptyOffice } from './events';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('creates an existing workflow with its actual dependencies and displays deliverables', async () => {
  const template: Omit<NewSquadMission, 'storeId'> = { title: 'Launch a new product', steps: [{ id: 'research', role: 'product_hunter', task: 'Research the product' }, { id: 'analysis', role: 'market_analyst', task: 'Validate the product', dependsOn: ['research'] }] };
  const mission: SquadMission = { id: 'mission', storeId: 'glow', title: template.title, status: 'running', createdAt: '', steps: [{ ...template.steps[0]!, dependsOn: [], status: 'done', runId: 'r1', deliverable: 'A product with 55% margin' }, { ...template.steps[1]!, dependsOn: ['research'], status: 'waiting', note: 'This agent is offline.' }] };
  const fetch = stubApi((url, init) => url === '/api/stores' ? [{ id: 'glow', name: 'Glow' }] : url.endsWith('/templates') ? [template] : init?.method === 'POST' ? mission : []);
  const close = vi.fn(), office = { ...emptyOffice(), missions: { mission } };
  renderApp(<MissionPanel office={office} create onCreate={() => {}} onCloseCreate={close} />);
  fireEvent.change(await screen.findByLabelText('Store'), { target: { value: 'glow' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start team mission' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(fetch).toHaveBeenCalledWith('/api/squad-missions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ ...template, storeId: 'glow' }) }));
  expect(screen.getByText('This agent is offline.')).toBeTruthy();
  expect(screen.getByText(/A product with 55% margin/)).toBeTruthy();
});
