// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AutomationRule, KbControlsState } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { ResearchControls } from './Controls';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STORES = [{ id: 'pawsome', name: 'Pawsome Gear', connected: false, platform: 'shopify', niche: 'pets', color: '#f00', currency: 'USD', timezone: 'UTC' }];
const OFF: KbControlsState = {
  autonomous: false, roles: {}, triggers: ['conflict', 'anomaly', 'gap', 'stale'], taskBudgetUsd: 1, dailyBudgetUsd: 3, depth: 'standard', approval: true, review: true, trustedDomains: [], blockedDomains: [], freshDays: {}, retentionDays: null, reservedUsd: 0,
};
const CATS = [
  { id: 'p-ads', storeId: 'pawsome', parentId: null, name: 'Advertising', position: 1, createdAt: '', cards: 3, freshDays: 45 },
  { id: 'p-hooks', storeId: 'pawsome', parentId: 'p-ads', name: 'Hooks', position: 1, createdAt: '', cards: 1, freshDays: 45 },
  { id: 'p-psych', storeId: 'pawsome', parentId: null, name: 'Consumer Psychology', position: 2, createdAt: '', cards: 0, freshDays: 180 },
  { id: 'g-ads', storeId: null, parentId: null, name: 'Advertising', position: 1, createdAt: '', cards: 0, freshDays: 45 },
];
const WEEKLY = { id: 'r1', storeId: 'pawsome', name: "What's new in pet travel?", enabled: true, trigger: { type: 'schedule', cron: '0 9 * * 1' }, action: { type: 'kb_research', agentId: 'pawsome:market_analyst', task: "What's new in pet travel?" } } as AutomationRule;
const OTHER = { ...WEEKLY, id: 'r2', action: { type: 'agent_task', agentId: 'pawsome:ad_strategist', task: 'Review ads' } } as AutomationRule;

const render = (ws = 'pawsome', controls: KbControlsState = OFF, put: (body: unknown) => unknown = (b) => ({ ...OFF, ...(b as object) })) => {
  const sent: [string, string, unknown][] = [];
  const fetch = stubApi((url, init) => {
    if (init?.method && init.method !== 'GET') sent.push([init.method, url, init.body ? JSON.parse(String(init.body)) : undefined]);
    if (url === '/api/stores') return STORES;
    if (url.startsWith('/api/kb/controls')) return init?.method === 'PUT' ? put(JSON.parse(String(init.body))) : controls;
    if (url.startsWith('/api/kb/categories')) return CATS;
    if (url === '/api/automations') return init?.method === 'POST' ? WEEKLY : [WEEKLY, OTHER];
    if (url.startsWith('/api/automations/')) return new Response(null, { status: 204 });
  });
  renderApp(<ResearchControls ws={ws} />);
  return { sent, fetch };
};

