// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Agent, AgentRunDetail } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Chat } from './Chat';

const agent = { id: 'peak:copywriter', storeId: 'peak', role: 'copywriter', enabled: true } as Agent;
const run = (id: string, status: AgentRunDetail['status'], extra: Partial<AgentRunDetail> = {}): AgentRunDetail => ({
  id,
  storeId: 'peak',
  agentId: agent.id,
  task: 'Draft 3 headlines',
  status,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  createdAt: '2026-10-26T08:00:00Z',
  transcript: [],
  ...extra,
});

// jsdom has no ResizeObserver; Chat only uses it to keep the newest message in view.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('chat retry', () => {
  it('runs a failed last task again, in the same conversation', async () => {
    const fetch = stubApi((url, init) => {
      if (init?.method === 'POST') return run('r2', 'queued');
      if (url === '/api/runs/r0') return run('r0', 'error', { error: 'Rate limited' });
      if (url === '/api/runs/r1') return run('r1', 'error', { error: 'Interrupted by an app restart', sessionId: 's1' });
    });
    const onThread = vi.fn();
    renderApp(<Chat agent={agent} thread={['r0', 'r1']} onThread={onThread} />);

    // Only the newest message offers it.
    expect(await screen.findByText(/Interrupted by an app restart/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await vi.waitFor(() => expect(onThread).toHaveBeenCalledWith(['r0', 'r1', 'r2']));
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/api/agents/peak%3Acopywriter/runs');
    expect(JSON.parse(String(post[1]!.body))).toEqual({ task: 'Draft 3 headlines', resumeRunId: 'r1' });
  });

  it('offers nothing to retry after a finished run', async () => {
    stubApi((url) => (url === '/api/runs/r1' ? run('r1', 'done') : undefined));
    renderApp(<Chat agent={agent} thread={['r1']} onThread={() => {}} />);
    expect(await screen.findByText('Done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
