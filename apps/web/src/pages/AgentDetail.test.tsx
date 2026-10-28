// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Agent, AgentRunDetail, ApprovalRequest, Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Route, Routes } from 'react-router';
import { AgentBudget, AgentDetail, NicheLearnings } from './AgentDetail';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const agent = { id: 'peak:ad_strategist', storeId: 'peak', role: 'ad_strategist', enabled: true } as Agent;
const patches = (fetch: ReturnType<typeof stubApi>) => fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([url, init]) => [url, JSON.parse(String(init!.body))]);

describe("an agent's daily AI budget", () => {
  it('saves the amount the owner enters', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PATCH' ? { ...agent, dailyBudgetUsd: 2.5 } : undefined));
    renderApp(<AgentBudget agent={agent} />);
    fireEvent.change(screen.getByLabelText('Daily AI budget'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await vi.waitFor(() => expect(patches(fetch)).toEqual([['/api/agents/peak%3Aad_strategist', { dailyBudgetUsd: 2.5 }]]));
  });

  it("clearing it removes the agent's own cap", async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PATCH' ? agent : undefined));
    renderApp(<AgentBudget agent={{ ...agent, dailyBudgetUsd: 3 }} />);
    const input = screen.getByLabelText('Daily AI budget') as HTMLInputElement;
    expect(input.value).toBe('3');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await vi.waitFor(() => expect(patches(fetch)).toEqual([['/api/agents/peak%3Aad_strategist', { dailyBudgetUsd: null }]]));
  });

  it("shows how much of its budget the agent used today", async () => {
    stubApi(() => undefined);
    renderApp(<AgentBudget agent={{ ...agent, dailyBudgetUsd: 1, costTodayUsd: 0.42 }} />);
    expect(await screen.findByText('$0.42 of $1.00 used today')).toBeTruthy();
  });
});

describe('niche learnings', () => {
  it("a custom-niche store shows what its niche shares, asked by store", async () => {
    const store = { id: 'dew', name: 'Dew Lab', platform: 'shopify', niche: 'other', nicheDetail: 'K-beauty skincare', currency: 'USD' } as Store;
    const fetch = stubApi((url) =>
      url.startsWith('/api/stores') ? [store] : url.startsWith('/api/niche-learnings') ? [{ id: 'l1', niche: 'other:k-beauty-skincare', text: 'Glass-skin hooks win', createdAt: new Date().toISOString() }] : [],
    );
    renderApp(<NicheLearnings storeId="dew" />);
    expect(await screen.findByText('Glass-skin hooks win')).toBeTruthy();
    expect(screen.getByText('Shared with all K-beauty skincare stores')).toBeTruthy();
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/niche-learnings?store=dew');
  });

  it('names a built-in niche as the Knowledge page does', async () => {
    const store = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', currency: 'USD' } as Store;
    stubApi((url) => (url.startsWith('/api/stores') ? [store] : []));
    renderApp(<NicheLearnings storeId="peak" />);
    expect(await screen.findByText('Shared with all Fitness stores')).toBeTruthy();
  });
});

