// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { AskPalette } from '../components/AskPalette';
import { renderApp, reply, stubApi } from '../test-utils';
import { Knowledge } from './Knowledge';

// jsdom has no ResizeObserver; the artboard only uses it to track its size.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Knowledge Base › page frame', () => {
  const peak = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' };
  const brief = (id: string, storeId: string | null, title: string) => ({
    id, storeId, categoryId: 'general-advertising', path: ['Advertising'], type: 'research_finding', stage: 'hypothesis', status: 'active', title, summary: '', tags: [],
    authorId: 'owner', origin: 'owner', pinned: false, blockedRoles: [], researchMarked: false, usedCount: 0, citedCount: 0, createdAt: '2026-10-26T08:00:00Z', updatedAt: '2026-10-26T08:00:00Z',
  });
  const playbook = { kind: 'playbook', key: 'ad_strategist', title: 'Ad Strategist playbook', chars: 9, markdown: '# Mission\n\nScale the winners.' };
  const docs = (url: string) => (url === '/api/knowledge' ? [playbook, { ...playbook, key: 'copywriter', title: 'Copywriter playbook' }] : url.startsWith('/api/knowledge/') ? playbook : undefined);
  const kb = (cards: unknown[] = [], extra: (url: string) => unknown = () => undefined) =>
    stubApi((url) => {
      const r = extra(url);
      if (r !== undefined) return r;
      if (url === '/api/stores') return [peak];
      if (url === '/api/kb/workspaces') return { general: 3, peak: 1 };
      if (url.startsWith('/api/kb/cards?')) return { items: cards, total: cards.length, offset: 0, limit: 200 };
    });
  const where = () => screen.getByTestId('where').textContent;
  const view = () => within(screen.getByRole('radiogroup', { name: 'View' })).getByRole('radio', { checked: true }).textContent;

  it('opens on the artboard, and a legacy ?tab= or ?doc= link on that Library section', async () => {
    kb([], docs);
    renderApp(<Knowledge />, '/knowledge?doc=copywriter');
    expect(await screen.findByText('Scale the winners.')).toBeTruthy();
    expect(view()).toBe('Library');
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Playbooks');
    cleanup();
    renderApp(<Knowledge />, '/knowledge?tab=memory');
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Store memory');
    cleanup();
    renderApp(<Knowledge />, '/knowledge');
    expect(view()).toBe('Artboard');
  });

  it('stays in the Library while moving between its sections and docs', async () => {
    kb([], docs);
    renderApp(<Knowledge />, '/knowledge?view=library&tab=memory');
    fireEvent.click(screen.getByRole('tab', { name: 'Playbooks' }));
    expect(where()).toBe('/knowledge?view=library');
    fireEvent.click(await screen.findByRole('button', { name: 'Copywriter' }));
    expect(where()).toBe('/knowledge?view=library&doc=copywriter');
    expect(view()).toBe('Library');
  });

  it('binds the view switcher to ?view=', () => {
    kb();
    renderApp(<Knowledge />, '/knowledge?ws=general');
    fireEvent.click(screen.getByRole('radio', { name: 'Relationships' }));
    expect(where()).toBe('/knowledge?ws=general&view=relationships');
    fireEvent.click(screen.getByRole('radio', { name: 'Artboard' }));
    expect(where()).toBe('/knowledge?ws=general');
  });

  it('starts on the store picked in the store filter, with its niche and card count; Include General is for stores only', async () => {
    localStorage.setItem('fe.stores', JSON.stringify(['peak']));
    const fetch = kb();
    renderApp(<Knowledge />, '/knowledge');
    const ws = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Workspace' });
    await vi.waitFor(() => expect(ws.value).toBe('peak'));
    expect(await screen.findByRole('option', { name: 'Peak Fit · Fitness · 1 card' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'General · 3 cards' })).toBeTruthy();
    await vi.waitFor(() => expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/kb/cards?ws=peak&general=1&limit=1000'));
    fireEvent.click(screen.getByRole('switch', { name: 'Include General knowledge' }));
    expect(where()).toBe('/knowledge?general=0');
    fireEvent.change(ws, { target: { value: 'general' } });
    expect(where()).toBe('/knowledge?general=0&ws=general');
    expect(screen.queryByRole('switch', { name: 'Include General knowledge' })).toBeNull();
  });

  it("opens a ?card= link in the card's own workspace", async () => {
    kb([], (url) => (url === '/api/kb/cards/c1?ws=all' ? brief('c1', 'peak', 'Bands beat dumbbells') : undefined));
    renderApp(<Knowledge />, '/knowledge?ws=general&card=c1');
    await vi.waitFor(() => expect(where()).toBe('/knowledge?ws=peak&card=c1'));
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Workspace' }).value).toBe('peak');
  });

  it('focuses search on /, but not while typing, with a modifier held or with a dialog open', async () => {
    kb([], docs);
    renderApp(
      <>
        <Knowledge />
        <AskPalette />
      </>,
      '/knowledge?tab=playbook',
    );
    const search = screen.getByRole('searchbox', { name: 'Search knowledge' });
    expect(fireEvent.keyDown(document.body, { key: '/', ctrlKey: true })).toBe(true);
    expect(document.activeElement).not.toBe(search);
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false); // handled, so no "/" lands in the box
    expect(document.activeElement).toBe(search);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const box = screen.getByRole('textbox', { name: /Ad Strategist playbook/ });
    box.focus();
    expect(fireEvent.keyDown(box, { key: '/' })).toBe(true);
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(true);
    expect(document.activeElement).not.toBe(search);
  });

  it('Esc closes the open card and puts focus back on it, but not while the Ask AI palette is open', async () => {
    const c1 = brief('c1', null, 'Hooks decide the first 3 seconds');
    kb([c1], (url) => (url === '/api/kb/cards/c1?ws=all' ? c1 : undefined));
    renderApp(
      <>
        <Knowledge />
        <AskPalette />
      </>,
      '/knowledge?ws=general&card=c1',
    );
    const card = await screen.findByRole('button', { name: /Hooks decide the first 3 seconds/ });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(where()).toBe('/knowledge?ws=general&card=c1');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(where()).toBe('/knowledge?ws=general');
    expect(document.activeElement).toBe(card);
  });

  it("says what's next when a workspace is empty or nothing matches, and offers a retry when cards can't load", async () => {
    kb();
    renderApp(<Knowledge />, '/knowledge?ws=general');
    expect(await screen.findByText('No knowledge in General yet')).toBeTruthy();
    cleanup();
    renderApp(<Knowledge />, '/knowledge?ws=general&q=zzz');
    expect(await screen.findByText('Nothing matches')).toBeTruthy();
    cleanup();
    stubApi((url) => (url.startsWith('/api/kb/cards?') ? reply({ error: 'boom' }, 500) : undefined));
    renderApp(<Knowledge />, '/knowledge?ws=general');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Knowledge Base › niche packs', () => {
  it('shows the learnings shared with that niche above its pack', async () => {
    const fetch = stubApi((url) => {
      if (url === '/api/knowledge') return [{ kind: 'niche', key: 'pet', title: 'Pet niche pack', chars: 20 }];
      if (url === '/api/knowledge/niche/pet') return { kind: 'niche', key: 'pet', title: 'Pet niche pack', chars: 20, markdown: '# Pet\n\nDog owners buy on emotion.' };
      if (url.startsWith('/api/niche-learnings')) return [{ id: 'l1', niche: 'pet', text: 'Bundles beat discounts for chews', createdAt: new Date().toISOString() }];
    });
    renderApp(<Knowledge />, '/knowledge?tab=niche');
    expect(await screen.findByText('Bundles beat discounts for chews')).toBeTruthy();
    expect(screen.getByText('Shared with all Pet stores')).toBeTruthy();
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/niche-learnings?niche=pet');
  });

  it('names the stores that read a custom niche pack', async () => {
    const doc = { kind: 'niche', key: 'other:yoga-mats', title: 'Yoga mats niche pack', chars: 20, custom: true };
    stubApi((url) => {
      if (url === '/api/knowledge') return [doc];
      if (url === '/api/knowledge/niche/other%3Ayoga-mats') return { ...doc, markdown: '# Yoga mats' };
      if (url === '/api/stores') return [{ id: 'zen', name: 'Zen Co', platform: 'shopify', niche: 'other', nicheDetail: 'Yoga Mats', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' }];
      if (url.startsWith('/api/niche-learnings')) return [];
    });
    renderApp(<Knowledge />, '/knowledge?tab=niche');
    expect(await screen.findByText('Used by Zen Co')).toBeTruthy();
  });
});

describe('Knowledge Base › a custom niche with no pack', () => {
  const zen = { id: 'zen', name: 'Zen Co', platform: 'shopify', niche: 'other', nicheDetail: 'Yoga Mats', color: '#ff2a3a', currency: 'USD', timezone: 'UTC', connected: true };
  const api = (provider: 'claude' | 'demo', pending: unknown[] = []) =>
    stubApi((url, init) => {
      if (init?.method === 'POST') return { id: 'r1', agentId: 'zen:market_analyst', status: 'running' };
      if (url.startsWith('/api/approvals')) return pending;
      if (url === '/api/knowledge') return [{ kind: 'niche', key: 'pet', title: 'Pet niche pack', chars: 20 }];
      if (url.startsWith('/api/knowledge/')) return { kind: 'niche', key: 'pet', title: 'Pet niche pack', chars: 20, markdown: '# Pet' };
      if (url === '/api/stores') return [zen];
      if (url.startsWith('/api/agents')) return [{ id: 'zen:market_analyst', storeId: 'zen', role: 'market_analyst', enabled: true, engine: { provider } }];
      if (url.startsWith('/api/niche-learnings')) return [];
    });

  it('asks its Market Analyst to draft one and opens the run', async () => {
    const fetch = api('claude');
    renderApp(<Knowledge />, '/knowledge?tab=niche');
    expect(await screen.findByText(/has no pack yet/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask its Market Analyst to draft one' }));
    await vi.waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/agents\/zen(%3A|:)market_analyst\?run=r1$/));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => url)).toEqual(['/api/agents/zen%3Amarket_analyst/niche-pack']);
  });

  it('points at the draft already waiting instead of asking for another', async () => {
    const draft = { id: 'a1', storeId: 'zen', agentId: 'zen:market_analyst', title: 'Save the Yoga Mats niche pack', reason: 'x', status: 'pending', createdAt: '2026-10-26T08:00:00Z', action: { kind: 'save_niche_pack', payload: { slug: 'Yoga Mats', markdown: '# Yoga Mats' } } };
    api('claude', [draft]);
    renderApp(<Knowledge />, '/knowledge?tab=niche');
    expect((await screen.findByRole('link', { name: 'Review it in Requests' })).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('button', { name: /Ask its Market Analyst/ })).toBeNull();
  });

  it("on the demo engine, says when one gets drafted instead (a demo run would make one up)", async () => {
    api('demo');
    renderApp(<Knowledge />, '/knowledge?tab=niche');
    expect(await screen.findByText(/drafts one once the store is connected/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ask its Market Analyst/ })).toBeNull();
  });
});

