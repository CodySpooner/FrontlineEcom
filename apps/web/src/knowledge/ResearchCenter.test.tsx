// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { KbCardBrief, KbOverview, KbTaskBrief, KbTaskDetail } from '@frontline/shared';
import { Knowledge } from '../pages/Knowledge';
import { renderApp, stubApi } from '../test-utils';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const now = new Date().toISOString();
const paw = { id: 'pawsome', name: 'Pawsome Gear', platform: 'shopify', niche: 'pets', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' };
const brief = (id: string, title: string, categoryId = 'p-hooks'): KbCardBrief => ({
  id, storeId: 'pawsome', categoryId, path: ['Advertising', 'Video hooks'], type: 'strategy', stage: 'validated', status: 'active', title, summary: `About ${title}`, tags: [],
  authorId: 'pawsome:ad_strategist', origin: 'research', pinned: false, blockedRoles: [], researchMarked: false, usedCount: 0, citedCount: 0, createdAt: now, updatedAt: now,
});
const none = { hypothesis: 0, supported: 0, tested: 0, validated: 0 };
const overview: KbOverview = {
  cards: 7, thisWeek: 3, validated: 1, hypotheses: 4, supported: 1, stale: 3, conflicts: 1, running: 1, queued: 1, researchers: 1, sources: 2,
  map: [
    { ws: 'pawsome', categoryId: 'p-ads', name: 'Advertising', stages: { ...none, hypothesis: 1, supported: 1, validated: 1 } },
    { ws: 'pawsome', categoryId: 'p-pricing', name: 'Pricing', stages: { ...none, hypothesis: 2 } },
  ],
  discoveries: [
    { kind: 'conflict', id: 'k1', at: now, note: 'Research says UGC wins; EXP-14 says studio', card: brief('c2', 'UGC beats studio footage'), other: brief('c1', 'Problem-first hooks win') },
    { kind: 'validated', at: now, reason: '2 independent measured tests', card: brief('c1', 'Problem-first hooks win') },
  ],
  gaps: [{ ws: 'pawsome', categoryId: 'p-pricing', name: 'Pricing', reason: 'only hypotheses' }],
};
const t = (id: string, objective: string, status: KbTaskBrief['status'], stage = 'reporting'): KbTaskBrief => ({ id, storeId: 'pawsome', payerId: 'pawsome', role: 'market_analyst', objective, status, stage, createdAt: now });
const running: KbTaskDetail = {
  ...t('t1', 'TikTok hooks for pet travel', 'running', 'evaluating'), kind: 'topic', origin: 'owner', brief: {}, attempt: 0, budgetUsd: 2, spentUsd: 0.42, steps: [], log: [],
  sources: [
    { id: 's1', url: 'https://a.test/1', title: 'One', status: 'read', reliability: 'research' },
    { id: 's2', url: 'https://b.test/2', title: 'Two', status: 'read', reliability: 'research' },
    { id: 's3', url: 'https://c.test/3', title: '', status: 'paywalled', reliability: 'unknown' },
  ],
  findings: [{ id: 'f1', title: 'A', status: 'pending' }, { id: 'f2', title: 'B', status: 'stored' }, { id: 'f3', title: 'C', status: 'merged', cardId: 'c1' }],
};
const recommend = (id: string, ws: string | null, objective: string, kind = 'kb.research') => ({
  id, storeId: ws ?? 'pawsome', agentId: 'pawsome:market_analyst', title: `Research: ${objective}`, reason: 'Up to $0.60 of AI usage.', status: 'pending', createdAt: now,
  action: { kind, payload: { ws, role: 'market_analyst', objective, brief: {}, budgetUsd: 0.6 } },
});

function open(path = '/knowledge?ws=pawsome&view=research') {
  const fetch = stubApi((url, init) => {
    if (init?.method === 'PATCH') return new Response(null, { status: 204 });
    if (init?.method && init.method !== 'GET') return {};
    if (url === '/api/stores') return [paw];
    if (url === '/api/agents') return [];
    if (url === '/api/kb/workspaces') return { general: 3, pawsome: 4 };
    if (url.startsWith('/api/kb/overview?')) return overview;
    if (url.startsWith('/api/kb/research/tasks?')) return [running, t('t2', 'Bundles for travel', 'queued', 'created'), t('t3', 'Crate sizes', 'done'), t('t4', 'Calming sprays', 'failed', 'retrieving')];
    if (url === '/api/kb/research/tasks/t1') return running;
    if (url.startsWith('/api/kb/sources?')) return [{ id: 's1', url: 'https://a.test/1', title: 'Hook study', status: 'read', reliability: 'research' }, { id: 's3', url: 'https://c.test/3', title: 'Paid report', status: 'paywalled', reliability: 'unknown' }];
    if (url.startsWith('/api/approvals?')) return [recommend('a1', 'pawsome', 'Why do bundles convert?'), recommend('a2', null, 'General pricing rules'), recommend('a3', 'pawsome', 'Pause ads', 'ads.pause')];
    if (url.startsWith('/api/kb/cards?')) return { items: [brief('c1', 'Problem-first hooks win'), brief('c4', 'Open on the reaction')], total: 2, offset: 0, limit: 5 };
  });
  renderApp(<Knowledge />, path);
  return fetch;
}
const where = () => screen.getByTestId('where').textContent;
const href = (name: string | RegExp, scope: HTMLElement = document.body) => within(scope).getByRole('link', { name }).getAttribute('href');

describe('Research Center', () => {
  it('workspace chips, six tiles, the knowledge map and the gaps, each linking where it says', async () => {
    const fetch = open();
    const chips = await screen.findByRole('group', { name: 'Workspace' });
    expect((await within(chips).findByRole('button', { name: 'Pawsome Gear 4' })).getAttribute('aria-pressed')).toBe('true');
    expect((await within(chips).findByRole('button', { name: 'General 3' })).getAttribute('aria-pressed')).toBe('false');

    await screen.findByRole('link', { name: /^Knowledge cards 7/ });
    expect(href('Knowledge cards 7 +3 this week')).toBe('/knowledge?view=library&ws=pawsome');
    expect(href('Validated 1 14% of cards')).toBe('/knowledge?view=library&ws=pawsome&stage=validated');
    expect(href('Hypotheses 4 1 research-supported, ready to test')).toBe('/knowledge?view=library&ws=pawsome&stage=hypothesis');
    expect(href('Researching now 1 1 queued · 1 agent')).toBe('#kb-research');
    expect(href('Needs refresh 3 over 90 days since checked')).toBe('/knowledge?view=library&ws=pawsome&sort=verified&dir=asc');
    expect(href('Conflicts 1 waiting for your call')).toBe('#kb-discoveries');

    const map = screen.getByRole('region', { name: 'Knowledge map' });
    expect(within(map).getByText('7 cards by category and evidence')).toBeTruthy();
    expect(href(/^Advertising 3/, map)).toBe('/knowledge?ws=pawsome&frame=p-ads');
    expect(within(map).getByRole('link', { name: /^Advertising 3/ }).textContent).toContain('1 validated, 1 supported, 1 hypothesis');
    expect(href(/^Pricing 2/, map)).toBe('/knowledge?ws=pawsome&frame=p-pricing');
    expect(href('Pawsome Gear · Pricing only hypotheses')).toBe('/knowledge?ws=pawsome&frame=p-pricing');

    // All workspaces: the same widgets over every workspace, and links that leave the workspace to the page.
    fireEvent.click(within(chips).getByRole('button', { name: 'All workspaces' }));
    expect(where()).toBe('/knowledge?ws=all&view=research');
    await vi.waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/api/kb/overview?ws=all')).toBe(true));
    expect((await screen.findByRole('link', { name: 'Validated 1 14% of cards' })).getAttribute('href')).toBe('/knowledge?view=library&stage=validated');
    expect(href(/^Advertising 3/, screen.getByRole('region', { name: 'Knowledge map' }))).toBe('/knowledge?ws=pawsome&frame=p-ads');
  });

  it('discoveries: a card that earned Validated opens on the artboard; a conflict opens to compare, or Keep both', async () => {
    // In All workspaces, so each action has to name the card's own workspace.
    const fetch = open('/knowledge?ws=all&view=research');
    const d = await screen.findByRole('region', { name: 'Latest discoveries' });
    const won = (await within(d).findByText('Problem-first hooks win', { selector: 'h3' })).closest('article')!;
    expect(within(won).getByText('Now validated')).toBeTruthy();
    expect(within(won).getByText('2 independent measured tests')).toBeTruthy();
    expect(href('Open on artboard', won)).toBe('/knowledge?ws=pawsome&card=c1');
    const conflict = within(d).getByText('UGC beats studio footage', { selector: 'h3' }).closest('article')!;
    expect(within(conflict).getByText('Research says UGC wins; EXP-14 says studio')).toBeTruthy();
    expect(within(conflict).getByText('Against: Problem-first hooks win')).toBeTruthy();
    expect(href('Compare evidence', conflict)).toBe('/knowledge?view=library&ws=pawsome&card=c2');
    fireEvent.click(within(conflict).getByRole('button', { name: 'Keep both' }));
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([u, i]) => [u, JSON.parse(String(i!.body))])).toEqual([['/api/kb/conflicts/k1?ws=pawsome', { status: 'kept_both' }]]));
    expect(href('View all', d)).toBe('/knowledge?view=library&sort=updated');
    // The newest discovery's frame, small, with the way in.
    const board = screen.getByRole('region', { name: 'Artboard preview' });
    expect(await within(board).findByText('Open on the reaction')).toBeTruthy();
    expect(within(board).getByText('Advertising › Video hooks')).toBeTruthy();
    expect(href('Open artboard', board)).toBe('/knowledge?ws=pawsome&frame=p-hooks');
  });

  it("the research column: a running task's progress with Stop, the queue, done tasks, sources, and recommendations to approve", async () => {
    const fetch = open();
    const rc = await screen.findByRole('region', { name: 'Research Center' });
    const tabs = within(rc).getByRole('tablist');
    await within(tabs).findByRole('tab', { name: 'Active 1' });
    expect(within(tabs).getAllByRole('tab').map((x) => x.textContent)).toEqual(['Active 1', 'Queue 1', 'Done 2', 'Sources 2']);
    const live = (await within(rc).findByText('TikTok hooks for pet travel')).closest('article')!;
    await within(live).findByText('Step 5 of 10 · Weighing the evidence');
    for (const line of ['Running', '2 sources read', '1 blocked (paywalled)', '3 findings so far', '1 matches an existing card', '$0.42 of $2.00']) expect(within(live).getByText(line)).toBeTruthy();
    expect(within(live).getAllByTestId('stage').map((s) => s.dataset.state)).toEqual(['done', 'done', 'done', 'done', 'now', 'todo', 'todo', 'todo', 'todo', 'todo']);
    fireEvent.click(within(live).getByRole('button', { name: 'Stop' }));
    await vi.waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/api/kb/research/tasks/t1/cancel' && i?.method === 'POST')).toBe(true));
    fireEvent.click(within(live).getByRole('button', { name: 'Open task' }));
    expect(where()).toContain('task=t1');

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Queue 1' }));
    expect(within(rc).getByText('Bundles for travel')).toBeTruthy();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Done 2' }));
    expect(within(rc).getByText('Crate sizes')).toBeTruthy();
    expect(within(within(rc).getByText('Calming sprays').closest('li')!).getByText('Failed')).toBeTruthy();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Sources 2' }));
    expect(await within(rc).findByText('Hook study')).toBeTruthy();
    expect(within(within(rc).getByText('Paid report').closest('li')!).getByText('paywalled')).toBeTruthy();

    // This workspace's research recommendations only; Approve starts the research.
    const rec = within(rc).getByRole('list', { name: 'Agents recommend' });
    expect(within(rec).getAllByRole('listitem').map((x) => x.textContent)).toEqual(['Why do bundles convert?Market Analyst · Pawsome Gear · up to $0.60Approve']);
    fireEvent.click(within(rec).getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/api/approvals/a1/approve' && i?.method === 'POST')).toBe(true));
  });
});
