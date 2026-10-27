// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderApp, stubApi } from '../test-utils';
import { Knowledge } from './Knowledge';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    renderApp(<Knowledge />, '/knowledge');
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
