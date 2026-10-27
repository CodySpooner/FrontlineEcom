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
const brief = (id: string, storeId: string | null = 'peak'): KbCardBrief => ({
  id, storeId, categoryId: 'peak-hooks', path: ['Advertising'], type: 'strategy', stage: 'supported', status: 'active', title: `Card ${id}`, summary: '', tags: [],
  authorId: 'owner', origin: 'owner', pinned: false, blockedRoles: [], researchMarked: false, usedCount: 0, citedCount: 0, createdAt: now, updatedAt: now,
});
const cards = ['a', 'b', 'c', 's', 'v'].map((id) => brief(id)).concat(brief('g', null), brief('lone'));
const link = (id: string, fromId: string, toId: string, type: string, why: string, status = 'confirmed') => ({ id, storeId: 'peak', fromId, toId, type, why, status, authorId: 'owner', createdAt: now });
const links = [
  link('l1', 'a', 'b', 'supports', 'Both lifted CTR in the same test'),
  link('l2', 's', 'a', 'contradicts', 'Possible contradiction: the same claim', 'suggested'),
  link('l3', 'b', 'c', 'builds_upon', 'C extends B'),
  link('l4', 'a', 'g', 'related_to', 'Same audience'),
  link('l5', 'v', 'a', 'derived_from', 'Built from it'),
];
const graph = (path: string) => {
  const fetch = stubApi((url, init) => {
    if (init?.method && init.method !== 'GET') return {};
    if (url === '/api/stores') return [peak];
    if (url.startsWith('/api/kb/cards?')) return { items: cards, total: cards.length, offset: 0, limit: 1000 };
    const one = url.match(/^\/api\/kb\/cards\/(\w+)\?ws=all$/);
    if (one) return { ...cards.find((c) => c.id === one[1]), body: '', relevance: '', application: '', appliesTo: '', limits: '' };
    if (url.startsWith('/api/kb/links?')) return links;
  });
  renderApp(<Knowledge />, path);
  return fetch;
};
const where = () => screen.getByTestId('where').textContent;

describe('Knowledge Relationships', () => {
  it('with no card picked, lists the connected cards, most connected first; picking one centres it', async () => {
    graph('/knowledge?ws=peak&view=relationships');
    const pick = await screen.findByRole('list', { name: 'Pick a card to explore' });
    await within(pick).findByRole('button', { name: /Card b/ });
    expect(within(pick).getAllByRole('button').map((b) => b.textContent)).toEqual(['Card a4 connections', 'Card b2 connections', 'Card c1 connection', 'Card g1 connection', 'Card s1 connection', 'Card v1 connection']);
    fireEvent.click(within(pick).getByRole('button', { name: /Card a/ }));
    expect(where()).toBe('/knowledge?ws=peak&view=relationships&card=a');
  });

  it('centres the card, its neighbours around it with how each relates, and their own neighbours on a second ring', async () => {
    graph('/knowledge?ws=peak&view=relationships&card=a');
    const map = await screen.findByRole('group', { name: 'Connections of Card a' });
    const node = (name: string) => within(map).getByRole('button', { name });
    await within(map).findByRole('button', { name: 'Card b' });
    expect(node('Card b').dataset.hop).toBe('1');
    expect(node('Card s').dataset.hop).toBe('1');
    expect(node('Card g').dataset.hop).toBe('1');
    expect(node('Card c').dataset.hop).toBe('2');
    const said = (name: string) => document.getElementById(node(name).getAttribute('aria-describedby')!)!.textContent;
    expect(said('Card b')).toBe('Supports: Both lifted CTR in the same test');
    expect(said('Card s')).toBe('Suggested · Contradicts: Possible contradiction: the same claim');
    expect(said('Card v')).toBe('Source of: Built from it'); // v is derived from a: read from a's side
    expect(said('Card c')).toBe('Card b builds upon: C extends B');
    expect(within(map).queryByRole('button', { name: 'Card lone' })).toBeNull();
    // The map comes first; the centre card opens its details beside it, and closing them keeps the map centred.
    const panel = screen.getByRole('complementary', { name: 'Card details' });
    expect(panel.hasAttribute('inert')).toBe(true);
    fireEvent.click(within(map).getByRole('button', { name: 'Details of Card a' }));
    expect(await within(panel).findByRole('heading', { name: 'Card a' })).toBeTruthy();
    expect(panel.hasAttribute('inert')).toBe(false);
    fireEvent.click(within(panel).getByRole('button', { name: 'Close details' }));
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(where()).toBe('/knowledge?ws=peak&view=relationships&card=a');
  });

  it('filters by relationship type and hides AI suggestions', async () => {
    graph('/knowledge?ws=peak&view=relationships&card=a');
    const map = await screen.findByRole('group', { name: 'Connections of Card a' });
    await within(map).findByRole('button', { name: 'Card b' });
    const types = screen.getByRole('group', { name: 'Relationship types' });
    fireEvent.click(within(types).getByRole('button', { name: 'Builds Upon' }));
    expect(within(types).getByRole('button', { name: 'Builds Upon' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(map).queryByRole('button', { name: 'Card c' })).toBeNull();
    fireEvent.click(within(types).getByRole('button', { name: 'Suggested by AI' }));
    expect(within(map).queryByRole('button', { name: 'Card s' })).toBeNull();
    expect(within(map).getByRole('button', { name: 'Card b' })).toBeTruthy();
  });

  it('arrow keys move between neighbours, Enter centres one, and a line explains itself', async () => {
    const fetch = graph('/knowledge?ws=peak&view=relationships&card=a');
    const map = await screen.findByRole('group', { name: 'Connections of Card a' });
    const first = await within(map).findByRole('button', { name: 'Card b' });
    expect(first.tabIndex).toBe(0);
    expect(within(map).getByRole('button', { name: 'Card s' }).tabIndex).toBe(-1);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(within(map).getByRole('button', { name: 'Card c' })); // b's own neighbour comes next
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(within(map).getByRole('button', { name: 'Card g' })); // round the ring backwards
    fireEvent.click(map.querySelector('[data-kb-why="l2"]')!);
    const pop = screen.getByRole('dialog', { name: 'Why these cards are linked' });
    expect(within(pop).getByText('Possible contradiction: the same claim')).toBeTruthy();
    fireEvent.click(within(pop).getByRole('button', { name: 'Accept' }));
    await vi.waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/api/kb/links/l2?ws=peak' && i?.method === 'PATCH')).toBe(true));
    fireEvent.keyDown(within(map).getByRole('button', { name: 'Card g' }), { key: 'Enter' });
    expect(where()).toBe('/knowledge?ws=peak&view=relationships&card=g');
  });

  it('says so when nothing is linked yet', async () => {
    stubApi((url) => (url === '/api/stores' ? [peak] : url.startsWith('/api/kb/cards?') ? { items: cards, total: 6, offset: 0, limit: 1000 } : undefined));
    renderApp(<Knowledge />, '/knowledge?ws=peak&view=relationships');
    expect(await screen.findByText('No connections to show yet')).toBeTruthy();
  });
});
