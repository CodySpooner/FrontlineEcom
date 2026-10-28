// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { KbCardBrief } from '@frontline/shared';
import { Knowledge } from '../pages/Knowledge';
import { renderApp, stubApi } from '../test-utils';

// jsdom has no ResizeObserver; the artboard only uses it to track its size.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const peak = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' };
const now = new Date().toISOString();
const card = (id: string, categoryId: string, path: string[], storeId: string | null = 'peak'): KbCardBrief => ({
  id, storeId, categoryId, path, type: 'strategy', stage: 'supported', status: 'active', title: `Card ${id}`, summary: '', tags: [], authorId: 'owner', origin: 'owner',
  pinned: false, blockedRoles: [], researchMarked: false, usedCount: 0, citedCount: 0, createdAt: now, updatedAt: now,
});
const cat = (id: string, name: string, parentId: string | null, cards: number, storeId = 'peak', position = 1) => ({ id, storeId, parentId, name, position, createdAt: now, cards });
const cards = [card('a', 'peak-hooks', ['Advertising', 'Hooks']), card('b', 'peak-hooks', ['Advertising', 'Hooks']), card('s', 'peak-seo', ['SEO']), card('g', 'general-psychology', ['Psychology'], null)];
const links = [
  { id: 'l1', storeId: 'peak', fromId: 'a', toId: 'b', type: 'supports', why: 'Both lifted CTR in the same test', status: 'confirmed', authorId: 'owner', createdAt: now },
  { id: 'l2', storeId: 'peak', fromId: 's', toId: 'a', type: 'contradicts', why: 'Possible contradiction: the same claim', status: 'suggested', authorId: 'app', createdAt: now },
];
const board = (extra: (url: string, init?: RequestInit) => unknown = () => undefined, path = '/knowledge?ws=peak') => {
  const fetch = stubApi((url, init) => {
    const r = extra(url, init);
    if (r !== undefined) return r;
    if (init?.method && init.method !== 'GET') return init.method === 'DELETE' || init.method === 'PUT' ? new Response(null, { status: 204 }) : {};
    if (url === '/api/stores') return [peak];
    if (url.startsWith('/api/kb/cards?')) return { items: cards, total: cards.length, offset: 0, limit: 1000 };
    const one = url.match(/^\/api\/kb\/cards\/(\w+)\?ws=all$/);
    if (one) return { ...cards.find((c) => c.id === one[1]), body: '', relevance: '', application: '', appliesTo: '', limits: '' };
    if (url.startsWith('/api/kb/links?')) return links;
    if (url.startsWith('/api/kb/categories?'))
      return [cat('peak-ads', 'Advertising', null, 0), cat('peak-hooks', 'Hooks', 'peak-ads', 2), cat('peak-seo', 'SEO', null, 1, 'peak', 9)];
    if (url.startsWith('/api/kb/positions')) return {};
    if (url.startsWith('/api/kb/views')) return [];
    if (url.startsWith('/api/kb/research/tasks')) return [];
    if (url === '/api/kb/workspaces') return {};
  });
  renderApp(<Knowledge />, path);
  return fetch;
};
const where = () => screen.getByTestId('where').textContent;
const sent = (fetch: ReturnType<typeof stubApi>, method: string) => fetch.mock.calls.filter(([, i]) => i?.method === method).map(([u, i]) => [u, i?.body && JSON.parse(String(i.body))]);

