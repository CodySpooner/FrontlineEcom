// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { KbCardBrief } from '@frontline/shared';
import { Knowledge } from '../pages/Knowledge';
import { renderApp, stubApi } from '../test-utils';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const peak = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' };
const now = new Date().toISOString();
const brief = (id: string, storeId: string | null, over: Partial<KbCardBrief> = {}): KbCardBrief => ({
  id, storeId, categoryId: storeId ? 'peak-hooks' : 'general-ads', path: storeId ? ['Advertising', 'Hooks'] : ['Advertising'], type: 'strategy', stage: 'supported', status: 'active',
  title: `Card ${id}`, summary: '', tags: [], authorId: 'owner', origin: 'owner', pinned: false, blockedRoles: [], researchMarked: false, usedCount: 0, citedCount: 0, createdAt: now, updatedAt: now, ...over,
});
const cards = [brief('a', 'peak', { status: 'proposed', stage: 'tested' }), brief('b', 'peak'), brief('g', null)];
const views = [
  { id: 'v1', storeId: 'peak', name: 'Wide', state: { q: '', general: true, camera: { x: 0, y: 0, scale: 0.5 }, collapsed: [] }, createdAt: now },
  { id: 'v2', storeId: 'peak', name: 'Validated only', state: { q: '', general: true, filters: { stage: 'validated' } }, createdAt: now },
];
const library = (path = '/knowledge?ws=peak&view=library', total = cards.length, items = cards) => {
  const fetch = stubApi((url, init) => {
    if (init?.method && init.method !== 'GET') return url === '/api/kb/cards/bulk' ? { updated: 1 } : {};
    if (url === '/api/stores') return [peak];
    if (url === '/api/kb/workspaces') return { general: 1, peak: 2 };
    if (url.startsWith('/api/kb/cards?')) return { items, total, offset: 0, limit: 200 };
    const one = url.match(/^\/api\/kb\/cards\/(\w+)\?ws=all$/);
    if (one) return { ...cards.find((c) => c.id === one[1]), body: '', relevance: '', application: '', appliesTo: '', limits: '' };
    if (url.startsWith('/api/kb/categories?')) return [{ id: 'peak-ads', storeId: 'peak', parentId: null, name: 'Advertising', position: 1, createdAt: now, cards: 0 }, { id: 'peak-hooks', storeId: 'peak', parentId: 'peak-ads', name: 'Hooks', position: 1, createdAt: now, cards: 2 }];
    if (url.startsWith('/api/kb/sources?')) return [{ id: 's1', title: 'TikTok ads guide', url: 'https://a.test', status: 'read', reliability: 'platform_docs' }];
    if (url.startsWith('/api/kb/views')) return views;
    if (url.startsWith('/api/kb/positions')) return {};
  });
  renderApp(<Knowledge />, path);
  return fetch;
};
const where = () => screen.getByTestId('where').textContent;
const lastList = (fetch: ReturnType<typeof stubApi>) => {
  const urls = fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/kb/cards?'));
  return Object.fromEntries(new URLSearchParams(urls.at(-1)!.split('?')[1]));
};
const bulks = (fetch: ReturnType<typeof stubApi>) => fetch.mock.calls.filter(([u, i]) => u === '/api/kb/cards/bulk' && i?.method === 'POST').map(([, i]) => JSON.parse(String(i!.body)));