describe('ResearchControls', () => {
  it("says what's on and what's reserved today", async () => {
    render();
    expect(await screen.findByText('Off: agents research only when you or a task asks.')).toBeTruthy();
    cleanup();
    render('pawsome', { ...OFF, autonomous: true, reservedUsd: 0.4 });
    expect(await screen.findByText('On: $0.40 of $3.00 reserved today')).toBeTruthy();
  });

  it('sets who researches on their own, on what triggers, budgets, depth, review and sites', async () => {
    const { sent } = render();
    fireEvent.click(await screen.findByRole('button', { name: 'Controls' }));
    const form = screen.getByRole('form', { name: 'Research controls' });
    fireEvent.click(within(form).getByLabelText('Agents research on their own'));
    fireEvent.click(within(form).getByLabelText('Ask me before each task'));
    fireEvent.click(within(form).getByLabelText('Stale cards'));
    fireEvent.click(within(form).getByLabelText('Contradictions'));
    fireEvent.click(within(form).getByLabelText('Contradictions')); // back on: still first
    const who = within(form).getByRole('group', { name: 'Who researches' });
    fireEvent.click(within(who).getByLabelText('Ad Strategist'));
    expect(within(who).getByText('No category ticked: its usual areas.')).toBeTruthy();
    fireEvent.click(await within(who).findByLabelText('Advertising'));
    expect(within(who).queryByLabelText('Hooks')).toBeNull(); // top-level only
    fireEvent.change(within(form).getByLabelText('Per task (USD)'), { target: { value: '0.5' } });
    fireEvent.change(within(form).getByLabelText('Per day (USD)'), { target: { value: '2' } });
    fireEvent.change(within(form).getByLabelText('Depth'), { target: { value: 'quick' } });
    fireEvent.click(within(form).getByLabelText('Findings wait for my review'));
    fireEvent.change(within(form).getByLabelText('Trusted sites (one per line)'), { target: { value: 'ads.tiktok.com\n\n business.facebook.com ' } });
    fireEvent.change(within(form).getByLabelText('Blocked sites (one per line)'), { target: { value: 'reddit.com' } });
    // Each top-level category's refresh age: its area's usual until the owner picks one.
    const ages = within(form).getByRole('group', { name: 'Needs refresh after' });
    expect([...within(ages).getByLabelText('Advertising').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Usual (45 days)', '14 days', '30 days', '60 days', '90 days', '180 days', '365 days']);
    expect((within(ages).getByLabelText('Consumer Psychology') as HTMLSelectElement).value).toBe('');
    fireEvent.change(within(ages).getByLabelText('Advertising'), { target: { value: '30' } });
    fireEvent.change(within(form).getByLabelText('Keep fetched pages and research logs'), { target: { value: '90' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(sent).toEqual([
        ['PUT', '/api/kb/controls?ws=pawsome', {
          autonomous: true, approval: false, review: false, triggers: ['conflict', 'anomaly', 'gap'], roles: { ad_strategist: ['p-ads'] }, taskBudgetUsd: 0.5, dailyBudgetUsd: 2, depth: 'quick',
          trustedDomains: ['ads.tiktok.com', 'business.facebook.com'], blockedDomains: ['reddit.com'], freshDays: { 'p-ads': 30 }, retentionDays: 90,
        }],
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Research controls' })).toBeNull());
  });

  it("an owner's refresh age and retention show as set; Usual clears the age", async () => {
    const { sent } = render('pawsome', { ...OFF, freshDays: { 'p-ads': 14 }, retentionDays: 365 });
    fireEvent.click(await screen.findByRole('button', { name: 'Controls' }));
    const form = screen.getByRole('form', { name: 'Research controls' });
    const ads = (await within(form).findByLabelText('Advertising', { selector: 'select' })) as HTMLSelectElement;
    expect(ads.value).toBe('14');
    expect(ads.options[0]!.textContent).toBe('Usual for its area'); // its own age is in effect, so the usual one isn't known here
    expect((within(form).getByLabelText('Keep fetched pages and research logs') as HTMLSelectElement).value).toBe('365');
    fireEvent.change(ads, { target: { value: '' } });
    fireEvent.change(within(form).getByLabelText('Keep fetched pages and research logs'), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const { freshDays, retentionDays } = sent[0]![2] as Record<string, unknown>;
    expect([freshDays, retentionDays]).toEqual([{}, null]);
  });

  it('shows why a save was refused', async () => {
    render('pawsome', OFF, () => Response.json({ error: 'trustedDomains and blockedDomains must be domain names, like example.com' }, { status: 400 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('trustedDomains and blockedDomains must be domain names, like example.com');
  });

  it("schedules: the store's research automations, to remove or add", async () => {
    const { sent } = render();
    fireEvent.click(await screen.findByRole('button', { name: 'Controls' }));
    const list = await screen.findByRole('list', { name: 'Scheduled research' });
    expect([...list.children].map((li) => li.textContent)).toEqual(["Every Monday at 9:00: What's new in pet travel? · Analytics SpecialistRemove"]);
    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    const add = screen.getByRole('group', { name: 'Add a schedule' });
    fireEvent.change(within(add).getByLabelText('Topic'), { target: { value: ' Calming sprays: what changed? ' } });
    fireEvent.change(within(add).getByLabelText('Researcher'), { target: { value: 'product_hunter' } });
    fireEvent.change(within(add).getByLabelText('How often'), { target: { value: '0 9 1 * *' } });
    fireEvent.click(within(add).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(sent).toEqual([
        ['DELETE', '/api/automations/r1', undefined],
        ['POST', '/api/automations', {
          storeId: 'pawsome', name: 'Calming sprays: what changed?', trigger: { type: 'schedule', cron: '0 9 1 * *' }, action: { type: 'kb_research', agentId: 'pawsome:product_hunter', task: 'Calming sprays: what changed?' },
          approval: 'auto', maxRunsPerDay: 1,
        }],
      ]),
    );
  });

  it('General keeps its review and sites; self-directed research runs on a store', async () => {
    const { sent } = render('general');
    expect(await screen.findByText("Self-directed research runs on a store's agents and AI budget: pick a store to turn it on.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Controls' }));
    const form = screen.getByRole('form', { name: 'Research controls' });
    expect(within(form).queryByLabelText('Agents research on their own')).toBeNull();
    expect(within(form).queryByRole('group', { name: 'Who researches' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Add a schedule' })).toBeNull();
    expect((await within(form).findByRole('group', { name: 'Needs refresh after' })).querySelectorAll('select')).toHaveLength(1); // General's own categories
    fireEvent.click(within(form).getByLabelText('Findings wait for my review'));
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).toEqual([['PUT', '/api/kb/controls?ws=general', { review: false, trustedDomains: [], blockedDomains: [], freshDays: {}, retentionDays: null }]]));
  });

  it('All workspaces has none of its own', async () => {
    const { fetch } = render('all');
    expect(await screen.findByText('Pick a workspace to see its research controls.')).toBeTruthy();
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/kb/controls'))).toBe(false);
  });
});
