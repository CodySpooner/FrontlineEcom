// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { KbCampaign } from '@frontline/shared';
import { Knowledge } from '../pages/Knowledge';
import { renderApp, stubApi } from '../test-utils';
import { CampaignLibrary } from './Campaigns';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STORES = [{ id: 'peak', name: 'Peak Outdoors', connected: true, platform: 'shopify', niche: 'pets', color: '#f00', currency: 'USD', timezone: 'UTC' }];
const DOG: KbCampaign = {
  network: 'meta', id: 'dog', storeId: 'peak', name: 'Dog car', status: 'active', from: '2026-08-10', to: '2026-09-06',
  spend: 2800, revenue: 8400, purchases: 60, clicks: 1000, impressions: 50_000, ads: 2, groups: 2,
  creatives: [{ id: 'k1', headline: 'Car calm', primaryText: 'Your dog hates the car?', hook: 'problem-first', format: 'ugc' }],
  experiments: [
    { id: 'e2', cardId: 'c2', status: 'planned', from: '2026-11-01', to: '2026-11-28' }, // newest first: the result is the latest read one
    { id: 'e1', cardId: 'c2', status: 'worked', from: '2026-08-10', to: '2026-09-06' },
  ],
  cards: [
    { id: 'c1', title: 'The "Dog car" campaign (Meta): ROAS above the store\'s other Meta campaigns', stage: 'tested', from: '2026-08-10', to: '2026-09-06' },
    { id: 'c3', title: 'Problem-first hooks beat product shots', stage: 'hypothesis', from: '2026-08-10', to: '2026-09-06' },
  ],
};
const IDLE: KbCampaign = { ...DOG, id: 'idle', name: 'Never ran', status: 'paused', from: undefined, to: undefined, spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0, ads: 0, groups: 0, creatives: [], experiments: [], cards: [] };

const render = (q = '', ws = 'peak') => {
  const fetch = stubApi((url) => (url === '/api/stores' ? STORES : url.startsWith('/api/kb/campaigns') ? [DOG, IDLE] : undefined));
  const set = vi.fn();
  renderApp(<CampaignLibrary ws={ws} q={q} set={set} />);
  return { set, fetch };
};
const field = (row: HTMLElement, term: string) => within(row).getByText(term, { selector: 'dt' }).nextElementSibling!.textContent;

describe('Campaigns', () => {
  it('each campaign: platform, dates, spend, ROAS, CTR and result; opened, every field, "not linked" where the data has none', async () => {
    const { set } = render();
    const [dog, idle] = [...(await screen.findByRole('list', { name: 'Campaigns' })).children] as HTMLElement[];
    expect(dog!.querySelector('summary')!.textContent).toBe('Dog carMeta · Peak Outdoors2026-08-10 – 2026-09-06$2,800 spentROAS 3.00CTR 2.00%Worked');
    expect(field(dog!, 'Products')).toBe('not linked');
    expect(field(dog!, 'Creatives')).toBe('Car calm · UGC · hook: problem-first');
    expect(field(dog!, 'Copy and hooks')).toBe('"Your dog hates the car?" (problem-first)');
    expect(field(dog!, 'Audiences')).toBe("2 ad sets: their targeting isn't synced");
    expect(field(dog!, 'Metrics')).toBe('$2,800 spent · $8,400 revenue · ROAS 3.00 · 60 purchases · CTR 2.00% · 2 ads');
    expect(field(dog!, 'Result')).toBe('Worked (test of 2026-08-10 – 2026-09-06)');
    expect(field(dog!, 'Knowledge')).toContain('Experimentally Tested · measured 2026-08-10 – 2026-09-06');
    fireEvent.click(within(dog!).getByRole('button', { name: /campaign \(Meta\): ROAS above/ }));
    expect(set).toHaveBeenLastCalledWith({ tab: undefined, ws: 'peak', card: 'c1' });
    fireEvent.click(within(dog!).getByRole('button', { name: 'Plan a test: Problem-first hooks beat product shots' }));
    expect(set).toHaveBeenLastCalledWith({ tab: undefined, ws: 'peak', card: 'c3', plan: '1' });

    expect(idle!.querySelector('summary')!.textContent).toBe('Never ranMeta · Peak OutdoorsNo spend synced$0 spentROAS –CTR –No test yet');
    for (const [term, text] of [['Creatives', 'not linked'], ['Copy and hooks', 'not linked'], ['Audiences', 'not linked'], ['Result', 'No test yet'], ['Knowledge', 'Nothing learned from it yet.']])
      expect(field(idle!, term!)).toBe(text);
    expect(field(idle!, 'Recommended tests')).toBe('None yet: a Hypothesis about it would be one.');
  });

  it('searches names, platforms, creatives, hooks and what was learned', async () => {
    render('PROBLEM-first');
    expect((await screen.findByRole('list', { name: 'Campaigns' })).children).toHaveLength(1);
    cleanup();
    render('hates the car');
    expect((await screen.findByRole('list', { name: 'Campaigns' })).children).toHaveLength(1);
    cleanup();
    render('nothing like it');
    expect(await screen.findByText('No campaign matches "nothing like it".')).toBeTruthy();
  });

  it('General has no campaigns: they belong to a store', async () => {
    const { fetch } = render('', 'general');
    expect(await screen.findByText('Campaigns belong to a store: pick one, or All workspaces.')).toBeTruthy();
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/kb/campaigns'))).toBe(false);
  });

  it("is the Library's Campaigns tab", async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    stubApi((url) => (url === '/api/stores' ? STORES : url.startsWith('/api/kb/campaigns?ws=peak') ? [DOG] : undefined));
    renderApp(<Knowledge />, '/knowledge?view=library&ws=peak&tab=campaigns');
    expect((await screen.findByRole('tab', { name: 'Campaigns' })).getAttribute('aria-selected')).toBe('true');
    expect((await screen.findByRole('list', { name: 'Campaigns' })).children).toHaveLength(1);
  });
});
