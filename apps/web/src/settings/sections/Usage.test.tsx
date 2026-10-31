// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ConfigView, Store, StoreCaps, StoreUsage } from '@frontline/shared';
import { Settings } from '../../pages/Settings';
import { renderApp, stubApi } from '../../test-utils';

afterEach(() => (cleanup(), vi.unstubAllGlobals()));

const store = (id: string, name: string) => ({ id, name, platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected: false }) as Store;
const STORES = [store('glow', 'Glow Haus'), store('peak', 'Peak Fit')];
const caps = (storeId: string, o: Partial<StoreCaps> = {}): StoreCaps => ({ storeId, adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, agentCostPerDay: 5, autopilot: {}, ...o });
const AD = 'caps.adSpendChangePerDay';
const CREDITS = 'caps.higgsfieldCreditsPerDay';
const DEFAULTS = { [AD]: 100, [CREDITS]: 200 };

type Values = Record<string, number>;
/** GET /api/config's answer: a store's own caps over the workspace's, each with its origin, the built-in ones under both. */
function view(ws: Values, own?: Values, storeId?: string): ConfigView {
  const v: ConfigView = { values: { timezone: 'UTC' }, origins: {}, versions: { workspace: 3, ...(storeId ? { [`store_caps:${storeId}`]: 7 } : {}) } };
  for (const [id, d] of Object.entries(DEFAULTS)) {
    const [value, origin] = own?.[id] !== undefined ? [own[id], 'store'] : ws[id] !== undefined ? [ws[id], 'workspace'] : [d, 'default'];
    v.values[id] = value;
    v.origins[id] = origin as ConfigView['origins'][string];
  }
  return v;
}

