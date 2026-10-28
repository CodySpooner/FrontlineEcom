// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { KbCardBrief } from '@frontline/shared';
import { Knowledge } from '../pages/Knowledge';
import { renderApp, stubApi } from '../test-utils';
import { HEAD, PAD } from './layout';

// jsdom has no ResizeObserver; the artboard only uses it to track its size (and falls back to the window's).
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const peak = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' };
const now = new Date().toISOString();
const card = (id: string, extra: Partial<KbCardBrief> = {}): KbCardBrief => ({
  id, storeId: 'peak', categoryId: 'peak-ads', path: ['Advertising', 'Hooks'], type: 'strategy', stage: 'supported', status: 'active', title: `Card ${id}`, summary: 'Why it works',
  tags: [], authorId: 'peak:ad_strategist', origin: 'research', pinned: false, blockedRoles: [], researchMarked: false, usedCount: 0, citedCount: 0, createdAt: now, updatedAt: now, ...extra,
});
const board = (cards: KbCardBrief[], ws = 'peak') => {
  const fetch = stubApi((url, init) => {
    if (init?.method === 'PUT') return new Response(null, { status: 204 });
    if (url === '/api/stores') return [peak];
    if (url.startsWith('/api/kb/cards?')) return { items: cards, total: cards.length, offset: 0, limit: 1000 };
    if (url.startsWith('/api/kb/positions')) return {};
    if (url === '/api/kb/workspaces') return {};
  });
  renderApp(<Knowledge />, `/knowledge?ws=${ws}`);
  return fetch;
};
const cardEl = (title: string) => screen.findByRole('button', { name: new RegExp(title) });
const where = () => screen.getByTestId('where').textContent;
const zoom = () => screen.getByTestId('zoom').textContent;

describe('Knowledge artboard › cards', () => {
  it('shows each card per the design: type, workspace, author, confidence and freshness', async () => {
    board([
      // Checked long ago, but its category keeps cards fresh for longer (KB-23).
      card('a', { type: 'validated_insight', stage: 'validated', title: 'Problem-first hooks win', tags: ['tiktok', 'hooks'], verifiedAt: '2026-01-01T00:00:00Z', refreshBy: new Date(Date.now() + 86_400_000).toISOString() }),
      card('b', { stage: 'hypothesis', status: 'proposed', title: 'UGC beats studio', authorId: 'owner', verifiedAt: '2026-01-01T00:00:00Z', refreshBy: '2026-02-15T00:00:00Z' }),
      card('g', { storeId: null, categoryId: 'general-psychology', path: ['Psychology'], title: 'Pain beats gain', authorId: 'peak:market_analyst' }),
    ]);
    const a = await cardEl('Problem-first hooks win');
    expect(within(a).getByText('Validated Insight').className).toMatch(/text-good/);
    expect(within(a).getByText('Peak Fit')).toBeTruthy();
    expect(within(a).getByText('#tiktok #hooks')).toBeTruthy();
    expect(within(a).getByText('Confidence: Validated')).toBeTruthy();
    expect(within(a).getByText('AS')).toBeTruthy();
    expect(within(a).getByText('Ad Strategist')).toBeTruthy();
    expect(a.className).not.toMatch(/border-dashed/);
    const b = await cardEl('UGC beats studio');
    expect(b.className).toMatch(/border-dashed/);
    expect(within(b).getByText('Unreviewed')).toBeTruthy();
    expect(within(b).getByText('You')).toBeTruthy();
    expect(within(b).getByText('needs refresh')).toBeTruthy();
    expect(within(a).queryByText('needs refresh')).toBeNull();
    const g = await cardEl('Pain beats gain');
    expect(within(g).getByText('General')).toBeTruthy();
    expect(g.className).toMatch(/bg-\[#111114\]/);
    const frame = screen.getByRole('region', { name: 'Psychology' });
    expect(within(frame).getByText('General')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Advertising, Hooks' })).getByText('2 cards')).toBeTruthy();
  });

  it('collapses a frame to its header and expands it again', async () => {
    board([card('a'), card('b')]);
    await cardEl('Card a');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Hooks' }));
    expect(screen.queryByRole('button', { name: /Card a/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Hooks' }));
    expect(await cardEl('Card a')).toBeTruthy();
  });

  it("doesn't render cards far off screen", async () => {
    board(Array.from({ length: 400 }, (_, i) => card(`c${i}`, { categoryId: `cat-${Math.floor(i / 20)}`, path: [`Category ${String(Math.floor(i / 20)).padStart(2, '0')}`] })));
    await cardEl('Card c0');
    expect(document.querySelectorAll('[data-kb-card]').length).toBeLessThan(120);
  });
});

describe('Knowledge artboard › keyboard', () => {
  it('is one tab stop: the background, or the card last focused', async () => {
    board([card('a'), card('b')]);
    const canvas = screen.getByRole('application', { name: /Knowledge artboard/ });
    const a = await cardEl('Card a');
    expect([canvas.tabIndex, a.tabIndex]).toEqual([0, -1]);
    act(() => a.focus());
    expect([canvas.tabIndex, a.tabIndex]).toEqual([-1, 0]);
  });

  it('moves between cards with the arrows, opens one with Enter and toggles the selection with Space', async () => {
    // 3 cards → a b / c
    board([card('a'), card('b'), card('c')]);
    (await cardEl('Card a')).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(await cardEl('Card b'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(await cardEl('Card c'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }); // nothing that way
    expect(document.activeElement).toBe(await cardEl('Card c'));
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect((await cardEl('Card c')).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect((await cardEl('Card c')).getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(where()).toBe('/knowledge?ws=peak&card=c');
  });

  it('nudges the card with Alt+Arrow and saves its new place for this workspace', async () => {
    const fetch = board([card('a')]);
    (await cardEl('Card a')).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', altKey: true });
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1));
    const [url, init] = fetch.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(url).toBe('/api/kb/positions?ws=peak');
    expect(JSON.parse(String(init!.body))).toEqual({ a: { x: PAD + 8, y: HEAD } });
  });

  it('zooms with + and −, and 0 fits, from the background', async () => {
    board([card('a')]);
    await cardEl('Card a');
    const canvas = screen.getByRole('application', { name: /Knowledge artboard/ });
    canvas.focus();
    const fitted = zoom();
    fireEvent.keyDown(canvas, { key: '-' });
    expect(zoom()).not.toBe(fitted);
    fireEvent.keyDown(canvas, { key: '0' });
    expect(zoom()).toBe(fitted);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoom()).not.toBe(fitted);
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(zoom()).toBe(fitted);
  });
});
