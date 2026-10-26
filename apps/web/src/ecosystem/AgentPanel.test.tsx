// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Agent, AgentRun, OfficeSeat } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { AgentPanel } from './AgentPanel';
import { appearanceFor } from './characters';
import { emptyOffice, mergeOfficeSnapshot } from './events';

vi.mock('./WorkerPortrait', () => ({ WorkerPortrait: () => <span>Portrait</span> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('inspects real usage and cancels through the existing run endpoint', async () => {
  const agent: Agent = { id: 'glow:copywriter', storeId: 'glow', role: 'copywriter', status: 'running', level: 1, xp: 20, engine: { provider: 'demo' } };
  const run: AgentRun = { id: 'r1', agentId: agent.id, storeId: 'glow', task: 'Write a real headline', status: 'running', createdAt: new Date().toISOString(), usage: { inputTokens: 123, outputTokens: 45, costUsd: .12 } };
  const seat: OfficeSeat = { agentId: agent.id, deskId: 'copywriting-1', displayName: 'Nova', appearance: appearanceFor(agent.id), position: null, archived: false, updatedAt: run.createdAt };
  const fetch = stubApi((url, init) => url.startsWith('/api/runs?') ? [run] : url === '/api/runs/r1/cancel' && init?.method === 'POST' ? { ...run, status: 'cancelled' } : []);
  renderApp(<AgentPanel agent={agent} seat={seat} office={mergeOfficeSnapshot(emptyOffice(), [agent], [run], [])} onClose={() => {}} onFocus={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'Nova' })).toBeTruthy();
  expect(await screen.findByText('$0.12')).toBeTruthy();
  expect(screen.getByText('168')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Configure Agent' }).getAttribute('href')).toBe('/agents/glow%3Acopywriter?tab=settings');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/runs/r1/cancel', { method: 'POST' }));
  expect(await screen.findByText('Task cancelled.')).toBeTruthy();
});
