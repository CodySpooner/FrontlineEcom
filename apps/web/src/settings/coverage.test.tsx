// @vitest-environment jsdom
// Decision 5 test 2, "no decorative switches": every control on a settings page is tied to a registry entry
// (`data-setting`), a connector's secret field (`data-secret`) or a named, tested action (`data-action`), and every
// editable entry renders somewhere unless it's on the allowlist. Controls inside `data-legacy` (panels moved as they
// were by ST-02) are skipped until the item that replaces them deletes the wrapper. So are a `<dialog>`'s: the form's
// leave and conflict prompts (Stay, Discard, Save, Reload, Keep mine), proven in form.test.tsx.
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { INTEGRATION_KINDS, SETTINGS, type Settings as SettingsT, type Store, type StoreCaps } from '@frontline/shared';
import { Settings } from '../pages/Settings';
import { renderApp, stubApi } from '../test-utils';
import { SECTIONS } from './Layout';

/** Editable entries with no row outside `data-legacy` yet. The item that renders a row removes its id; ST-48 empties it. */
const ALLOWLIST = [
  'caps.agentCostPerDay', // ST-23
  'caps.adSpendChangePerDay', 'caps.higgsfieldCreditsPerDay', // ST-24b
  'autopilot.ads.set_budget', 'autopilot.ads.pause_campaign', // ST-30
  'kb.autonomous', 'kb.roles', 'kb.triggers', 'kb.taskBudgetUsd', 'kb.dailyBudgetUsd', 'kb.depth', 'kb.approval', 'kb.review', 'kb.trustedDomains', 'kb.blockedDomains', 'kb.freshDays', 'kb.retentionDays', // ST-25
  'pr.audience', 'pr.priceMax', 'pr.shipTo', 'pr.warehouses', 'pr.maxDeliveryDays', 'pr.includeCategories', 'pr.keywords', // ST-27
];

/** `data-action` names, each with the test that proves what it does (`path#test name`). */
const ACTIONS: Record<string, string> = {
  'settings.advanced': 'apps/web/src/settings/kit.test.tsx#the Advanced expander is a real button that shows and hides its rows',
  'settings.scope': 'apps/web/src/settings/sections/Agents.test.tsx#the scope switch edits one store: its values, under ?store=',
  'agents.claude.check': 'apps/web/src/settings/sections/Agents.test.tsx#Check again asks the Claude login again and shows what it says',
  'agents.codex.setup': "apps/web/src/settings/sections/Agents.test.tsx#Set up Codex starts the sign-in on the app's Codex folder, then Check again reads it",
  'agents.codex.check': "apps/web/src/settings/sections/Agents.test.tsx#Set up Codex starts the sign-in on the app's Codex folder, then Check again reads it",
  'notifications.test': 'apps/web/src/settings/sections/Notifications.test.tsx#Send test shows what the server decided, and says where toasts appear',
  'stores.add': "apps/web/src/settings/sections/Stores.test.tsx#Add store says what adding does, then opens the new store's page",
  'stores.delete': "apps/web/src/settings/sections/Stores.test.tsx#Delete stays off until the store's name is typed, says what goes and what stays, and sends the name",
};

const root = `${process.cwd()}/`; // vitest runs from the repo root
const CONTROLS = 'input, select, textarea, button, [role="switch"], [role="radio"], [role="checkbox"], [role="tab"], [role="combobox"]';
const SECRETS = new Set(Object.entries(INTEGRATION_KINDS).flatMap(([kind, k]) => k.fields.filter((f) => f.secret).map((f) => `${kind}.${f.key}`)));

const settings: SettingsT = { profile: { name: 'Cody', plan: 'Pro Plan' }, notifications: { approvals: true, agentDone: true, errors: true, digest: true, researchAlerts: true }, baseCurrency: 'USD', dataDir: 'C:/data' };
const peak = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC', connected: false } as Store;
const caps: StoreCaps = { storeId: 'peak', adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, agentCostPerDay: 5, autopilot: {} };

const rendered = new Set<string>();
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

describe('every control on a settings page is real', () => {
  // Plus the pages under a section: a store's (ST-18).
  it.each([...SECTIONS.map((s) => s.slug), 'stores/peak'].map((s) => [s]))('/settings/%s', async (slug) => {
    stubApi((url) => {
      if (url === '/api/settings') return settings;
      if (url === '/api/config') return { values: {}, origins: {}, versions: { app: 1 } };
      if (url === '/api/stores') return [peak];
      if (url === '/api/stores/peak/impact') return { removes: [], keeps: [] };
      if (url.startsWith('/api/caps')) return caps;
      if (url === '/api/health') return { ok: true, uptimeSec: 1, version: 'dev', connectors: [] };
      if (url === '/api/runtimes') return ['claude', 'codex'].map((runtime) => ({ runtime, connected: runtime === 'claude', ...(runtime === 'codex' ? { reason: 'Set up Codex' } : {}), source: 'registry', checkedAt: '', models: [{ id: 'm', label: 'M', efforts: ['low', 'high'], default: true }] }));
    });
    renderApp(<Settings />, `/settings/${slug}`);
    const main = () => document.querySelector('section[aria-labelledby="settings-title"]')!;
    // Every section has at least one control once its data is in (each card's, when it has several).
    await vi.waitFor(() => expect([main().querySelector(CONTROLS), main().querySelector('[aria-label="Loading"]')]).toEqual([expect.anything(), null]));
    for (const el of main().querySelectorAll<HTMLElement>(CONTROLS)) {
      if (el.closest('[data-legacy], dialog')) continue;
      const tag = el.closest<HTMLElement>('[data-setting], [data-secret], [data-action]');
      expect(tag, `a control with no data-setting, data-secret or data-action on /settings/${slug}: ${el.outerHTML.slice(0, 160)}`).not.toBeNull();
      const { setting, secret, action } = tag!.dataset;
      if (setting) {
        expect(SETTINGS.some((d) => d.id === setting && !d.locked), `data-setting="${setting}" isn't an editable registry entry`).toBe(true);
        rendered.add(setting);
      }
      if (secret) expect(SECRETS.has(secret), `data-secret="${secret}" isn't a connector's secret field`).toBe(true);
      if (action) expect(ACTIONS[action], `data-action="${action}" needs a test in ACTIONS`).toBeDefined();
    }
  });

  it('every editable entry renders, or is on the allowlist; nothing on the allowlist renders yet', () => {
    const editable = SETTINGS.filter((d) => !d.locked).map((d) => d.id);
    expect(ALLOWLIST.filter((id) => !editable.includes(id)), 'allowlisted ids that are no registry entry').toEqual([]);
    expect(editable.filter((id) => !rendered.has(id) && !ALLOWLIST.includes(id)), 'editable entries with no row: render them or allowlist them').toEqual([]);
    expect(ALLOWLIST.filter((id) => rendered.has(id)), 'rendered now: remove them from ALLOWLIST').toEqual([]);
  });

  it.each(Object.entries(ACTIONS))('action %s has its test', (_, proof) => {
    const [path, name] = proof.split(/#(.*)/s) as [string, string];
    expect(existsSync(root + path) && readFileSync(root + path, 'utf8').includes(name), proof).toBe(true);
  });
});