describe('Knowledge Base › store memory', () => {
  it("says that rewording the squad's memory makes it the owner's note", async () => {
    const mem = (id: string, agentId: string, text: string) => ({ id, storeId: 'peak', agentId, kind: 'learning', text, confidence: 0.6, tags: [], createdAt: '2026-10-26T08:00:00Z' });
    stubApi((url) => {
      if (url === '/api/stores') return [{ id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' }];
      if (url === '/api/stores/peak/memory') return [mem('m1', 'peak:copywriter', 'Short hooks win on TikTok'), mem('m2', 'owner', 'Never discount the bands')];
    });
    renderApp(<Knowledge />, '/knowledge?tab=memory');
    await screen.findByText('Short hooks win on TikTok');
    const [squad, owner] = screen.getAllByRole('button', { name: 'Edit' });
    fireEvent.click(squad!);
    expect(screen.getByText(/becomes your note/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(owner!);
    expect(screen.queryByText(/becomes your note/)).toBeNull();
  });
});

describe('Knowledge Base › closing an editor', () => {
  it("puts focus back on the playbook's Edit button", async () => {
    const doc = { kind: 'playbook', key: 'ad_strategist', title: 'Ad Strategist playbook', chars: 9, markdown: '# Mission' };
    stubApi((url) => (url === '/api/knowledge' ? [doc] : url.startsWith('/api/knowledge/') ? doc : undefined));
    renderApp(<Knowledge />, '/knowledge?tab=playbook');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
  });

  it("puts focus back on a memory's Edit button", async () => {
    stubApi((url) => {
      if (url === '/api/stores') return [{ id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' }];
      if (url === '/api/stores/peak/memory') return [{ id: 'm1', storeId: 'peak', agentId: 'owner', kind: 'learning', text: 'Never discount the bands', confidence: 0.6, tags: [], createdAt: '2026-10-26T08:00:00Z' }];
    });
    renderApp(<Knowledge />, '/knowledge?tab=memory');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
  });
});

describe('Knowledge Base › forgetting a memory', () => {
  it('asks first: nothing is deleted until the owner confirms', async () => {
    const deletes = (fetch: ReturnType<typeof stubApi>) => fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE').length;
    const fetch = stubApi((url, init) => {
      if (init?.method === 'DELETE') return {};
      if (url === '/api/stores') return [{ id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' }];
      if (url === '/api/stores/peak/memory') return [{ id: 'm1', storeId: 'peak', agentId: 'owner', kind: 'learning', text: 'Never discount the bands', confidence: 0.6, tags: [], createdAt: '2026-10-26T08:00:00Z' }];
    });
    renderApp(<Knowledge />, '/knowledge?tab=memory');
    fireEvent.click(await screen.findByRole('button', { name: 'Forget: Never discount the bands' }));
    expect(deletes(fetch)).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Forget memory' }));
    await vi.waitFor(() => expect(deletes(fetch)).toBe(1));
  });
});

describe('Knowledge Base › restoring an edited playbook', () => {
  it('asks with focus on Keep mine', async () => {
    const doc = { kind: 'playbook', key: 'ad_strategist', title: 'Ad Strategist playbook', chars: 9, edited: true, markdown: '# Mine' };
    stubApi((url) => (url === '/api/knowledge' ? [doc] : url.startsWith('/api/knowledge/') ? doc : undefined));
    renderApp(<Knowledge />, '/knowledge?tab=playbook');
    fireEvent.click(await screen.findByRole('button', { name: 'Restore original' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep mine' }));
  });
});