describe('agent header', () => {
  // jsdom has no ResizeObserver; the page's chat uses it to keep the newest message in view.
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));

  it('says when the agent runs on the free demo engine', async () => {
    stubApi((url) => (url === '/api/agents' ? [{ ...agent, status: 'idle', engine: { provider: 'demo' } }] : undefined));
    renderApp(
      <Routes>
        <Route path="/agents/:id" element={<AgentDetail />} />
      </Routes>,
      '/agents/peak%3Aad_strategist',
    );
    expect(await screen.findByText('Demo engine')).toBeTruthy();
  });

  it('lists its runs on the History tab', async () => {
    const run = { id: 'r1', agentId: agent.id, storeId: 'peak', task: 'Audit the broad campaign', status: 'done', createdAt: '2026-10-26T08:00:00Z', usage: { costUsd: 0.12 } };
    stubApi((url) => (url === '/api/agents' ? [{ ...agent, status: 'idle' }] : url.startsWith('/api/runs?') ? [run] : undefined));
    renderApp(
      <Routes>
        <Route path="/agents/:id" element={<AgentDetail />} />
      </Routes>,
      '/agents/peak%3Aad_strategist?tab=history',
    );
    expect(await screen.findByText('Audit the broad campaign')).toBeTruthy();
  });

  it('names the Claude model a live agent thinks with', async () => {
    stubApi((url) => (url === '/api/agents' ? [{ ...agent, status: 'idle', engine: { provider: 'claude', model: 'claude-opus-5-5' } }] : undefined));
    renderApp(
      <Routes>
        <Route path="/agents/:id" element={<AgentDetail />} />
      </Routes>,
      '/agents/peak%3Aad_strategist',
    );
    expect(await screen.findByText('Claude Opus 5.5')).toBeTruthy();
    expect(screen.queryByText('Demo engine')).toBeNull();
  });

  it("opens on this agent's own memories from its card, and can widen to the squad's", async () => {
    const mem = (id: string, agentId: string, text: string) => ({ id, storeId: 'peak', agentId, kind: 'learning', text, confidence: 0.6, tags: [], createdAt: '2026-10-26T08:00:00Z' });
    stubApi((url) =>
      url === '/api/agents'
        ? [{ ...agent, status: 'idle' }]
        : url === '/api/stores/peak/memory'
          ? [mem('m1', agent.id, 'Broad audiences beat interests here'), mem('m2', 'peak:copywriter', 'Short hooks win')]
          : undefined,
    );
    renderApp(
      <Routes>
        <Route path="/agents/:id" element={<AgentDetail />} />
      </Routes>,
      '/agents/peak%3Aad_strategist?tab=memory&by=agent',
    );
    expect(await screen.findByText('Broad audiences beat interests here')).toBeTruthy();
    expect(screen.queryByText('Short hooks win')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Everyone (2)' }));
    expect(screen.getByText('Short hooks win')).toBeTruthy();
  });
});

describe('an agent that needs the owner', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
  const request: ApprovalRequest = {
    id: 'a1',
    storeId: 'peak',
    agentId: 'peak:ad_strategist',
    title: 'Raise daily budget 20%',
    reason: 'ROAS above 3.0 for 5 days',
    action: { kind: 'ads.budget', payload: {} },
    status: 'pending',
    createdAt: '2026-10-26T08:00:00Z',
  };
  const other: ApprovalRequest = { ...request, id: 'a2', agentId: 'peak:copywriter', title: 'Rewrite the hero' };
  const open = (pending: ApprovalRequest[], run?: AgentRunDetail) => {
    stubApi((url) =>
      url === '/api/agents'
        ? [{ ...agent, status: 'waiting_approval' }]
        : url.startsWith('/api/approvals?status=pending')
          ? pending
          : url.startsWith('/api/runs?')
            ? (run ? [run] : [])
            : url.startsWith('/api/runs/')
              ? run
              : undefined,
    );
    renderApp(
      <Routes>
        <Route path="/agents/:id" element={<AgentDetail />} />
      </Routes>,
      '/agents/peak%3Aad_strategist',
    );
  };

  it('shows its waiting request on its own page, even one no chat run raised', async () => {
    open([request, other]);
    expect(await screen.findByText('Raise daily budget 20%')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve: Raise daily budget 20%' })).toBeTruthy();
    expect(screen.queryByText('Rewrite the hero')).toBeNull();
  });

  it('shows a request raised in the open chat run once, in the chat', async () => {
    const raised = { ...request, runId: 'r1' };
    const run = { id: 'r1', storeId: 'peak', agentId: 'peak:ad_strategist', task: 'Check budgets', status: 'waiting_approval', usage: {}, createdAt: '2026-10-26T08:00:00Z', transcript: [{ type: 'approval_request', approval: raised }] } as unknown as AgentRunDetail;
    open([raised], run);
    await screen.findByText('Check budgets');
    expect(await screen.findAllByText('Raise daily budget 20%')).toHaveLength(1);
  });
});
