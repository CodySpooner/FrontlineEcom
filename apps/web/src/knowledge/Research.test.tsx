// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { KbTaskDetail } from '@frontline/shared';
import { Knowledge } from '../pages/Knowledge';
import { renderApp, stubApi } from '../test-utils';
import { splitSources } from './Research';
import { researchHref } from './url';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const now = new Date().toISOString();
const paw = { id: 'pawsome', name: 'Pawsome Gear', platform: 'shopify', niche: 'pets', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' };
const agent = (role: string, over = {}) => ({ id: `pawsome:${role}`, storeId: 'pawsome', role, status: 'idle', level: 1, xp: 0, enabled: true, ...over });
const task = (over: Partial<KbTaskDetail> = {}): KbTaskDetail => ({
  id: 't1', storeId: 'pawsome', payerId: 'pawsome', role: 'ad_strategist', objective: 'hooks for anxious dogs', status: 'running', stage: 'retrieving', createdAt: now,
  kind: 'source', origin: 'owner', brief: { urls: ['https://a.test/hooks', 'https://b.test/guide', 'https://c.test/paid'] }, attempt: 0, budgetUsd: 1, spentUsd: 0.12,
  steps: [{ stage: 'planning', attempt: 1, status: 'done', startedAt: now }], log: [],
  sources: [{ id: 's1', url: 'https://a.test/hooks', title: 'Hook study', status: 'read', reliability: 'research' }, { id: 's2', url: 'https://c.test/paid', title: '', status: 'paywalled', reliability: 'unknown' }],
  findings: [], ...over,
});
const card = (id: string, title: string, status = 'proposed') => ({
  id, storeId: 'pawsome', categoryId: 'pawsome-ads', path: ['Advertising'], type: 'strategy', stage: 'supported', status, title, summary: `About ${title}`, tags: [], authorId: 'pawsome:ad_strategist',
  origin: 'research', pinned: false, blockedRoles: [], researchMarked: false, usedCount: 0, citedCount: 0, createdAt: now, updatedAt: now, body: '', relevance: '', application: '', appliesTo: '', limits: '',
});

function open(path: string, detail: KbTaskDetail = task()) {
  const cards = { c1: card('c1', 'Open on the problem'), c2: card('c2', 'Rescue stories lift CTR'), c3: card('c3', 'Old hook card', 'active') };
  const fetch = stubApi((url, init) => {
    if (init?.method === 'POST' && url === '/api/kb/research/tasks') return { ...detail, status: 'queued' };
    if (init?.method === 'POST' && url.endsWith('/refine')) return { ...detail, id: 't9', status: 'queued' };
    if (init?.method && init.method !== 'GET') return {};
    if (url === '/api/stores') return [paw];
    if (url === '/api/agents') return [agent('market_analyst'), agent('ad_strategist'), agent('copywriter', { enabled: false })];
    if (url === '/api/kb/workspaces') return {};
    if (url.startsWith('/api/kb/overview?')) return { cards: 0, thisWeek: 0, validated: 0, hypotheses: 0, supported: 0, stale: 0, conflicts: 0, running: 0, queued: 0, researchers: 0, sources: 0, map: [], discoveries: [], gaps: [] };
    if (url.startsWith('/api/kb/categories?ws=pawsome')) return [{ id: 'pawsome-ads', storeId: 'pawsome', parentId: null, name: 'Advertising', position: 1, createdAt: now, cards: 0 }];
    if (url.startsWith('/api/kb/categories?ws=general')) return [{ id: 'general-ads', storeId: null, parentId: null, name: 'Ads', position: 1, createdAt: now, cards: 0 }];
    if (url === '/api/kb/research/tasks/t1') return detail;
    if (url === '/api/kb/research/tasks/t9') return { ...detail, id: 't9', status: 'queued' };
    if (url.startsWith('/api/kb/cards?')) return { items: [cards.c1], total: 1, offset: 0, limit: 200 };
    if (url.startsWith('/api/kb/positions')) return {};
    const one = url.match(/^\/api\/kb\/cards\/(\w+)\?ws=all$/);
    if (one) return cards[one[1] as keyof typeof cards];
  });
  renderApp(<Knowledge />, path);
  return fetch;
}
const posts = (fetch: ReturnType<typeof stubApi>, url: string) => fetch.mock.calls.filter(([u, i]) => u === url && i?.method && i.method !== 'GET').map(([, i]) => JSON.parse(String(i!.body)));
const where = () => screen.getByTestId('where').textContent;
const field = (scope: HTMLElement, label: string) => within(scope).getByLabelText(label) as HTMLInputElement;

describe('Research from source', () => {
  it('splits a paste into its links and, when there is more than links, the text to read', () => {
    expect(splitSources('https://a.test/hooks\nhttps://b.test/guide.\nhttps://a.test/hooks, ')).toEqual({ urls: ['https://a.test/hooks', 'https://b.test/guide'], text: '' });
    expect(splitSources('Our notes say see https://a.test/x).')).toEqual({ urls: ['https://a.test/x'], text: 'Our notes say see https://a.test/x).' });
    expect(splitSources('  ')).toEqual({ urls: [], text: '' });
  });

  it("the Research Center's bar sends links and a document to the agent picked, then follows the task live", async () => {
    const fetch = open('/knowledge?ws=pawsome&view=research');
    const bar = await screen.findByRole('region', { name: 'Research from source' });
    fireEvent.change(within(bar).getByLabelText('Links or text'), { target: { value: 'https://a.test/hooks\nhttps://b.test/guide' } });
    const file = new File(['# Notes\nProblem first.'], 'notes.md', { type: 'text/markdown' });
    fireEvent.change(within(bar).getByLabelText('Attach a document'), { target: { files: [file] } });
    expect(within(bar).getByText('Reads 2 links · notes.md')).toBeTruthy();
    // Only enabled agents; findings go to the agent's store (with its categories) or General.
    const agents = within(bar).getByLabelText('Agent') as HTMLSelectElement;
    await vi.waitFor(() => expect([...agents.options].map((o) => o.text)).toEqual(['Market Analyst · Pawsome Gear', 'Ad Strategist · Pawsome Gear']));
    fireEvent.change(agents, { target: { value: 'pawsome:ad_strategist' } });
    const to = within(bar).getByLabelText('Save findings to') as HTMLSelectElement;
    await vi.waitFor(() => expect([...to.options].map((o) => o.text)).toEqual(['Pawsome Gear', 'Pawsome Gear › Advertising', 'General', 'General › Ads']));
    fireEvent.change(to, { target: { value: 'pawsome|pawsome-ads' } });
    fireEvent.change(within(bar).getByLabelText('What to look for (optional)'), { target: { value: ' hooks for anxious dogs ' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Start research' }));
    await vi.waitFor(() => expect(where()).toBe('/knowledge?ws=pawsome&view=research&task=t1'));
    expect(posts(fetch, '/api/kb/research/tasks')).toEqual([
      { agentId: 'pawsome:ad_strategist', ws: 'pawsome', categoryId: 'pawsome-ads', urls: ['https://a.test/hooks', 'https://b.test/guide'], document: { name: 'notes.md', data: btoa('# Notes\nProblem first.') }, lookFor: 'hooks for anxious dogs', budgetUsd: 1 },
    ]);
    // The task: each source as it's read, the ones still waiting, and Stop.
    const dialog = await screen.findByRole('dialog', { name: 'Research task' });
    await within(dialog).findByText('hooks for anxious dogs');
    expect(within(dialog).getByText('Reading sources')).toBeTruthy();
    expect(within(dialog).getByText('$0.12 of $1.00')).toBeTruthy();
    const sources = within(dialog).getByRole('list', { name: 'Sources' });
    expect(within(sources).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Hook studyread', 'https://c.test/paidpaywalled', 'https://b.test/guidewaiting']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
    await vi.waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/api/kb/research/tasks/t1/cancel' && i?.method === 'POST')).toBe(true));
  });

  it("the toolbar's From source opens the full form, with a budget, and can file to General", async () => {
    const fetch = open('/knowledge?ws=pawsome&view=library');
    fireEvent.click(await screen.findByRole('button', { name: 'From source' }));
    const dialog = await screen.findByRole('dialog', { name: 'Research from source' });
    const go = within(dialog).getByRole('button', { name: 'Start research' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true); // nothing to read yet
    fireEvent.change(within(dialog).getByLabelText('Links or text'), { target: { value: 'Our notes: problem-first openings worked in May.' } });
    expect(within(dialog).getByText('Reads the pasted text')).toBeTruthy();
    const to = within(dialog).getByLabelText('Save findings to') as HTMLSelectElement;
    await vi.waitFor(() => expect(to.options.length).toBe(4));
    fireEvent.change(to, { target: { value: 'general|' } });
    fireEvent.change(within(dialog).getByLabelText('Budget (USD)'), { target: { value: '2.5' } });
    fireEvent.click(go);
    await vi.waitFor(() => expect(posts(fetch, '/api/kb/research/tasks')).toEqual([{ agentId: 'pawsome:market_analyst', ws: 'general', text: 'Our notes: problem-first openings worked in May.', budgetUsd: 2.5 }]));
    await within(dialog).findByRole('list', { name: 'Sources' }); // the same dialog follows the task
    expect(where()).toBe('/knowledge?ws=pawsome&view=library&task=t1');
  });

  it('New research: a request, agent, destination and depth, then a plan to check before anything is spent', async () => {
    const fetch = open('/knowledge?ws=pawsome&view=research');
    fireEvent.click(await screen.findByRole('button', { name: 'New research' }));
    const dialog = await screen.findByRole('dialog', { name: 'New research' });
    expect(field(dialog, 'Budget (USD)').value).toBe('1.5'); // Standard
    fireEvent.change(field(dialog, 'Research request'), { target: { value: ' TikTok hooks that work for anxious dogs ' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Quick' }));
    expect(field(dialog, 'Budget (USD)').value).toBe('0.5');
    await vi.waitFor(() => expect((field(dialog, 'Save findings to') as unknown as HTMLSelectElement).options.length).toBe(4));
    fireEvent.change(field(dialog, 'Save findings to'), { target: { value: 'pawsome|pawsome-ads' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review the plan' }));
    const plan = within(dialog).getByRole('list', { name: 'Plan' });
    expect(within(plan).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Market Analyst (Pawsome Gear) plans it, starting from what your knowledge base already holds.',
      'Searches the web and reads up to 3 public sources. Paywalled and sign-in pages are skipped and listed.',
      'Weighs the evidence and files proposed cards to Pawsome Gear › Advertising for your review, linked to related cards.',
      'Writes a report: conclusions, open questions and ways to use it.',
    ]);
    expect(within(dialog).getByText("Spends at most $0.50 of Pawsome Gear's AI budget. Nothing is spent until you start it.")).toBeTruthy();
    expect(posts(fetch, '/api/kb/research/tasks')).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(field(dialog, 'Research request').value).toBe(' TikTok hooks that work for anxious dogs ');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review the plan' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start research' }));
    await vi.waitFor(() => expect(where()).toBe('/knowledge?ws=pawsome&view=research&task=t1'));
    expect(posts(fetch, '/api/kb/research/tasks')).toEqual([{ agentId: 'pawsome:market_analyst', ws: 'pawsome', categoryId: 'pawsome-ads', objective: 'TikTok hooks that work for anxious dogs', depth: 'quick', budgetUsd: 0.5 }]);
  });

  it('"Research deeper" on a card, or the research button on a frame, opens New research on it, filed to its category, in the same view', async () => {
    open('/knowledge?ws=pawsome&view=library&card=c1');
    fireEvent.click(await screen.findByRole('button', { name: 'Research deeper' }));
    expect(where()).toBe('/knowledge?ws=pawsome&view=library&card=c1&ask=Open+on+the+problem&cat=pawsome-ads');
    let dialog = await screen.findByRole('dialog', { name: 'New research' });
    expect(field(dialog, 'Research request').value).toBe('Open on the problem');
    await vi.waitFor(() => expect(field(dialog, 'Save findings to').value).toBe('pawsome|pawsome-ads'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(where()).toBe('/knowledge?ws=pawsome&view=library&card=c1');
    cleanup();

    open('/knowledge?ws=pawsome');
    fireEvent.click(await screen.findByRole('button', { name: 'Research Advertising' }));
    expect(where()).toBe('/knowledge?ws=pawsome&ask=Advertising&cat=pawsome-ads');
    dialog = await screen.findByRole('dialog', { name: 'New research' });
    expect(field(dialog, 'Research request').value).toBe('Advertising');
  });

  it('a "Research this" link from elsewhere in the app names the workspace and keeps the request within 500 characters', () => {
    expect(researchHref('pawsome', 'Why does "Spring sale" lose money?')).toBe('/knowledge?view=research&ws=pawsome&ask=Why+does+%22Spring+sale%22+lose+money%3F');
    expect(researchHref('general', 'x'.repeat(600), 'c1')).toBe(`/knowledge?view=research&ws=general&ask=${'x'.repeat(500)}&cat=c1`);
  });

  it('a finished task shows its report, and the cards it proposed to accept or reject; a failed one can be retried', async () => {
    const report = {
      summary: 'Lead with the problem.', conclusions: ['Problem-first hooks win'], unresolved: ['Does it hold for cats?'], limitations: ['Two sources'], applications: ['Rewrite the top 3 ads'],
      created: [{ id: 'c1', title: 'Open on the problem' }, { id: 'c2', title: 'Rescue stories lift CTR' }], updated: [{ id: 'c3', title: 'Old hook card' }],
      failedSources: [{ url: 'https://c.test/paid', status: 'paywalled' as const, error: 'The page is behind a paywall' }], conflicts: ['B says offers matter more'], errors: [],
    };
    const fetch = open('/knowledge?ws=pawsome&view=research&task=t1', task({ status: 'done', stage: 'reporting', report }));
    const dialog = await screen.findByRole('dialog', { name: 'Research task' });
    await within(dialog).findByText('Lead with the problem.');
    for (const line of ['Problem-first hooks win', 'Rewrite the top 3 ads', 'Does it hold for cats?', 'Two sources', 'https://c.test/paid: The page is behind a paywall', 'B says offers matter more']) expect(within(dialog).getByText(line)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Accept Open on the problem' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject Rescue stories lift CTR' }));
    await vi.waitFor(() => expect(posts(fetch, '/api/kb/cards/c1?ws=pawsome')).toEqual([{ status: 'active' }]));
    await vi.waitFor(() => expect(posts(fetch, '/api/kb/cards/c2?ws=pawsome')).toEqual([{ status: 'rejected' }]));
    // An updated card was already live: nothing to review, it opens in the Library.
    const updated = within(dialog).getByRole('list', { name: 'Updated cards' });
    expect(within(updated).queryByRole('button', { name: /^Accept/ })).toBeNull();
    fireEvent.click(within(updated).getByRole('button', { name: 'Old hook card' }));
    expect(where()).toBe('/knowledge?ws=pawsome&view=library&card=c3');
    cleanup();

    const failed = open('/knowledge?ws=pawsome&view=research&task=t1', task({ status: 'failed', error: 'None of the sources could be read.' }));
    const again = await screen.findByRole('dialog', { name: 'Research task' });
    await within(again).findByText('None of the sources could be read.');
    fireEvent.click(within(again).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(failed.mock.calls.some(([u, i]) => u === '/api/kb/research/tasks/t1/retry' && i?.method === 'POST')).toBe(true));
  });

  it('the task drawer: where it files, the execution log, and Refine as a new task', async () => {
    const log = [{ stage: 'retrieving', level: 'warn' as const, message: 'c.test/paid is behind a paywall', at: now }];
    const fetch = open('/knowledge?ws=pawsome&view=research&task=t1', task({ status: 'done', stage: 'reporting', categoryId: 'pawsome-ads', log }));
    const drawer = await screen.findByRole('dialog', { name: 'Research task' });
    expect(drawer.className).toContain('drawer');
    expect(await within(drawer).findByText('Files to Pawsome Gear › Advertising')).toBeTruthy();
    expect(within(drawer).getByText('Execution log (1)')).toBeTruthy();
    expect(within(drawer).getByText('c.test/paid is behind a paywall')).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Refine' }));
    expect(field(drawer, 'Research request').value).toBe('hooks for anxious dogs');
    expect(field(drawer, 'Budget (USD)').value).toBe('1');
    fireEvent.change(field(drawer, 'Research request'), { target: { value: ' hooks for anxious cats ' } });
    fireEvent.change(field(drawer, 'Budget (USD)'), { target: { value: '2' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Start refined research' }));
    await vi.waitFor(() => expect(posts(fetch, '/api/kb/research/tasks/t1/refine')).toEqual([{ objective: 'hooks for anxious cats', budgetUsd: 2 }]));
    await vi.waitFor(() => expect(where()).toContain('task=t9'));
    cleanup();

    // Only a finished task can be refined.
    open('/knowledge?ws=pawsome&view=research&task=t1');
    const going = await screen.findByRole('dialog', { name: 'Research task' });
    await within(going).findByRole('button', { name: 'Stop' });
    expect(within(going).queryByRole('button', { name: 'Refine' })).toBeNull();
  });
});
