// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Settings as SettingsT, StoreCaps } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Backups, CapsForm, Settings } from './Settings';

const caps: StoreCaps = { storeId: 'peak', adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, agentCostPerDay: 5, autopilot: {} };
const amount = () => screen.getByLabelText('Change ad budgets: most per day in dollars');
const puts = (fetch: ReturnType<typeof stubApi>) => fetch.mock.calls.filter(([, init]) => init?.method === 'PUT');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('caps form', () => {
  it("won't send an autopilot rule with a blank amount", async () => {
    const fetch = stubApi(() => undefined);
    renderApp(<CapsForm caps={caps} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Change ad budgets' }));
    fireEvent.change(amount(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save caps' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(puts(fetch)).toHaveLength(0);
  });

  it('turning a rule off with a blank amount saves it as 0', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PUT' ? caps : undefined));
    renderApp(<CapsForm caps={caps} />);
    const rule = screen.getByRole('switch', { name: 'Change ad budgets' });
    fireEvent.click(rule);
    fireEvent.change(amount(), { target: { value: '' } });
    fireEvent.click(rule);
    fireEvent.click(screen.getByRole('button', { name: 'Save caps' }));
    await vi.waitFor(() => expect(puts(fetch)).toHaveLength(1));
    expect(JSON.parse(String(puts(fetch)[0]![1]!.body)).autopilot['ads.set_budget']).toEqual({ enabled: false, maxUsdPerDay: 0 });
  });
});

describe('backups', () => {
  it('marks the copy taken before an update', async () => {
    stubApi((url) =>
      url === '/api/backups'
        ? [
            { name: 'frontline-2026-10-26T10-20-24.db', size: 2e6, createdAt: '2026-10-26T10:20:24Z' },
            { name: 'frontline-2026-10-26T09-00-00-before-update.db', size: 2e6, createdAt: '2026-10-26T09:00:00Z' },
          ]
        : undefined,
    );
    renderApp(<Backups />);
    expect(await screen.findAllByText('Before update')).toHaveLength(1);
  });
});

describe('your data', () => {
  const settings: SettingsT = { profile: { name: 'Cody', plan: 'Pro Plan' }, sound: false, notifications: { approvals: true, agentDone: true, errors: true, digest: true }, baseCurrency: 'USD', dataDir: 'C:/data' };
  it.each([
    ['0.1.3', 'Version 0.1.3'],
    ['dev', 'Development build'],
  ])('shows the running version %s', async (version, text) => {
    stubApi((url) => (url === '/api/settings' ? settings : url === '/api/health' ? { ok: true, uptimeSec: 1, version, connectors: [] } : undefined));
    renderApp(<Settings />, '/settings');
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("opens the data folder through the desktop app when it's there, and shows Windows' error", async () => {
    const fetch = stubApi((url) => (url === '/api/settings' ? settings : undefined));
    const openDataFolder = vi.fn(async () => 'The system cannot find the path specified.');
    vi.stubGlobal('desktop', { openDataFolder });
    renderApp(<Settings />, '/settings');
    fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }));
    expect((await screen.findByRole('alert')).textContent).toContain('cannot find the path');
    expect(openDataFolder).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.some(([url]) => String(url).includes('open-data-folder'))).toBe(false);
  });
});

describe('Caps with no stores', () => {
  it('says caps come with a store instead of loading forever', async () => {
    const settings: SettingsT = { profile: { name: 'Cody', plan: 'Pro Plan' }, sound: false, notifications: { approvals: true, agentDone: true, errors: true, digest: true }, baseCurrency: 'USD', dataDir: 'C:/data' };
    stubApi((url) => (url === '/api/stores' ? [] : url === '/api/settings' ? settings : undefined));
    renderApp(<Settings />, '/settings');
    expect(await screen.findByText('Caps are set per store: add a store above, then set its limits here.')).toBeTruthy();
  });
});
