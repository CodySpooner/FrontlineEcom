// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ApprovalRequest, Store } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { DemoMixNote } from '../components/StoreFilter';
import { Outlet, Route, Routes } from 'react-router';
import { LiveActivity, Missions, profitFormula, Requests } from './Dashboard';

const store = { id: 'pawsome', name: 'Pawsome Gear', currency: 'USD' } as Store;
const approval: ApprovalRequest = {
  id: 'a1',
  storeId: 'pawsome',
  agentId: 'pawsome:ad_strategist',
  title: 'Raise daily budget 20%',
  reason: 'ROAS above 3.0 for 5 days',
  action: { kind: 'ads.set_budget', payload: {}, amountUsd: 12 },
  status: 'pending',
  createdAt: '2026-10-26T08:00:00Z',
};

/** Fake API: the pending request, its store and agent; the decide POST answers with `decideStatus`. */
function serve(decideStatus: number) {
  const fetch = stubApi((url, init) => {
    if (init?.method === 'POST') return decideStatus === 200 ? { ...approval, status: 'approved' } : reply({ error: 'nope' }, decideStatus);
    if (url.startsWith('/api/approvals?status=pending')) return [approval];
    if (url.startsWith('/api/stores')) return [store];
    if (url.startsWith('/api/agents')) return [{ id: approval.agentId, storeId: 'pawsome', role: 'ad_strategist' }];
  });
  renderApp(<Requests />);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('approvals flow', () => {
  it('shows the request with its kind, reason and money at stake', async () => {
    serve(200);
    expect(await screen.findByText('Raise daily budget 20%')).toBeTruthy();
    expect(screen.getByText(/Change ad budgets/)).toBeTruthy();
    expect(screen.getByText(/\$12\/day at stake/)).toBeTruthy();
    expect(screen.getByText('1 waiting')).toBeTruthy();
  });

  it('approves: posts the verdict and shows it', async () => {
    const fetch = serve(200);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Raise daily budget 20%' }));
    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/approvals/a1/approve', { method: 'POST' });
    expect(screen.getByText('all clear')).toBeTruthy();
  });

  it('denies with the reason the owner gives, so the squad learns why', async () => {
    const fetch = serve(200);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny: Raise daily budget 20%' }));
    fireEvent.change(screen.getByLabelText('Why deny Raise daily budget 20%?'), { target: { value: ' Too early in the month ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deny: Raise daily budget 20%' }));
    expect(await screen.findByText('Denied')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/approvals/a1/deny', expect.objectContaining({ method: 'POST', body: '{"note":"Too early in the month"}' }));
  });

  it('puts the buttons back and says so when the verdict fails', async () => {
    serve(500);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny: Raise daily budget 20%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deny: Raise daily budget 20%' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny: Raise daily budget 20%' })).toBeTruthy();
  });
});

describe('profitFormula', () => {
  const store = (extra: Partial<Store>) => ({ id: 's', name: 'S', platform: 'shopify', connected: false, ...extra }) as Store;

  it('names only what comes off for the stores picked', () => {
    expect(profitFormula([store({})])).toBe('Revenue − cost of goods − ad spend');
    expect(profitFormula([store({ feePercent: 9.5 })])).toBe('Revenue − cost of goods − your fee estimate − ad spend');
    // Order tax is read from connected Shopify, WooCommerce, Etsy and TikTok Shop stores only.
    expect(profitFormula([store({ connected: true, platform: 'etsy' })])).toBe('Revenue − cost of goods − sales tax − ad spend');
    expect(profitFormula([store({ connected: true, platform: 'tiktok_shop' })])).toBe('Revenue − cost of goods − sales tax − ad spend');
    expect(profitFormula([store({ connected: true, platform: 'amazon' })])).toBe('Revenue − cost of goods − ad spend');
  });
});

describe('demo numbers in real totals', () => {
  const stores = (...connected: boolean[]) =>
    stubApi((url) => (url === '/api/stores' ? connected.map((c, i) => ({ ...store, id: `s${i}`, name: ['Real Co', 'Pawsome Gear', 'Glow Haus'][i], connected: c })) : undefined));

  it('names the demo stores when they share totals with a connected one', async () => {
    stores(true, false, false);
    renderApp(<DemoMixNote />);
    const note = await screen.findByText(/Pawsome Gear and Glow Haus show demo numbers/);
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/settings');
  });

  it.each([[[false, false]], [[true]]])('stays out of the way when every store is the same kind (%j)', async (connected) => {
    stores(...connected);
    renderApp(<DemoMixNote />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/demo numbers/)).toBeNull();
  });
});

describe('Autopilot · last 24h', () => {
  it('says how many more autopilot approved past the 3 it lists', async () => {
    const now = new Date().toISOString();
    const auto = Array.from({ length: 5 }, (_, i) => ({ ...approval, id: `auto${i}`, title: `Auto change ${i + 1}`, status: 'approved', decidedAt: now, action: { ...approval.action, auto: true } }));
    stubApi((url) => (url.startsWith('/api/stores') ? [store] : url.includes('status=approved') ? auto : []));
    renderApp(<Requests />);
    await screen.findByText('Auto change 3', { exact: false });
    expect(screen.queryByText('Auto change 4', { exact: false })).toBeNull();
    expect(screen.getByText('+2 more in the last 24h')).toBeTruthy();
  });
});

describe('Daily Missions', () => {
  it("shows the first 8 and lets the owner see the rest, so a third store's missions aren't cut off", async () => {
    const missions = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, storeId: 'pawsome', title: `Mission ${i + 1}`, progress: 0, target: 2, xp: 40 }));
    stubApi((url) => (url.startsWith('/api/stores') ? [store] : url.startsWith('/api/missions') ? missions : []));
    renderApp(<Missions />);
    await screen.findByText('Mission 8');
    expect(screen.queryByText('Mission 9')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 12' }));
    expect(screen.getByText('Mission 12')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.queryByText('Mission 12')).toBeNull();
  });
});

describe('Live Store Activity', () => {
  it("doesn't claim to be live while the app's live connection is down", async () => {
    stubApi(() => []);
    renderApp(
      <Routes>
        <Route element={<Outlet context={false} />}>
          <Route path="/" element={<LiveActivity />} />
        </Route>
      </Routes>,
    );
    expect(await screen.findByText('Reconnecting…')).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
  });
});

describe('backing out of a deny', () => {
  it('puts focus back on Deny rather than dropping it to the page', async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [store] : url.startsWith('/api/approvals?status=pending') ? [approval] : []));
    renderApp(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: `Deny: ${approval.title}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Deny: ${approval.title}` }));
  });
});

describe('deciding a request from the keyboard', () => {
  it('moves focus on to the next request still waiting, not back to the top of the page', async () => {
    const asks = ['A', 'B', 'C'].map((t, i) => ({ ...approval, id: `a${i + 1}`, title: `Pause ${t}` }));
    stubApi((url, init) => (init?.method === 'POST' ? { ...approval, status: 'approved' } : url.startsWith('/api/stores') ? [store] : url.startsWith('/api/approvals?status=pending') ? asks : []));
    renderApp(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Pause A' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve: Pause B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve: Pause C' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve: Pause B' }));
  });
});
