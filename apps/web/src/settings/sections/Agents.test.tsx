// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import type { ConfigView, PrAgentRow, Store } from '@frontline/shared';
import { CreateTeam } from '../../agents/CreateTeam';
import { Deploy } from '../../agents/Deploy';
import { ResearchDialog } from '../../product-research/ResearchDialog';
import { Settings } from '../../pages/Settings';
import { renderApp, reply, stubApi } from '../../test-utils';

afterEach(() => (cleanup(), vi.unstubAllGlobals()));

const store = (id: string, name: string, connected: boolean) => ({ id, name, platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected }) as Store;
const STORES = [store('glow', 'Glow Haus', true), store('peak', 'Peak Fit', false)];
const at = '2026-10-30T08:00:00Z';
const CLAUDE = {
  runtime: 'claude', connected: true, source: 'discovered', checkedAt: at,
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', default: true },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: [] },
  ],
};
const codexRow = (reason?: string) => ({ runtime: 'codex', connected: !reason, ...(reason ? { reason } : {}), source: 'discovered', checkedAt: at, models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high', 'ultra'], defaultEffort: 'low', default: true }] });

type Values = Record<string, unknown>;
/** GET /api/config's answer: a store's own values over the workspace's, each with its origin. */
function view(ws: Values, own?: Values, storeId?: string): ConfigView {
  const v: ConfigView = { values: {}, origins: {}, versions: { workspace: 3, ...(storeId ? { [`store_caps:${storeId}`]: 7 } : {}) } };
  for (const k of ['runtime', 'model', 'effort', 'stopAfterMin', 'knowledge']) {
    const id = `agentDefaults.${k}`;
    const [value, origin] = own?.[k] !== undefined ? [own[k], 'store'] : ws[k] !== undefined ? [ws[k], 'workspace'] : [null, 'default'];
    v.values[id] = value;
    v.origins[id] = origin as ConfigView['origins'][string];
  }
  // The run limits: workspace only, with their registry defaults.
  for (const [k, d] of [['retries', 2], ['atOnce', 3], ['perStore', 2]] as const) {
    v.values[`runs.${k}`] = ws[k] ?? d;
    v.origins[`runs.${k}`] = ws[k] === undefined ? 'default' : 'workspace';
  }
  return v;
}

function api({ ws = {} as Values, own = {} as Record<string, Values>, signedIn = true, forced = false, codex = 'Set up Codex', refuse = undefined as object | undefined } = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  let codexNow: string | undefined = codex;
  stubApi((url, init) => {
    const u = new URL(url, 'http://x');
    const method = init?.method ?? 'GET';
    calls.push({ method, url: `${u.pathname}${u.search}`, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const s = u.searchParams.get('store') ?? undefined;
    if (u.pathname === '/api/config' && method === 'PATCH') return refuse ? reply(refuse, 400) : view(ws, s ? own[s] : undefined, s);
    if (u.pathname === '/api/config/impact') return { impacts: [{ setting: 'agentDefaults.model', text: 'Applies to new runs on Glow Haus; 2 running runs keep their settings' }] };
    if (u.pathname === '/api/config') return view(ws, s ? own[s] : undefined, s);
    if (u.pathname === '/api/stores') return STORES;
    if (u.pathname === '/api/runtimes') return [CLAUDE, codexRow(u.searchParams.get('refresh') ? (codexNow = undefined) : codexNow)];
    if (u.pathname === '/api/runtimes/codex/setup') return reply({ started: true }, 202);
    if (u.pathname === '/api/claude-account')
      return forced
        ? { signedIn: false, forced: true, checkedAt: at, error: 'Agents are set to the demo engine here (FRONTLINE_AGENT_ENGINE), so Claude is never used.' }
        : { signedIn: signedIn || !!u.searchParams.get('refresh'), email: 'owner@example.test', checkedAt: at };
    if (u.pathname === '/api/agent-types') return [{ id: 'copywriter', name: 'Copywriter', description: '', baseRole: 'copywriter', contract: { tools: [] } }];
    return undefined;
  });
  return calls;
}
const row = (id: string) => document.getElementById(id)!;
const select = (id: string) => within(row(id)).getByRole('combobox') as HTMLSelectElement;
const checked = (id: string) => within(row(id)).getByRole('radio', { checked: true }).textContent;
const saved = (calls: ReturnType<typeof api>) => calls.filter((c) => c.method === 'PATCH').map((c) => c.body);

it("changing the runtime resets model and effort to that runtime's defaults, and Codex gets a Stop after", async () => {
  const calls = api({ ws: { model: 'claude-opus-5-5', effort: 'high' } });
  renderApp(<Settings />, '/settings/agents');
  await waitFor(() => expect(checked('agentDefaults.effort')).toBe('High'));
  expect(select('agentDefaults.model').value).toBe('claude-opus-5-5');
  // Workspace scope: no origin lines, nothing to inherit.
  expect(screen.queryByText(/Using workspace default/)).toBeNull();

  fireEvent.change(select('agentDefaults.runtime'), { target: { value: 'codex' } });
  expect(select('agentDefaults.model').value).toBe('');
  expect(within(row('agentDefaults.model')).getByRole('option', { name: 'Runtime default (GPT-6.1-Sol)' })).toBeTruthy();
  expect(within(row('agentDefaults.model')).getByText('List from your Codex login')).toBeTruthy();
  expect(checked('agentDefaults.effort')).toBe('Low');
  expect(within(row('agentDefaults.effort')).getByRole('radio', { name: 'Ultra' }).getAttribute('aria-disabled')).toBe('true');
  expect((within(row('agentDefaults.stopAfterMin')).getByRole('spinbutton') as HTMLInputElement).value).toBe('20');
  expect(within(row('agentDefaults.stopAfterMin')).getByText('New conversations only · Codex needs it')).toBeTruthy();

  expect((await screen.findAllByText(/4 unsaved changes/)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(saved(calls)).toHaveLength(1));
  expect(saved(calls)[0]).toEqual({ documents: [{ doc: 'workspace', version: 3, set: { 'agentDefaults.runtime': 'codex', 'agentDefaults.stopAfterMin': 20 }, unset: ['agentDefaults.model', 'agentDefaults.effort'] }] });
});

it("a refused default shows on its row, in the server's words", async () => {
  api({ refuse: { error: `"claude-haiku-4-5" isn't on your Claude login's model list.`, field: 'agentDefaults.model' } });
  renderApp(<Settings />, '/settings/agents');
  await waitFor(() => expect(select('agentDefaults.model').value).toBe(''));
  fireEvent.change(select('agentDefaults.model'), { target: { value: 'claude-haiku-4-5' } });
  // Haiku takes no effort level: the row says so instead of offering one.
  expect(within(row('agentDefaults.effort')).getByText('Haiku 4.5 takes no effort level')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
  expect((await within(row('agentDefaults.model')).findByRole('alert')).textContent).toBe(`"claude-haiku-4-5" isn't on your Claude login's model list.`);
});

it("a store's own value shows its origin and Use workspace default; inherited rows say so; the bar has the scope and impact", async () => {
  const calls = api({ ws: { model: 'claude-opus-5-5', effort: 'medium' }, own: { glow: { effort: 'high' } } });
  renderApp(<Settings />, '/settings/agents?store=glow');
  expect(await screen.findByText('Customized for this store · workspace default Medium')).toBeTruthy();
  expect(checked('agentDefaults.effort')).toBe('High');
  expect(within(row('agentDefaults.model')).getByText('Using workspace default')).toBeTruthy();
  expect(select('agentDefaults.model').value).toBe('claude-opus-5-5');
  expect(within(row('agentDefaults.runtime')).getByText('Using workspace default')).toBeTruthy();

  fireEvent.click(within(row('agentDefaults.effort')).getByRole('button', { name: 'Use workspace default' }));
  expect(checked('agentDefaults.effort')).toBe('Medium');
  expect(within(row('agentDefaults.effort')).getByText('Using workspace default')).toBeTruthy();
  expect((await screen.findAllByText(/1 unsaved change/)).length).toBeGreaterThan(0);
  expect(screen.getByText(/Glow Haus/, { selector: '[role="status"] *' })).toBeTruthy();
  expect(await screen.findByText('Applies to new runs on Glow Haus; 2 running runs keep their settings')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(saved(calls)).toEqual([{ documents: [{ doc: 'store_caps', storeId: 'glow', version: 7, unset: ['agentDefaults.effort'] }] }]));
});

it("a demo store's runtime row is disabled with its reason", async () => {
  api();
  renderApp(<Settings />, '/settings/agents?store=peak');
  expect(await screen.findByText('Runs on the demo engine while Peak Fit is on demo data')).toBeTruthy();
  expect(select('agentDefaults.runtime').disabled).toBe(true);
  expect(select('agentDefaults.runtime').value).toBe('demo');
  // Model and effort still apply when the owner picks the default runtime in Deploy.
  expect(select('agentDefaults.model').disabled).toBe(false);
});

it('the scope switch edits one store: its values, under ?store=', async () => {
  const calls = api({ ws: { effort: 'medium' }, own: { glow: { effort: 'high' } } });
  renderApp(<Settings />, '/settings/agents');
  await waitFor(() => expect(checked('agentDefaults.effort')).toBe('Medium'));
  fireEvent.click(screen.getByRole('button', { name: /Pick a store/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Glow Haus' }));
  expect(screen.getByTestId('where').textContent).toBe('/settings/agents?store=glow');
  await waitFor(() => expect(checked('agentDefaults.effort')).toBe('High'));
  expect(calls.some((c) => c.url === '/api/config?store=glow')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Workspace defaults' }));
  await waitFor(() => expect(checked('agentDefaults.effort')).toBe('Medium'));
  expect(screen.getByTestId('where').textContent).toBe('/settings/agents');
});

it('Check again asks the Claude login again and shows what it says', async () => {
  const calls = api({ signedIn: false });
  renderApp(<Settings />, '/settings/agents');
  expect(await screen.findByText('Not signed in')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Check again' })[0]!);
  expect(await screen.findByText('Signed in as owner@example.test')).toBeTruthy();
  expect(calls.some((c) => c.url === '/api/claude-account?refresh=1')).toBe(true);
});

it("Set up Codex starts the sign-in on the app's Codex folder, then Check again reads it", async () => {
  const calls = api();
  renderApp(<Settings />, '/settings/agents');
  fireEvent.click(await screen.findByRole('button', { name: 'Set up Codex' }));
  expect(await screen.findByText('Sign in to Codex in the browser window that opened, then check again.')).toBeTruthy();
  expect(calls.some((c) => c.method === 'POST' && c.url === '/api/runtimes/codex/setup')).toBe(true);
  const codex = screen.getByText('Codex', { selector: 'div' }).parentElement!.parentElement!;
  fireEvent.click(within(codex).getByRole('button', { name: 'Check again' }));
  expect(await within(codex).findByText('Signed in')).toBeTruthy();
  expect(calls.some((c) => c.url === '/api/runtimes?refresh=1')).toBe(true);
});

it('a forced engine shows the runtimes as set by the environment, with nothing to check', async () => {
  api({ forced: true });
  renderApp(<Settings />, '/settings/agents');
  expect(await screen.findAllByText('Set by the environment · FRONTLINE_AGENT_ENGINE: every run uses the demo engine')).toHaveLength(2);
  expect(screen.getByText('Every run, set by the environment')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Set up Codex' })).toBeNull();
});

it("Deploy starts from the store's defaults and says where the model came from, with a link", async () => {
  api({ ws: { model: 'claude-opus-5-5', effort: 'high', stopAfterMin: 25, knowledge: 'store' }, own: { glow: { model: 'claude-haiku-4-5' } } });
  const deploy = (id: string) =>
    renderApp(
      <Routes>
        <Route path="*" element={<Deploy store={STORES.find((s) => s.id === id)!} type="copywriter" onClose={() => undefined} />} />
      </Routes>,
      '/agents',
    );
  deploy('glow');
  const link = await screen.findByRole('link', { name: 'From Glow Haus settings' });
  expect(link.getAttribute('href')).toBe('/settings/agents?store=glow#agentDefaults.model');
  expect((screen.getByRole('combobox', { name: /^Model/ }) as HTMLSelectElement).value).toBe('claude-haiku-4-5');
  expect((screen.getByRole('spinbutton', { name: 'Stop after' }) as HTMLInputElement).value).toBe('25');
  fireEvent.click(screen.getByRole('button', { name: /Tools and knowledge/ }));
  expect((screen.getByRole('checkbox', { name: 'General knowledge' }) as HTMLInputElement).checked).toBe(false);
  // Picking a model by hand: no origin line.
  fireEvent.change(screen.getByRole('combobox', { name: /^Model/ }), { target: { value: 'claude-opus-5-5' } });
  expect(screen.queryByRole('link', { name: 'From Glow Haus settings' })).toBeNull();
  cleanup();

  // A store without its own: the workspace's. The effort default goes with the default model.
  api({ ws: { model: 'claude-opus-5-5', effort: 'high' } });
  deploy('glow');
  expect((await screen.findByRole('link', { name: 'Workspace default' })).getAttribute('href')).toBe('/settings/agents#agentDefaults.model');
  expect(within(screen.getByRole('radiogroup', { name: 'Effort' })).getByRole('radio', { checked: true }).textContent).toBe('High');
});

it('Advanced holds the run limits at workspace scope only; lowering the total lowers per store with it', async () => {
  const calls = api({ ws: { retries: 1 } });
  renderApp(<Settings />, '/settings/agents');
  fireEvent.click(await screen.findByRole('button', { name: 'Advanced · retries, runs at once' }));
  expect(select('runs.retries').value).toBe('1');
  expect([select('runs.atOnce').value, select('runs.perStore').value]).toEqual(['3', '2']);
  fireEvent.change(select('runs.atOnce'), { target: { value: '1' } });
  expect(select('runs.perStore').value).toBe('1');
  expect((within(row('runs.perStore')).getByRole('option', { name: '2' }) as HTMLOptionElement).disabled).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(saved(calls)).toEqual([{ documents: [{ doc: 'workspace', version: 3, set: { 'runs.atOnce': 1, 'runs.perStore': 1 } }] }]));
  cleanup();

  api();
  renderApp(<Settings />, '/settings/agents?store=glow');
  await waitFor(() => expect(select('agentDefaults.runtime')).toBeTruthy());
  expect(screen.queryByRole('button', { name: /^Advanced/ })).toBeNull();
});

it('Create team and Research a Product show the store runs at once from Settings, with a link', async () => {
  api({ ws: { perStore: 1 } });
  renderApp(<CreateTeam store={STORES[0]!} onClose={() => undefined} />, '/agents?store=glow');
  const dialog = within(await screen.findByRole('dialog', { name: 'Create a team' }));
  expect(await dialog.findByText(/^Tasks run at most 1 at once per store/)).toBeTruthy();
  expect(dialog.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings/agents#runs.perStore');
  expect([...(dialog.getByLabelText('At once') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['1']);
  cleanup();

  const busy: PrAgentRow = { type: 'product_hunter', name: 'Product Researcher', custom: false, runtime: 'demo', model: null, effort: null, budgetUsd: null, state: 'busy', reason: null, busy: { conversationId: 'c9', title: 'Research: Cat perch', queued: 0, slotsFull: true, perStore: 1 } };
  stubApi((url) => {
    const u = new URL(url, 'http://x');
    if (u.pathname === '/api/stores') return STORES;
    if (u.pathname === '/api/pr/agents') return [busy];
    if (u.pathname === '/api/pr/profile') return { storeId: 'glow', priceMin: null, priceMax: null, priceCurrency: 'USD' };
    if (u.pathname === '/api/kb/cards') return { items: [], total: 0 };
    return undefined;
  });
  renderApp(<ResearchDialog stores={STORES} store="glow" onClose={() => undefined} onStarted={() => undefined} />, '/research?store=glow');
  expect(await screen.findByText('Working on “Research: Cat perch” · 0 queued in this conversation, then waits for a free store slot (1 per store)')).toBeTruthy();
});
