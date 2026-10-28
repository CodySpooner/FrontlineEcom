// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Agent } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { TaskComposer } from './TaskComposer';
import { emptyOffice } from './events';

const agent: Agent = { id: 'glow:copywriter', storeId: 'glow', role: 'copywriter', status: 'idle' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('submits a trimmed instruction to the existing agent and shows its result', async () => {
  const fetch = stubApi((url, init) => url.endsWith('/runs') && init?.method === 'POST' ? { id: 'r1', agentId: agent.id, task: 'Write a headline', status: 'done' } : []);
  renderApp(<TaskComposer agent={agent} office={emptyOffice()} />);
  expect((screen.getByRole('button', { name: 'Start task' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Task instruction'), { target: { value: '  Write a headline  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start task' }));
  expect(await screen.findByText('Task completed')).toBeTruthy();
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agents/glow%3Acopywriter/runs', expect.objectContaining({ method: 'POST', body: JSON.stringify({ task: 'Write a headline' }) })));
  expect(screen.getByRole('link').getAttribute('href')).toContain('?run=r1');
});
test('preserves the instruction on failure and identifies a pending run approval', async () => {
  let failing = true;
  stubApi(() => failing ? reply({ error: 'Agent unavailable' }, 503) : { id: 'r2', status: 'running', task: 'Review product' });
  const office = emptyOffice();
  office.approvals.a = { id: 'a', agentId: agent.id, storeId: 'glow', runId: 'r2', status: 'pending', title: 'Publish?', createdAt: new Date().toISOString() } as typeof office.approvals[string];
  renderApp(<TaskComposer agent={agent} office={office} />);
  fireEvent.change(screen.getByLabelText('Task instruction'), { target: { value: 'Review product' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start task' }));
  expect(await screen.findByText('Agent unavailable')).toBeTruthy();
  expect((screen.getByLabelText('Task instruction') as HTMLTextAreaElement).value).toBe('Review product');
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: 'Start task' }));
  expect(await screen.findByText('Awaiting approval')).toBeTruthy();
});