describe('Knowledge artboard › lines', () => {
  it('draws each link by type, explains it on click, and accepts or rejects a suggestion', async () => {
    const fetch = board();
    const supports = await screen.findByRole('button', { name: 'Supports' });
    const contradicts = screen.getByRole('button', { name: 'Suggested: Contradicts' });
    expect(document.querySelector('[data-kb-link="l2"]')!.getAttribute('stroke-dasharray')).toBeTruthy();
    fireEvent.click(supports);
    const pop = screen.getByRole('dialog', { name: 'Why these cards are linked' });
    expect(within(pop).getByText('Both lifted CTR in the same test')).toBeTruthy();
    expect(within(pop).queryByRole('button', { name: 'Accept' })).toBeNull();
    fireEvent.keyDown(within(pop).getByRole('button', { name: 'Close' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Why these cards are linked' })).toBeNull();
    fireEvent.click(contradicts);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Why these cards are linked' })).getByRole('button', { name: 'Reject' }));
    await vi.waitFor(() => expect(sent(fetch, 'PATCH')).toEqual([['/api/kb/links/l2?ws=peak', { status: 'rejected' }]]));
  });

  it('stacks the pills of two links between the same cards instead of hiding one under the other', async () => {
    board((url) => (url.startsWith('/api/kb/links?') ? [...links, { ...links[0]!, id: 'l3', fromId: 'b', toId: 'a', type: 'builds_upon' }] : undefined));
    const one = await screen.findByRole('button', { name: 'Supports' });
    const two = screen.getByRole('button', { name: 'Builds Upon' });
    expect([one.style.left, one.style.top]).not.toEqual([two.style.left, two.style.top]);
  });

  it("Esc in the popover closes it, not the open card", async () => {
    board(undefined, '/knowledge?ws=peak&card=a');
    fireEvent.click(await screen.findByRole('button', { name: 'Supports' }));
    fireEvent.keyDown(within(screen.getByRole('dialog', { name: 'Why these cards are linked' })).getByRole('button', { name: 'Close' }), { key: 'Escape' });
    expect(where()).toBe('/knowledge?ws=peak&card=a');
  });

  it('has a legend', async () => {
    board();
    const legend = await screen.findByRole('list', { name: 'Line legend' });
    expect(within(legend).getByText('Contradicts')).toBeTruthy();
    expect(within(legend).getByText('Suggested by AI, not confirmed')).toBeTruthy();
  });
});

describe('Knowledge artboard › Outline', () => {
  it('lists the categories with counts and General apart; a row goes to its frame and focuses the first card', async () => {
    board();
    const outline = await screen.findByRole('navigation', { name: 'Outline' });
    const ads = await within(outline).findByRole('button', { name: /^Advertising 2$/ });
    expect(within(outline).getByRole('button', { name: /^Hooks 2$/ })).toBeTruthy();
    expect(within(outline).getByText('General knowledge')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Hooks' }));
    fireEvent.click(ads);
    expect(document.activeElement).toBe(await screen.findByRole('button', { name: /Card a/ }));
    expect(ads.getAttribute('aria-current')).toBe('true');
  });

  it('a ?frame= link (the Research Center map) opens that frame, focuses its first card, and leaves the URL', async () => {
    board(undefined, '/knowledge?ws=peak&frame=peak-ads');
    await vi.waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.kbCard).toBe('a'));
    await vi.waitFor(() => expect(where()).toBe('/knowledge?ws=peak'));
    expect(within(screen.getByRole('navigation', { name: 'Outline' })).getByRole('button', { name: /^Advertising 2$/ }).getAttribute('aria-current')).toBe('true');
  });

  it('adds a category', async () => {
    const fetch = board();
    fireEvent.click(await screen.findByRole('button', { name: 'New category' }));
    const name = screen.getByRole('textbox', { name: 'Category name' });
    fireEvent.change(name, { target: { value: 'Retention' } });
    fireEvent.submit(name);
    await vi.waitFor(() => expect(sent(fetch, 'POST')).toEqual([['/api/kb/categories', { ws: 'peak', name: 'Retention' }]]));
  });
});

describe('Knowledge artboard › saved views', () => {
  it('saves the filters, camera and collapsed frames, and brings them back', async () => {
    const view = { id: 'v1', storeId: 'peak', name: 'SEO only', state: { q: 'shipping', general: false, collapsed: ['peak-hooks'], camera: { x: 10, y: 20, scale: 0.5 } }, createdAt: now };
    const fetch = board((url, init) => (url.startsWith('/api/kb/views') && !init?.method ? [view] : undefined));
    fireEvent.click(await screen.findByRole('button', { name: 'Save view' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'Mine' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'View name' }));
    await vi.waitFor(() => expect(sent(fetch, 'POST')).toHaveLength(1));
    const [[url, body]] = sent(fetch, 'POST') as [[string, { ws: string; name: string; state: { collapsed: string[]; camera: object } }]];
    expect(url).toBe('/api/kb/views');
    expect(body).toMatchObject({ ws: 'peak', name: 'Mine', state: { general: true, collapsed: [] } });
    expect(body.state.camera).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Saved views' }), { target: { value: 'v1' } });
    expect(where()).toBe('/knowledge?ws=peak&q=shipping&general=0');
    expect(await screen.findByTestId('zoom')).toHaveProperty('textContent', '50%');
  });
});

describe('Knowledge artboard › Researching dock', () => {
  it('shows the live tasks and how many wait, and opens the Research Center', async () => {
    const task = (id: string, status: string, stage: string) => ({ id, storeId: 'peak', payerId: 'peak', role: 'market_analyst', objective: `Why ${id} works`, status, stage, createdAt: now });
    board((url) => (url.startsWith('/api/kb/research/tasks') ? [task('t1', 'running', 'retrieving'), task('t2', 'running', 'planning'), task('t3', 'queued', 'created'), task('t4', 'queued', 'created')] : undefined));
    const dock = await screen.findByRole('button', { name: /Researching/ });
    expect(within(dock).getByText('Why t1 works')).toBeTruthy();
    expect(within(dock).getByText('Analytics Specialist · retrieving')).toBeTruthy();
    expect(within(dock).getByText('+2 queued')).toBeTruthy();
    fireEvent.click(dock);
    expect(where()).toBe('/knowledge?ws=peak&view=research');
  });

  it('stays hidden with nothing researching', async () => {
    board();
    await screen.findByRole('button', { name: /Card a/ });
    expect(screen.queryByRole('button', { name: /Researching/ })).toBeNull();
  });
});