function api({ ws = {} as Values, own = {} as Record<string, Values>, extra = (_url: URL): unknown => undefined } = {}) {
  const calls: { method: string; url: string; body?: { documents: { doc: string; set?: Values }[] } }[] = [];
  stubApi((url, init) => {
    const u = new URL(url, 'http://x');
    const method = init?.method ?? 'GET';
    calls.push({ method, url: `${u.pathname}${u.search}`, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const s = u.searchParams.get('store') ?? undefined;
    if (u.pathname === '/api/config' && method === 'PATCH') return view(ws, s ? own[s] : undefined, s);
    if (u.pathname === '/api/config/impact') {
      // The server's sentence per cap, counted from this fixture's stores (config/impact.ts `workspaceDefault`).
      return {
        impacts: calls.at(-1)!.body!.documents.flatMap((d) =>
          d.doc !== 'workspace'
            ? []
            : Object.keys(d.set ?? {}).map((id) => {
                const kept = STORES.filter((x) => own[x.id]?.[id] !== undefined).length;
                const take = STORES.length - kept;
                return { setting: id, text: `Applies to ${take} store${take === 1 ? ' that uses' : 's that use'} the workspace default; ${kept} store${kept === 1 ? ' has its' : 's have their'} own value` };
              }),
        ),
      };
    }
    if (u.pathname === '/api/config') return view(ws, s ? own[s] : undefined, s);
    if (u.pathname === '/api/stores') return STORES;
    if (u.pathname === '/api/caps') return STORES.map((x) => caps(x.id));
    if (u.pathname === '/api/usage') return STORES.map((x) => ({ storeId: x.id, agentCostUsd: 0, adBudgetAddedUsd: 0, credits: 0 }));
    return extra(u);
  });
  return calls;
}
const row = (id: string) => document.getElementById(id)!;
const saved = (calls: ReturnType<typeof api>) => calls.filter((c) => c.method === 'PATCH').map((c) => c.body);

it("Today's meters: each store's AI usage, ad budget raises and credits against its caps, credits with the renders waiting", async () => {
  const usage: StoreUsage[] = [
    { storeId: 'glow', agentCostUsd: 0.8, adBudgetAddedUsd: 40, credits: 20, creditsPending: 42, rendersPending: 2 },
    { storeId: 'peak', agentCostUsd: 0, adBudgetAddedUsd: 0, credits: 2, creditsPending: 0, rendersPending: 0 },
  ];
  stubApi((url) => {
    const u = new URL(url, 'http://x');
    if (u.pathname === '/api/stores') return STORES;
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

it('Workspace daily caps edits each workspace default, with the impact counted from the stores', async () => {
  const calls = api({ ws: { [AD]: 150 }, own: { glow: { [AD]: 80 } } });
  renderApp(<Settings />, '/settings/usage');
  expect(await screen.findByRole('heading', { name: 'Workspace daily caps' })).toBeTruthy();
  const ad = (await screen.findByRole('spinbutton', { name: 'Ad budget changes per day' })) as HTMLInputElement;
  expect(row(AD).contains(ad)).toBe(true);
  const credits = within(row(CREDITS)).getByRole('spinbutton', { name: 'Higgsfield credits per day' }) as HTMLInputElement;
  expect([ad.value, credits.value, credits.placeholder]).toEqual(['150', '', '200']); // the credits cap is the built-in one
  fireEvent.change(ad, { target: { value: '120' } });
  fireEvent.change(credits, { target: { value: '300' } });
  expect(await screen.findByText('Ad budget changes per day: Applies to 1 store that uses the workspace default; 1 store has its own value')).toBeTruthy();
  expect(screen.getByText('Higgsfield credits per day: Applies to 2 stores that use the workspace default; 0 stores have their own value')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(saved(calls)).toEqual([{ documents: [{ doc: 'workspace', version: 3, set: { [AD]: 120, [CREDITS]: 300 } }] }]));
});

it("a store's caps show their origins: inherited, or its own with the workspace's value and Use workspace default", async () => {
  const calls = api({ ws: { [CREDITS]: 250 }, own: { glow: { [CREDITS]: 90 } } });
  renderApp(<Settings />, '/settings/usage?store=glow');
  expect(await screen.findByRole('heading', { name: 'Glow Haus daily caps' })).toBeTruthy();
  const ad = within(row(AD)).getByRole('spinbutton') as HTMLInputElement;
  expect([ad.value, ad.placeholder]).toEqual(['', '100']);
  expect(within(row(AD)).getByText('Using workspace default')).toBeTruthy();
  expect((within(row(CREDITS)).getByRole('spinbutton') as HTMLInputElement).value).toBe('90');
  expect(within(row(CREDITS)).getByText('Customized for this store · workspace default 250 credits')).toBeTruthy();
  // Today shows the store in scope only.
  expect(screen.getByRole('progressbar', { name: 'Glow Haus AI usage used today' })).toBeTruthy();
  expect(screen.queryByRole('progressbar', { name: 'Peak Fit AI usage used today' })).toBeNull();
  fireEvent.click(within(row(CREDITS)).getByRole('button', { name: 'Use workspace default' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(saved(calls)).toEqual([{ documents: [{ doc: 'store_caps', storeId: 'glow', version: 7, unset: [CREDITS] }] }]));
});

it('how AI limits stack, the limits Frontline sets as served, and the cost so far with what Frontline cannot read', async () => {
  api({
    extra: (u) =>
      u.pathname === '/api/config/limits'
        ? [{ label: 'An ad budget raise', value: 'at most 30% a step' }]
        : u.pathname === '/api/ecosystem/stats'
          ? { activeTasks: 0, completedTasks: 9, failedTasks: 1, successRate: 0.9, activeTeams: 0, inputTokens: 1_200_000, outputTokens: 34_000, costUsd: 12.345 }
          : undefined,
  });
  renderApp(<Settings />, '/settings/usage?store=glow');
  await screen.findByRole('heading', { name: 'Glow Haus daily caps' }); // the stores are in
  const section = async (name: string) => (await screen.findByRole('heading', { name })).closest('section')!;
  const stack = await section('How AI limits stack');
  const href = (name: string) => within(stack).getByRole('link', { name }).getAttribute('href');
  expect(href('Agents & Providers')).toBe('/settings/agents?store=glow#caps.agentCostPerDay');
  expect(href('AI Agents, the agent')).toBe('/agents?store=glow');
  expect(href('Knowledge, Research Center')).toBe('/knowledge?view=research');
  const set = await section('Limits Frontline sets');
  expect(await within(set).findByText('at most 30% a step')).toBeTruthy();
  expect(within(set).queryByRole('spinbutton')).toBeNull(); // read-only
  const cost = await section('Cost so far');
  expect(await within(cost).findByText('$12.35')).toBeTruthy();
  expect(within(cost).getByText('1,200,000 in · 34,000 out')).toBeTruthy();
  expect(within(cost).getByText("Not available: Frontline can't read your Claude or Codex bill.")).toBeTruthy();
});
