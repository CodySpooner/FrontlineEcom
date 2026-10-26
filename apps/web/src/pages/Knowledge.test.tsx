// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
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
