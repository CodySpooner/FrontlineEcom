// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Agent, ApprovalRequest, Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Route, Routes } from 'react-router';
import { AgentBudget, NicheLearnings } from './settings';
import { LegacyAgent, Workspace } from './Workspace';

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

// The old agent page's links (saved notifications, other modules, other lanes) land on the workspace (AA-14b).
describe("the old agent page's links", () => {
  const peak = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', currency: 'USD', timezone: 'UTC', color: '#ff2a3a', connected: true };
  const mem = (id: string, agentId: string, text: string) => ({ id, storeId: 'peak', agentId, kind: 'learning', text, confidence: 0.6, tags: [], createdAt: '2026-10-26T08:00:00Z' });
  const request = { id: 'a1', storeId: 'peak', agentId: 'peak:ad_strategist', title: 'Raise daily budget 20%', reason: 'ROAS above 3.0 for 5 days', action: { kind: 'ads.budget', payload: {} }, status: 'pending', createdAt: '2026-10-26T08:00:00Z' } as ApprovalRequest;
  const conversation = { id: 'c1', storeId: 'peak', configId: 'cfg', agentId: 'peak:ad_strategist', type: 'ad_strategist', title: 'Holiday budgets', pinned: false, createdAt: '2026-10-26T08:00:00Z', updatedAt: '2026-10-26T08:00:00Z', lastActivityAt: '2026-10-26T08:00:00Z', state: 'completed' };
  const open = (path: string) => {
    stubApi((url) => {
      const u = new URL(url, 'http://x');
      if (u.pathname === '/api/stores') return [peak];
      if (u.pathname === '/api/agents') return ['ad_strategist', 'copywriter'].map((role) => ({ id: `peak:${role}`, storeId: 'peak', role, status: 'idle', enabled: true }));
      if (u.pathname === '/api/approvals') return u.searchParams.get('status') === 'pending' ? [request, { ...request, id: 'a2', agentId: 'peak:copywriter', title: 'Rewrite the hero' }] : [];
      if (u.pathname === '/api/runs') return [{ id: 'r1', agentId: 'peak:ad_strategist', storeId: 'peak', task: 'Audit the broad campaign', status: 'done', createdAt: '2026-10-26T08:00:00Z', usage: { costUsd: 0.12 } }];
      if (u.pathname === '/api/runs/r1') return { id: 'r1', storeId: 'peak', agentId: 'peak:ad_strategist', conversationId: 'c1', task: 'Audit the broad campaign', status: 'done', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, createdAt: '2026-10-26T08:00:00Z', transcript: [] };
      if (u.pathname === '/api/stores/peak/memory') return [mem('m1', 'peak:ad_strategist', 'Broad audiences beat interests here'), mem('m2', 'peak:copywriter', 'Short hooks win')];
      if (u.pathname === '/api/agent-types') return [{ id: 'ad_strategist', name: 'Ad Strategist', description: '', baseRole: 'ad_strategist' }, { id: 'copywriter', name: 'Copywriter', description: '', baseRole: 'copywriter' }];
      if (u.pathname === '/api/conversations') {
        const items = u.searchParams.get('type') === 'copywriter' || u.searchParams.get('view') ? [] : [conversation];
        return { items, total: items.length, byType: items.length ? { ad_strategist: 1 } : {} };
      }
      if (u.pathname === '/api/conversations/counts') return {};
      if (u.pathname === '/api/conversations/c1') return { ...conversation, config: { runtime: 'demo', tools: [], knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } } };
      if (u.pathname === '/api/conversations/c1/thread') return { items: [], total: 0 };
      return undefined;
    });
    renderApp(
      <Routes>
        {['/agents', '/agents/c/:id'].map((p) => (
          <Route key={p} path={p} element={<Workspace />} />
        ))}
        <Route path="/agents/:id" element={<LegacyAgent />} />
      </Routes>,
      path,
    );
  };
  const where = () => screen.getByTestId('where').textContent;

  it('opens the type\'s latest conversation, else the workspace with its group open; ?run= opens the run, /agents/w too', async () => {
    open('/agents/peak%3Aad_strategist');
    await vi.waitFor(() => expect(where()).toBe('/agents/c/c1?store=peak'));
    cleanup();
    open('/agents/peak:copywriter');
    await vi.waitFor(() => expect(where()).toBe('/agents?store=peak&expand=copywriter'));
    cleanup();
    open('/agents/peak%3Aad_strategist?run=r1');
    await vi.waitFor(() => expect(where()).toBe('/agents/c/c1?store=peak'));
    cleanup();
    open('/agents/w?store=peak&run=r1');
    await vi.waitFor(() => expect(where()).toBe('/agents/c/c1?store=peak'));
  });

  it('?tab=history opens the settings drawer on its History, with the seat\'s runs', async () => {
    open('/agents/peak%3Aad_strategist?tab=history');
    expect(await screen.findByText('Audit the broad campaign')).toBeTruthy();
    expect(where()).toBe('/agents?store=peak&settings=ad_strategist&tab=history');
    expect(screen.getByRole('dialog', { name: 'Ad Strategist settings' })).toBeTruthy();
  });

  it("?tab=memory&by=agent opens on this agent's own memories, and can widen to the squad's", async () => {
    open('/agents/peak:ad_strategist?tab=memory&by=agent');
    expect(await screen.findByText('Broad audiences beat interests here')).toBeTruthy();
    expect(screen.queryByText('Short hooks win')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Everyone (2)' }));
    expect(screen.getByText('Short hooks win')).toBeTruthy();
  });

  it('the drawer shows what the seat is waiting on, even a request no conversation raised', async () => {
    open('/agents/peak%3Aad_strategist?tab=settings');
    expect(await screen.findByRole('button', { name: 'Approve: Raise daily budget 20%' })).toBeTruthy();
    expect(screen.queryByText('Rewrite the hero')).toBeNull();
  });
});
