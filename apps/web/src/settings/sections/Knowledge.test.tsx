// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AutomationRule, KbControlsState } from '@frontline/shared';
import { Settings } from '../../pages/Settings';
import { renderApp, stubApi } from '../../test-utils';

afterEach(() => (cleanup(), vi.unstubAllGlobals()));

const STORES = [{ id: 'pawsome', name: 'Pawsome Gear', connected: false, platform: 'shopify', niche: 'pets', color: '#f00', currency: 'USD', timezone: 'UTC' }];
const OFF: KbControlsState = {
  autonomous: false, roles: {}, triggers: ['conflict', 'anomaly', 'gap', 'stale'], taskBudgetUsd: 1, dailyBudgetUsd: 3, depth: 'standard', approval: true, review: true, trustedDomains: [], blockedDomains: [], freshDays: {}, retentionDays: null,
  reservedUsd: 0, version: 0,
};
const CATS = [
  { id: 'p-ads', storeId: 'pawsome', parentId: null, name: 'Advertising', position: 1, createdAt: '', cards: 3, freshDays: 45 },
  { id: 'p-hooks', storeId: 'pawsome', parentId: 'p-ads', name: 'Hooks', position: 1, createdAt: '', cards: 1, freshDays: 45 },
  { id: 'p-psych', storeId: 'pawsome', parentId: null, name: 'Consumer Psychology', position: 2, createdAt: '', cards: 0, freshDays: 180 },
  { id: 'g-ads', storeId: null, parentId: null, name: 'Advertising', position: 1, createdAt: '', cards: 0, freshDays: 45 },
];
const WEEKLY = { id: 'r1', storeId: 'pawsome', name: "What's new in pet travel?", enabled: true, trigger: { type: 'schedule', cron: '0 9 * * 1' }, action: { type: 'kb_research', agentId: 'pawsome:market_analyst', task: "What's new in pet travel?" } } as AutomationRule;
const OTHER = { ...WEEKLY, id: 'r2', action: { type: 'agent_task', agentId: 'pawsome:ad_strategist', task: 'Review ads' } } as AutomationRule;

const view = (values: Record<string, unknown> = {}, origins: Record<string, string> = {}, versions: Record<string, number> = {}) => ({ values, origins, versions });
type Patch = { documents: { storeId?: string }[] };