describe('Knowledge Library › cards', () => {
  it('lists the cards as a sortable table, pages on, and opens one beside it without leaving the Library', async () => {
    const fetch = library(undefined, 450);
    const table = await screen.findByRole('table', { name: 'Cards' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Unreviewed')).toBeTruthy(); // card a is proposed
    expect(within(table).getAllByText('General')).toHaveLength(1);
    expect(lastList(fetch)).toEqual({ ws: 'peak', general: '1', limit: '200' });
    fireEvent.click(within(table).getByRole('button', { name: 'Title' }));
    expect(where()).toBe('/knowledge?ws=peak&view=library&sort=title&dir=asc');
    expect(within(table).getByRole('columnheader', { name: 'Title' }).getAttribute('aria-sort')).toBe('ascending');
    await vi.waitFor(() => expect(lastList(fetch)).toMatchObject({ sort: 'title', dir: 'asc' }));
    fireEvent.click(within(table).getByRole('button', { name: 'Title' }));
    expect(where()).toBe('/knowledge?ws=peak&view=library&sort=title&dir=desc');
    expect(screen.getByText('Showing 3 of 450')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await vi.waitFor(() => expect(lastList(fetch)).toMatchObject({ limit: '400' }));
    fireEvent.click(within(table).getByRole('button', { name: 'Card b' }));
    expect(where()).toBe('/knowledge?ws=peak&view=library&sort=title&dir=desc&card=b');
    const panel = await screen.findByRole('complementary', { name: 'Card details' });
    expect(await within(panel).findByRole('heading', { name: 'Card b' })).toBeTruthy();
  });

  it('filters by every §13 field and clears them', async () => {
    const fetch = library();
    await screen.findByRole('table', { name: 'Cards' });
    const pick = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });
    const type = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
    await screen.findByRole('option', { name: 'Advertising › Hooks' });
    pick('Category', 'peak-hooks');
    pick('Type', 'strategy');
    pick('Stage', 'tested');
    pick('Validation status', 'proposed');
    expect(screen.queryByRole('combobox', { name: 'Agent' })).toBeNull(); // the rarer ones wait behind More filters
    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    await screen.findByRole('option', { name: 'TikTok ads guide' });
    pick('Agent', 'owner');
    pick('Source', 's1');
    type('Metric', 'roas');
    type('Tags', 'hooks, tiktok');
    type('Created from', '2026-10-01');
    type('Created to', '2026-10-20');
    type('Verified from', '2026-10-02');
    type('Verified to', '2026-10-21');
    await vi.waitFor(() =>
      expect(lastList(fetch)).toEqual({
        ws: 'peak', general: '1', limit: '200', category: 'peak-hooks', type: 'strategy', stage: 'tested', status: 'proposed', agent: 'owner', source: 's1', metric: 'roas', tag: 'hooks, tiktok',
        createdFrom: '2026-10-01', createdTo: '2026-10-20', verifiedFrom: '2026-10-02', verifiedTo: '2026-10-21',
      }),
    );
    expect(screen.getByRole('button', { name: 'More filters (8)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(where()).toBe('/knowledge?ws=peak&view=library');
  });

  it('saves the filters as a view and brings them back; artboard views stay on the artboard and the other way round', async () => {
    const fetch = library('/knowledge?ws=peak&view=library&stage=tested&sort=title&dir=asc');
    await screen.findByRole('table', { name: 'Cards' });
    const saved = await screen.findByRole('combobox', { name: 'Saved views' });
    await within(saved).findByRole('option', { name: 'Validated only' });
    expect(within(saved).queryByRole('option', { name: 'Wide' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'Mine' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'View name' }));
    await vi.waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/api/kb/views' && i?.method === 'POST')).toBe(true));
    const [, init] = fetch.mock.calls.find(([u, i]) => u === '/api/kb/views' && i?.method === 'POST')!;
    expect(JSON.parse(String(init!.body))).toMatchObject({ ws: 'peak', name: 'Mine', state: { general: true, filters: { stage: 'tested', sort: 'title', dir: 'asc' } } });
    fireEvent.change(saved, { target: { value: 'v2' } });
    expect(where()).toBe('/knowledge?ws=peak&view=library&stage=validated');
    fireEvent.click(screen.getByRole('radio', { name: 'Artboard' }));
    const board = await screen.findByRole('combobox', { name: 'Saved views' });
    await within(board).findByRole('option', { name: 'Wide' });
    expect(within(board).queryByRole('option', { name: 'Validated only' })).toBeNull();
  });

  it("bulk actions write to each card's own workspace; Accept touches only unreviewed cards", async () => {
    const fetch = library('/knowledge?ws=peak&view=library&status=proposed,active,archived', 4, [...cards, brief('r', 'peak', { status: 'archived' })]);
    const table = await screen.findByRole('table', { name: 'Cards' });
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select Card a' }));
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select Card g' }));
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Mark for research' }));
    await vi.waitFor(() => expect(bulks(fetch)).toHaveLength(2));
    expect(bulks(fetch)).toEqual([
      { ws: 'peak', ids: ['a'], patch: { researchMarked: true } },
      { ws: 'general', ids: ['g'], patch: { researchMarked: true } },
    ]);
    fireEvent.click(within(bar).getByRole('button', { name: 'Accept 1' }));
    await vi.waitFor(() => expect(bulks(fetch).at(-1)).toEqual({ ws: 'peak', ids: ['a'], patch: { status: 'active' } }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Block from agents' }));
    await vi.waitFor(() => expect(bulks(fetch).at(-1)).toEqual({ ws: 'general', ids: ['g'], patch: { blockedRoles: ['*'] } }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Move to…' }));
    fireEvent.change(within(bar).getByRole('combobox', { name: 'Move to category' }), { target: { value: 'Advertising › Hooks' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Move' }));
    await vi.waitFor(() => expect(bulks(fetch).at(-1)).toEqual({ ws: 'general', ids: ['g'], patch: { category: ['Advertising', 'Hooks'] } }));
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select Card r' })); // already archived: left alone
    fireEvent.click(within(bar).getByRole('button', { name: 'Archive' }));
    await vi.waitFor(() => expect(bulks(fetch).at(-2)).toEqual({ ws: 'peak', ids: ['a'], patch: { status: 'archived' } }));
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select all shown' }));
    expect(within(bar).getByText('4 selected')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();
  });
});
