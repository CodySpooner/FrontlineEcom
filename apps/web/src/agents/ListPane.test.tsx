// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import type { Conversation, Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Workspace } from './Workspace';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const store = (id: string, name: string) => ({ id, name, platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected: true }) as Store;
const conv = (id: string, title: string, type: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  storeId: 'glow',
  configId: `cfg-${id}`,
  agentId: `glow:${type}`,
  type,
  title,
  pinned: false,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  lastActivityAt: '2026-10-20T10:00:00Z',
  state: 'completed',
  ...extra,
});
const ACTIVE = [conv('a1', 'Scale the serum ads', 'ad_strategist', { state: 'awaiting_approval', pinned: true }), conv('a2', 'Review creatives', 'ad_strategist'), conv('c1', 'Hero line', 'copywriter', { state: 'interrupted' })];
const OLDER = [conv('c2', 'FAQ rewrite', 'copywriter')];
const ARCHIVED = [conv('z1', 'Old launch', 'copywriter', { archivedAt: '2026-09-01T00:00:00Z' })];
const TYPES = ['ad_strategist', 'copywriter', 'operations', 'email_sms'].map((id) => ({ id, name: { ad_strategist: 'Ad Strategist', copywriter: 'Copywriter', operations: 'Operations', email_sms: 'Email & SMS' }[id]!, description: '', baseRole: id }));

function api() {
  return stubApi((url, init) => {
    const u = new URL(url, 'http://x');
    const p = u.searchParams;
    if (u.pathname === '/api/stores') return [store('glow', 'Glow Haus'), store('peak', 'Peak Fit'), store('paws', 'Pawsome')];
    if (u.pathname === '/api/conversations/counts') return { peak: { running: 2, waiting: 1 }, paws: { running: 1, waiting: 0 } };
    if (u.pathname === '/api/agent-types') return TYPES;
    if (u.pathname.startsWith('/api/conversations/') && init?.method === 'PATCH') return { ...ACTIVE[0], ...JSON.parse(String(init.body)) };
    if (u.pathname !== '/api/conversations') return undefined;
    const page = (items: Conversation[], next?: string) => ({ items, total: items.length, ...(next ? { next } : {}), byType: { ad_strategist: 2, copywriter: 2 } });
    if (p.get('view') === 'pinned') return page(ACTIVE.filter((c) => c.pinned));
    if (p.get('view') === 'archived') return page(ARCHIVED);
    if (p.get('q')) return page(p.get('q') === 'serum' ? [ACTIVE[0]!] : []);
    return p.get('cursor') ? page(OLDER) : page(ACTIVE, 'cursor-1');
  });
}
const renderAt = (path = '/agents?store=glow') =>
  renderApp(
    <Routes>
      {['/agents/c/:id', '/agents'].map((p) => (
        <Route key={p} path={p} element={<Workspace />} />
      ))}
    </Routes>,
    path,
  );
const pane = async () => within(await screen.findByRole('navigation', { name: 'Conversations' }));
const asked = (fetch: ReturnType<typeof stubApi>, part: string) => fetch.mock.calls.some(([url]) => String(url).includes(part));

test('Pinned, then Agents grouped by type with counts; empty types fold into one row; a group collapses and stays so', async () => {
  api();
  renderAt();
  const list = await pane();
  expect(await list.findByRole('button', { name: /Ad Strategist\s*2/ })).toBeTruthy();
  expect(list.getByText('Pinned')).toBeTruthy();
  expect(list.getAllByRole('link', { name: /Scale the serum ads/ })).toHaveLength(2); // pinned and in its group
  // Status words: the meta says the ones to watch; the dot names the others; interrupted is its own word.
  expect(list.getByRole('link', { name: /Hero line/ }).textContent).toContain('Interrupted');
  expect(within(list.getByRole('link', { name: /Review creatives/ })).getByRole('img', { name: 'Done' })).toBeTruthy();
  fireEvent.click(list.getByRole('button', { name: '2 more agent types · no conversations yet' }));
  expect(list.getByText('Email & SMS')).toBeTruthy();
  fireEvent.click(list.getByRole('button', { name: /Copywriter\s*2/ }));
  expect(list.queryByRole('link', { name: /Hero line/ })).toBeNull();
  expect(JSON.parse(localStorage.getItem('fe.agents.collapsed')!)).toEqual(['copywriter']);
});

test("the row menu renames inline, pins and archives through the conversation's store", async () => {
  const fetch = api();
  renderAt();
  const list = await pane();
  await list.findByRole('link', { name: /Review creatives/ });
  const menu = (title: string) => within(list.getAllByRole('link', { name: new RegExp(title) }).at(-1)!.parentElement!);
  fireEvent.click(await menu('Review creatives').findByRole('menuitem', { name: 'Pin', hidden: true }));
  fireEvent.click(menu('Review creatives').getByRole('menuitem', { name: 'Archive', hidden: true }));
  fireEvent.click(menu('Review creatives').getByRole('menuitem', { name: 'Rename', hidden: true }));
  const input = list.getByRole('textbox', { name: 'Conversation title' });
  fireEvent.change(input, { target: { value: 'Creative review' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(3));
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([url, init]) => [url, JSON.parse(String(init!.body))])).toEqual([
    ['/api/conversations/a2?store=glow', { pinned: true }],
    ['/api/conversations/a2?store=glow', { archived: true }],
    ['/api/conversations/a2?store=glow', { title: 'Creative review' }],
  ]);
});

test('the store switcher lists every store with what is going there, and switches only the view', async () => {
  api();
  renderAt();
  const list = await pane();
  expect(await list.findByText('2 other stores ·')).toBeTruthy();
  expect(list.getByText('3 agents running there')).toBeTruthy();
  const picker = within(document.getElementById('store-switcher')!); // a closed popover
  expect(picker.getByRole('menuitem', { name: /Peak Fit.*2 running · 1 waiting/, hidden: true })).toBeTruthy();
  fireEvent.click(picker.getByRole('menuitem', { name: /Peak Fit/, hidden: true }));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/agents?store=peak'));
});

test('search, the archive, the range and older pages each ask the server', async () => {
  const fetch = api();
  renderAt();
  const list = await pane();
  await list.findByRole('button', { name: /^Ad Strategist/ });
  fireEvent.click(list.getByRole('button', { name: 'Show older' }));
  expect(await list.findByRole('link', { name: /FAQ rewrite/ })).toBeTruthy();
  expect(asked(fetch, 'cursor=cursor-1')).toBe(true);

  fireEvent.click(list.getByRole('menuitem', { name: 'Active + 7 days', hidden: true }));
  await waitFor(() => expect(asked(fetch, 'range=7')).toBe(true));
  expect(list.getByRole('button', { name: 'Showing active + 7 days' })).toBeTruthy();

  fireEvent.change(list.getByRole('searchbox'), { target: { value: 'serum' } });
  expect(await list.findByRole('link', { name: /Scale the serum ads/ })).toBeTruthy();
  expect(list.queryByText('Pinned')).toBeNull(); // results are one flat list
  fireEvent.change(list.getByRole('searchbox'), { target: { value: 'nothing' } });
  expect(await list.findByText('No conversation matches "nothing".')).toBeTruthy();
  fireEvent.change(list.getByRole('searchbox'), { target: { value: '' } });

  fireEvent.click(await list.findByRole('button', { name: 'Archived · 1' }));
  expect(await list.findByRole('link', { name: /Old launch/ })).toBeTruthy();
  fireEvent.click(list.getByRole('button', { name: 'Archived conversations' }));
  expect(await list.findByRole('button', { name: /^Ad Strategist/ })).toBeTruthy();
});