/** `views`: GET /api/config's answers by URL; a PATCH's answer (`patch`) is what the next read of its document returns. */
function render(ws = 'pawsome', { controls = OFF, put = (b: unknown): unknown => ({ ...OFF, ...(b as object), version: 1 }), forced = false, trim = { pages: 0, logs: 0, outputs: 0, transcripts: 0 }, views = {} as Record<string, unknown>, patch = (_: Patch): unknown => view() } = {}) {
  const sent: [string, string, unknown][] = [];
  stubApi((url, init) => {
    if (init?.method && init.method !== 'GET') sent.push([init.method, url, init.body ? JSON.parse(String(init.body)) : undefined]);
    if (url === '/api/stores') return STORES;
    if (url === '/api/config/impact') return { impacts: [{ setting: 'knowledge.autoSave', text: 'Applies to 1 store that uses the workspace default; 0 stores have their own value' }] };
    if (url === '/api/config' && init?.method === 'PATCH') {
      const b = JSON.parse(String(init.body)) as Patch;
      const id = b.documents[0]!.storeId;
      return (views[id ? `/api/config?store=${id}` : '/api/config'] = patch(b));
    }
    if (url === '/api/config' || url.startsWith('/api/config?')) return views[url] ?? view();
    if (url === '/api/claude-account') return forced ? { signedIn: false, forced: true, checkedAt: '' } : { signedIn: true, checkedAt: '' };
    if (url.startsWith('/api/kb/controls/trim')) return (sent.push(['GET', url, undefined]), trim);
    if (url.startsWith('/api/kb/controls')) return init?.method === 'PUT' ? put(JSON.parse(String(init.body))) : controls;
    if (url.startsWith('/api/kb/categories')) return CATS;
    if (url === '/api/automations') return init?.method === 'POST' ? WEEKLY : [WEEKLY, OTHER];
    if (url.startsWith('/api/automations/')) return new Response(null, { status: 204 });
    return undefined;
  });
  renderApp(<Settings />, ws === 'general' ? '/settings/knowledge' : `/settings/knowledge?store=${ws}`);
  return sent;
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
const puts = (sent: ReturnType<typeof render>) => sent.filter(([m]) => m === 'PUT');

it('sets who researches on their own, on what triggers, budgets, depth, review and sites', async () => {
  const sent = render();
  fireEvent.click(await screen.findByRole('switch', { name: 'Self-directed research' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Ask before each task' }));
  const triggers = screen.getByRole('group', { name: 'What starts research' });
  fireEvent.click(within(triggers).getByLabelText('Stale cards'));
  fireEvent.click(within(triggers).getByLabelText('Contradictions'));
  fireEvent.click(within(triggers).getByLabelText('Contradictions')); // back on: still first
  const who = screen.getByRole('group', { name: 'Roles that research' });
  fireEvent.click(within(who).getByLabelText('Ad Strategist'));
  expect(within(who).getByText('No category ticked: its usual areas.')).toBeTruthy();
  fireEvent.click(await within(who).findByLabelText('Advertising'));
  expect(within(who).queryByLabelText('Hooks')).toBeNull(); // top-level only
  fireEvent.change(screen.getByLabelText('Budget per task'), { target: { value: '0.5' } });
  fireEvent.change(screen.getByLabelText('Budget in any 24 hours'), { target: { value: '2' } });
  expect(screen.getByText('What self-directed research may reserve in any 24 hours, pending approvals included. At least the task budget.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Research depth'), { target: { value: 'quick' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Review research findings' }));
  fireEvent.change(screen.getByLabelText('Trusted sites'), { target: { value: 'ads.tiktok.com\n\n business.facebook.com ' } });
  expect(screen.getByText('Preferred in research prompts. Never overrides blocked domains, review or approvals.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Blocked sites'), { target: { value: 'reddit.com' } });
  // Each top-level category's refresh age: its area's usual until the owner picks one.
  const ages = screen.getByRole('group', { name: 'Days a card stays fresh' });
  expect([...within(ages).getByLabelText('Advertising').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Usual (45 days)', '14 days', '30 days', '60 days', '90 days', '180 days', '365 days']);
  expect((within(ages).getByLabelText('Consumer Psychology') as HTMLSelectElement).value).toBe('');
  fireEvent.change(within(ages).getByLabelText('Advertising'), { target: { value: '30' } });
  expect(screen.getByText('Agents research gaps in what they know, within these budgets. Changes take effect at the next hourly pass.')).toBeTruthy();
  save();
  await waitFor(() =>
    expect(puts(sent)).toEqual([
      ['PUT', '/api/kb/controls?ws=pawsome', {
        version: 0, autonomous: true, approval: false, triggers: ['conflict', 'anomaly', 'gap'], roles: { ad_strategist: ['p-ads'] }, taskBudgetUsd: 0.5, dailyBudgetUsd: 2, depth: 'quick',
        review: false, trustedDomains: ['ads.tiktok.com', 'business.facebook.com'], blockedDomains: ['reddit.com'], freshDays: { 'p-ads': 30 },
      }],
    ]),
  );
});

it("an owner's refresh age and retention show as set; Usual clears the age, and keeping more needs no confirm", async () => {
  const sent = render('pawsome', { controls: { ...OFF, freshDays: { 'p-ads': 14 }, retentionDays: 365 } });
  const ages = await screen.findByRole('group', { name: 'Days a card stays fresh' });
  const ads = within(ages).getByLabelText('Advertising') as HTMLSelectElement;
  expect(ads.value).toBe('14');
  expect(ads.options[0]!.textContent).toBe('Usual for its area'); // its own age is in effect, so the usual one isn't known here
  const keep = screen.getByLabelText('Keep page text and research logs') as HTMLSelectElement;
  expect(keep.value).toBe('365');
  fireEvent.change(ads, { target: { value: '' } });
  fireEvent.change(keep, { target: { value: '' } });
  save();
  await waitFor(() => expect(puts(sent)).toEqual([['PUT', '/api/kb/controls?ws=pawsome', { version: 0, freshDays: {}, retentionDays: null }]]));
  expect(sent.some(([, url]) => url.startsWith('/api/kb/controls/trim'))).toBe(false);
});

it('lowering retention says what the next pass trims, and saves only once confirmed', async () => {
  const sent = render('pawsome', { controls: { ...OFF, retentionDays: 365 }, trim: { pages: 12, logs: 3, outputs: 7, transcripts: 1 } });
  fireEvent.change(await screen.findByLabelText('Keep page text and research logs'), { target: { value: '90' } });
  const text = 'The next hourly pass trims the text of 12 fetched pages, 3 research logs, 7 step outputs and 1 run transcript older than 90 days. Sources, tasks and reports stay.';
  // In the save bar, and in the confirm.
  await waitFor(() => expect(screen.getAllByText(text).map((p) => !!p.closest('dialog'))).toEqual([false, true]));
  expect(sent).toContainEqual(['GET', '/api/kb/controls/trim?ws=pawsome&days=90', undefined]);
  const dialog = screen.getAllByText(text)[1]!.closest('dialog')!;
  save();
  await waitFor(() => expect(dialog.open).toBe(true));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(puts(sent)).toEqual([]);
  save();
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Keep 90 days' }));
  await waitFor(() => expect(puts(sent)).toEqual([['PUT', '/api/kb/controls?ws=pawsome', { version: 0, retentionDays: 90 }]]));
});

it('shows why a save was refused, on its row', async () => {
  render('pawsome', { put: () => Response.json({ error: 'trustedDomains and blockedDomains must be domain names, like example.com', field: 'kb.trustedDomains' }, { status: 400 }) });
  fireEvent.change(await screen.findByLabelText('Trusted sites'), { target: { value: 'https://reddit.com/r/x' } });
  save();
  expect(await within(document.getElementById('kb.trustedDomains')!).findByText('trustedDomains and blockedDomains must be domain names, like example.com')).toBeTruthy();
});

it("schedules: the store's research automations, to remove or add", async () => {
  const sent = render();
  const list = await screen.findByRole('list', { name: 'Scheduled research' });
  expect([...list.children].map((li) => li.textContent)).toEqual(["Every Monday at 9:00: What's new in pet travel? · Analytics SpecialistRemove"]);
  expect(screen.getByText('Each runs as Knowledge research on Pawsome Gear. KB controls decide approval: with "Ask before each task" on, each one waits for you.')).toBeTruthy();
  fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
  const add = screen.getByRole('group', { name: 'Add a schedule' });
  fireEvent.change(within(add).getByLabelText('Topic'), { target: { value: ' Calming sprays: what changed? ' } });
  fireEvent.change(within(add).getByLabelText('Researcher'), { target: { value: 'product_hunter' } });
  fireEvent.change(within(add).getByLabelText('How often'), { target: { value: '0 9 1 * *' } });
  fireEvent.click(within(add).getByRole('button', { name: 'Add' }));
  await waitFor(() =>
    expect(sent.filter(([, url]) => url.startsWith('/api/automations'))).toEqual([
      ['DELETE', '/api/automations/r1', undefined],
      ['POST', '/api/automations', {
        storeId: 'pawsome', name: 'Calming sprays: what changed?', trigger: { type: 'schedule', cron: '0 9 1 * *' }, action: { type: 'kb_research', agentId: 'pawsome:product_hunter', task: 'Calming sprays: what changed?' },
        approval: 'auto', maxRunsPerDay: 1,
      }],
    ]),
  );
});

it('General shows only its own fields, and sends only them', async () => {
  const sent = render('general');
  expect(await screen.findByText("It runs on a store's agents and AI budget: pick a store under Editing to turn it on.")).toBeTruthy();
  expect(screen.queryByRole('switch', { name: 'Self-directed research' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Roles that research' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Add a schedule' })).toBeNull();
  expect((await screen.findByRole('group', { name: 'Days a card stays fresh' })).querySelectorAll('select')).toHaveLength(1); // General's own categories
  fireEvent.click(screen.getByRole('switch', { name: 'Review research findings' }));
  save();
  await waitFor(() => expect(puts(sent)).toEqual([['PUT', '/api/kb/controls?ws=general', { version: 0, review: false }]]));
});

it('on the demo engine self-directed research stays off, and says why', async () => {
  render('pawsome', { forced: true });
  const on = (await screen.findByRole('switch', { name: 'Self-directed research' })) as HTMLInputElement;
  await waitFor(() => expect(on.disabled).toBe(true));
  expect(within(document.getElementById('kb.autonomous')!).getByText('Set by the environment · the agents are on the demo engine here, and self-directed research needs Claude')).toBeTruthy();
});

const AUTO = 'knowledge.autoSave';
const patches = (sent: ReturnType<typeof render>) => sent.filter(([m]) => m === 'PATCH');

it('Automatic saving · default for all stores: General edits the workspace row, saying how many stores follow it', async () => {
  const sent = render('general', { views: { '/api/config': view({ [AUTO]: true }, { [AUTO]: 'default' }, { workspace: 4 }) }, patch: () => view({ [AUTO]: false }, { [AUTO]: 'workspace' }, { workspace: 5 }) });
  const card = await screen.findByRole('region', { name: 'Automatic saving · default for all stores' });
  const on = within(card).getByRole('switch', { name: 'Save findings automatically' }) as HTMLInputElement;
  expect(on.checked).toBe(true);
  expect(within(card).getByRole('link', { name: 'Agents & Providers' }).getAttribute('href')).toBe('/settings/agents#agentDefaults.knowledge');
  fireEvent.click(on);
  await screen.findByText('Save findings automatically: Applies to 1 store that uses the workspace default; 0 stores have their own value');
  expect(screen.getByText(/Workspace defaults/, { selector: '[role="status"] *' })).toBeTruthy();
  save();
  await waitFor(() => expect(patches(sent)).toEqual([['PATCH', '/api/config', { documents: [{ doc: 'workspace', version: 4, set: { [AUTO]: false } }] }]]));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull());
  expect(puts(sent)).toEqual([]); // the research controls weren't touched
  expect((within(card).getByRole('switch', { name: 'Save findings automatically' }) as HTMLInputElement).checked).toBe(false);
});

it("a store's Automatic saving follows the workspace's until set: then its own, with Use workspace default", async () => {
  const workspace = view({ [AUTO]: false }, { [AUTO]: 'workspace' }, { workspace: 4 });
  const sent = render('pawsome', {
    views: { '/api/config': workspace, '/api/config?store=pawsome': view({ [AUTO]: false }, { [AUTO]: 'workspace' }, { workspace: 4, 'store_caps:pawsome': 2 }) },
    patch: (b) => ('unset' in b.documents[0]! ? view({ [AUTO]: false }, { [AUTO]: 'workspace' }, { workspace: 4, 'store_caps:pawsome': 4 }) : view({ [AUTO]: true }, { [AUTO]: 'store' }, { workspace: 4, 'store_caps:pawsome': 3 })),
  });
  const card = await screen.findByRole('region', { name: 'Automatic saving' });
  const row = () => card.querySelector(`[id="${AUTO}"]`) as HTMLElement;
  expect((within(row()).getByRole('switch') as HTMLInputElement).checked).toBe(false);
  expect(within(row()).getByText('Using workspace default')).toBeTruthy();
  expect(within(card).getByRole('link', { name: 'Agents & Providers' }).getAttribute('href')).toBe('/settings/agents?store=pawsome#agentDefaults.knowledge');
  fireEvent.click(within(row()).getByRole('switch'));
  expect(within(row()).getByText('Customized for this store · workspace default off')).toBeTruthy();
  expect(screen.getByText(/Pawsome Gear/, { selector: '[role="status"] *' })).toBeTruthy();
  save();
  await waitFor(() => expect(patches(sent)).toEqual([['PATCH', '/api/config', { documents: [{ doc: 'store_caps', storeId: 'pawsome', version: 2, set: { [AUTO]: true } }] }]]));
  fireEvent.click(await within(row()).findByRole('button', { name: 'Use workspace default' }));
  expect((within(row()).getByRole('switch') as HTMLInputElement).checked).toBe(false);
  save();
  await waitFor(() => expect(patches(sent)[1]).toEqual(['PATCH', '/api/config', { documents: [{ doc: 'store_caps', storeId: 'pawsome', version: 3, unset: [AUTO] }] }]));
  await within(row()).findByText('Using workspace default');
  expect(puts(sent)).toEqual([]);
});
