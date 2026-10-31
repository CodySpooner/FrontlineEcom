// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { settingsUrl, type Settings as SettingsT, type Store, type StoreCaps } from '@frontline/shared';
import { App } from '../App';
import { budgetFix } from '../lib/usage';
import { SECTIONS } from '../settings/Layout';
import { renderApp, stubApi } from '../test-utils';
import { Settings } from './Settings';

const settings: SettingsT = { profile: { name: 'Cody', plan: 'Pro Plan' }, notifications: { approvals: true, agentDone: true, errors: true, digest: true, researchAlerts: true }, baseCurrency: 'EUR', dataDir: 'C:/data' };
const peak = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC', connected: false } as Store;
const glow = { ...peak, id: 'glow', name: 'Glow Haus' } as Store;
const caps: StoreCaps = { storeId: 'peak', adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, agentCostPerDay: 5, autopilot: {} };
/** The section title (Settings' own h2, not a panel's). */
const titled = (label: string) => vi.waitFor(() => expect(document.getElementById('settings-title')?.textContent).toBe(label));
const api = (extra: (url: string) => unknown = () => undefined) =>
  stubApi((url, init) => {
    if (init?.method === 'PATCH' && url === '/api/settings') return settings;
    if (url === '/api/settings') return settings;
    if (url === '/api/config' || url.startsWith('/api/config?')) return { values: { baseCurrency: 'EUR', timezone: 'UTC' }, origins: {}, versions: { app: 1, workspace: 1 } };
    if (url === '/api/stores') return [peak, glow];
    if (url.startsWith('/api/kb/controls?')) return { autonomous: false, roles: {}, triggers: [], taskBudgetUsd: 1, dailyBudgetUsd: 3, depth: 'standard', approval: true, review: true, trustedDomains: [], blockedDomains: [], freshDays: {}, retentionDays: null, reservedUsd: 0, version: 0 };
    if (url.startsWith('/api/caps')) return [{ ...caps, storeId: new URL(url, 'http://x').searchParams.get('stores') ?? 'peak' }]; // GET /api/caps answers a list
    return extra(url) ?? (url === '/api/health' ? { ok: true, uptimeSec: 1, version: 'dev', connectors: [] } : undefined);
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('routes and deep links', () => {
  it('/settings lands on General, showing the display currency', async () => {
    api();
    renderApp(<Settings />, '/settings');
    expect(screen.getByTestId('where').textContent).toBe('/settings/general');
    expect(((await screen.findByLabelText('Display currency')) as HTMLSelectElement).value).toBe('EUR');
  });

  it('a section with no content yet is absent from the sidebar and lands on General, keeping the query', async () => {
    api();
    renderApp(<Settings />, '/settings/history?store=peak');
    expect(screen.getByTestId('where').textContent).toBe('/settings/general?store=peak');
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    await within(nav).findByRole('link', { name: 'Stores2' });
    expect(within(nav).queryByRole('link', { name: /History/ })).toBeNull();
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Account', 'Appearance', 'Notifications', 'General', 'Stores2', 'Agents & Providers', 'Integrations', 'Knowledge', 'Product Research', 'Automation & Approvals', 'Usage & Limits', 'Data & Backups']);
  });

  it.each(SECTIONS.map((s) => [s.slug, s.label]))('/settings/%s renders its section', async (slug, label) => {
    api();
    renderApp(<Settings />, `/settings/${slug}`);
    await titled(label);
    expect(within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('link', { name: new RegExp(`^${label}`) }).getAttribute('aria-current')).toBe('page');
  });

  it('/integrations moves to /settings/integrations, keeping its query', async () => {
    api();
    renderApp(<App />, '/integrations?x=1');
    await titled('Integrations');
    expect(screen.getByTestId('where').textContent).toBe('/settings/integrations?x=1');
  });

  it('a deep link opens its section with its store selected, and the store carries over to other sections', async () => {
    api();
    renderApp(<Settings />, settingsUrl('usage', { store: 'glow', setting: 'caps.agentCostPerDay' }));
    expect(await screen.findByRole('heading', { name: 'Glow Haus daily caps' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Stores2' }).getAttribute('href')).toBe('/settings/stores?store=glow');
  });

  it('links into Settings point at the section that holds their content', () => {
    expect(settingsUrl('integrations', { id: 'x', setting: 'y' })).toBe('/settings/integrations/x#y');
    expect(settingsUrl('usage', { store: 'a b' })).toBe('/settings/usage?store=a%20b');
    expect(budgetFix("Today's AI budget for this store ($5) is used up. Raise it in Settings.", 'glow:copywriter')?.to).toBe('/settings/agents?store=glow#caps.agentCostPerDay');
    expect(budgetFix("Claude isn't signed in on this computer.", 'glow:copywriter')?.to).toBe('/settings/agents');
  });

  it('the Hero chip opens Account', async () => {
    api();
    renderApp(<Settings />, '/settings/general');
    expect((await screen.findByRole('link', { name: /Cody/ })).getAttribute('href')).toBe('/settings/account');
  });
});

describe('inside the app shell', () => {
  it('lights Integrations on its routes and Settings on the rest', async () => {
    api();
    renderApp(<App />, '/settings/integrations');
    await titled('Integrations');
    const main = screen.getByRole('navigation', { name: 'Main' });
    const lit = () => within(main).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent);
    expect(lit()).toEqual(['Integrations']);
    expect(within(main).getByRole('link', { name: 'Integrations' }).getAttribute('href')).toBe('/settings/integrations');
    fireEvent.click(await within(screen.getByRole('navigation', { name: 'Settings' })).findByRole('link', { name: 'Stores2' }));
    await titled('Stores');
    expect(lit()).toEqual(['Settings']);
  });

  it('keeps one Settings element mounted across sections', async () => {
    api();
    renderApp(<App />, '/settings/account');
    await titled('Account');
    const sidebar = screen.getByRole('navigation', { name: 'Settings' });
    fireEvent.click(within(sidebar).getByRole('link', { name: 'General' }));
    await titled('General');
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBe(sidebar);
  });
});

describe('sidebar badges come from real data', () => {
  it('counts stores, and shows integration issues only when a sync failed', async () => {
    api((url) => (url === '/api/integrations' ? [{ id: 'shopify:peak', kind: 'shopify', storeId: 'peak', status: 'error', settings: {}, secretsSet: [], updatedAt: '' }] : undefined));
    renderApp(<Settings />, '/settings/general');
    expect(await screen.findByRole('link', { name: 'Integrations1 issue' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Stores2' })).toBeTruthy();
  });
});

// Deleting a store: settings/sections/Stores.test.tsx (ST-19's danger zone).
