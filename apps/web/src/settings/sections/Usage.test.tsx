// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { Store, StoreCaps, StoreUsage } from '@frontline/shared';
import { Settings } from '../../pages/Settings';
import { renderApp, stubApi } from '../../test-utils';

afterEach(() => (cleanup(), vi.unstubAllGlobals()));

const store = (id: string, name: string) => ({ id, name, platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected: false }) as Store;
const caps = (storeId: string, o: Partial<StoreCaps> = {}): StoreCaps => ({ storeId, adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, agentCostPerDay: 5, autopilot: {}, ...o });

it("Today's meters: each store's AI usage, ad budget raises and credits against its caps, credits with the renders waiting", async () => {
  const usage: StoreUsage[] = [
    { storeId: 'glow', agentCostUsd: 0.8, adBudgetAddedUsd: 40, credits: 20, creditsPending: 42, rendersPending: 2 },
    { storeId: 'peak', agentCostUsd: 0, adBudgetAddedUsd: 0, credits: 2, creditsPending: 0, rendersPending: 0 },
  ];
  stubApi((url) => {
    const u = new URL(url, 'http://x');
    if (u.pathname === '/api/stores') return [store('glow', 'Glow Haus'), store('peak', 'Peak Fit')];
    if (u.pathname === '/api/caps') return [caps('glow', { agentCostPerDay: 8 }), caps('peak', { higgsfieldCreditsPerDay: 1 })];
    if (u.pathname === '/api/usage') return usage;
    if (u.pathname === '/api/config') return { values: { timezone: 'America/Chicago' }, origins: {}, versions: {} };
    return undefined;
  });
  renderApp(<Settings />, '/settings/usage');
  expect(await screen.findByText("Since midnight in the workspace's time zone (America/Chicago).")).toBeTruthy();
  const meter = (label: string) => screen.getByRole('progressbar', { name: `${label} used today` }).nextElementSibling!.textContent;
  expect(meter('Glow Haus AI usage')).toBe('$0.80 of $8.00 used today, an estimate at list prices');
  expect(meter('Glow Haus ad budget raises')).toBe('$40 of $100 used today, approved or waiting on you');
  // Today plus pending: 20 rendered and 42 asked.
  expect(meter('Glow Haus Higgsfield credits')).toBe('62 of 200 used today, including 2 pending renders');
  expect(meter('Peak Fit Higgsfield credits')).toBe('2 of 1 used today, including 0 pending renders');
});
