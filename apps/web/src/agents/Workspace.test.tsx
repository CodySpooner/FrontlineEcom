// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router';
import type { Conversation, Store } from '@frontline/shared';
import { App } from '../App';
import { renderApp, reply, stubApi } from '../test-utils';
import { Workspace } from './Workspace';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const store = (id: string, name: string, connected = false) => ({ id, name, platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected }) as Store;
const conversation = (id: string, title: string, state: Conversation['state'] = 'completed'): Conversation => ({
  id,
  storeId: 'glow',
  configId: `cfg-${id}`,
  agentId: 'glow:copywriter',
  type: 'copywriter',
  title,
  pinned: false,
  createdAt: '2026-10-24T10:00:00Z',
  updatedAt: '2026-10-24T10:00:00Z',
  lastActivityAt: '2026-10-24T10:00:00Z',
  state,
});
const CONVERSATIONS = [conversation('c1', 'Spring hero line', 'running'), conversation('c2', 'FAQ rewrite')];

const run = (id: string, extra: object) => ({ id, storeId: 'glow', agentId: 'glow:copywriter', task: 'Weekly copy check', status: 'done', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, createdAt: '2026-10-24T10:00:00Z', transcript: [], ...extra });
const RUNS: Record<string, object> = { inc: run('inc', { conversationId: 'c2' }), solo: run('solo', {}), peaks: run('peaks', { storeId: 'peak' }) };

/** glow has c1 and c2; asking for them with another store is the server's 404 (decision 13). */
function api(stores = [store('glow', 'Glow Botanics'), store('peak', 'Peak Gear', true)]) {
  return stubApi((url) => {
    const u = new URL(url, 'http://x');
    const asked = u.searchParams.get('store');
    if (u.pathname === '/api/stores') return stores;
    if (u.pathname === '/api/health') return { connectors: [] };
    if (u.pathname === '/api/conversations') {
      const items = asked === 'glow' && !u.searchParams.get('view') ? CONVERSATIONS : [];
      return { items, total: items.length, byType: items.length ? { copywriter: items.length } : {} };
    }
    if (u.pathname === '/api/agent-types') return [{ id: 'copywriter', name: 'Copywriter', description: '', baseRole: 'copywriter' }, { id: 'operations', name: 'Operations', description: '', baseRole: 'operations' }];
    if (u.pathname === '/api/conversations/counts') return {};
    if (u.pathname === '/api/notifications') return [{ id: 'n1', kind: 'agent_done', title: 'Copywriter finished', storeId: 'glow', link: '/agents?store=glow&run=inc', createdAt: '2026-10-24T10:00:00Z' }];
    const r = /^\/api\/runs\/(\w+)$/.exec(u.pathname)?.[1];
    if (r) return RUNS[r] ?? reply({ error: 'Run not found' }, 404);
    const [, id, thread] = /^\/api\/conversations\/([^/]+)(\/thread)?$/.exec(u.pathname) ?? [];
    const found = CONVERSATIONS.find((c) => c.id === id);
    if (id && (!found || asked !== found.storeId)) return reply({ error: 'Conversation not found' }, 404);
    if (found) return thread ? { items: [], total: 0 } : { ...found, config: { runtime: 'demo', tools: [], knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } } };
    return undefined;
  });
}
const renderAt = (path: string) =>
  renderApp(
    <Routes>
      {['/agents/c/:id', '/agents/t/:id', '/agents'].map((p) => (
        <Route key={p} path={p} element={<Workspace />} />
      ))}
    </Routes>,
    path,
  );

test('a conversation URL reopens that conversation, with the demo marker for a demo store', async () => {
  api();
  renderAt('/agents/c/c1?store=glow');
  expect(await screen.findByRole('heading', { name: 'Spring hero line' })).toBeTruthy();
  expect(screen.getByText('Demo data')).toBeTruthy();
  expect((await screen.findByRole('link', { name: /FAQ rewrite/ })).getAttribute('href')).toBe('/agents/c/c2?store=glow');
  expect(screen.getByRole('link', { name: /Spring hero line/ }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: /Spring hero line/ }).textContent).toContain('Running');
});

test('another store, an unknown store and an unknown conversation each show the not-found state', async () => {
  api();
  renderAt('/agents/c/c1?store=peak');
  expect(await screen.findByText('Conversation not found')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to Peak Gear' }).getAttribute('href')).toBe('/agents?store=peak');
  expect(screen.queryByText('Demo data')).toBeNull(); // Peak is live
  cleanup();
  renderAt('/agents?store=gone');
  expect(await screen.findByText('Store not found')).toBeTruthy();
  cleanup();
  renderAt('/agents/t/t1?store=glow');
  expect(await screen.findByText('Team not found')).toBeTruthy();
});

test('with no store named it opens the first store; a store reopens the conversation last opened there', async () => {
  api();
  renderAt('/agents');
  expect(await screen.findByText("Glow Botanics's agents")).toBeTruthy();
  expect(screen.getByTestId('where').textContent).toBe('/agents?store=glow');
  fireEvent.click(await screen.findByRole('link', { name: /FAQ rewrite/ }));
  expect(await screen.findByRole('heading', { name: 'FAQ rewrite' })).toBeTruthy();
  cleanup();
  renderAt('/agents?store=glow');
  expect(await screen.findByRole('heading', { name: 'FAQ rewrite' })).toBeTruthy();
  expect(screen.getByTestId('where').textContent).toBe('/agents/c/c2?store=glow');
});

test("?run= opens the conversation holding the run, reads a run with none alone, and 404s another store's", async () => {
  api();
  renderAt('/agents?store=glow&run=inc');
  expect(await screen.findByRole('heading', { name: 'FAQ rewrite' })).toBeTruthy();
  expect(screen.getByTestId('where').textContent).toBe('/agents/c/c2?store=glow');
  cleanup();
  localStorage.clear();
  renderAt('/agents?store=glow&run=solo');
  expect(await screen.findByText('Read-only · not part of a conversation')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Weekly copy check' })).toBeTruthy();
  cleanup();
  renderAt('/agents?store=glow&run=peaks');
  expect(await screen.findByText('Run not found')).toBeTruthy();
});

test("after leaving for /knowledge, the sidebar's /agents link brings back the conversation, the Activity tab and the thread scroll", async () => {
  vi.stubGlobal('innerWidth', 1440); // three panes: the Details panel is open beside the thread
  api();
  renderApp(
    <>
      <Link to="/knowledge">Knowledge page</Link>
      <Link to="/agents">AI Agents page</Link>
      <Routes>
        {['/agents/c/:id', '/agents/t/:id', '/agents'].map((p) => (
          <Route key={p} path={p} element={<Workspace />} />
        ))}
        <Route path="/knowledge" element={<p>Knowledge</p>} />
      </Routes>
    </>,
    '/agents?store=glow',
  );
  fireEvent.click(await screen.findByRole('link', { name: /FAQ rewrite/ }));
  fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
  const thread = () => screen.getByRole('region', { name: 'Conversation' }).querySelector(':scope > .overflow-y-auto')!;
  await screen.findByRole('heading', { name: 'FAQ rewrite' });
  fireEvent.scroll(thread(), { target: { scrollTop: 120 } });
  fireEvent.click(screen.getByRole('link', { name: 'Knowledge page' }));
  expect(await screen.findByText('Knowledge')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'AI Agents page' }));
  expect(await screen.findByRole('heading', { name: 'FAQ rewrite' })).toBeTruthy();
  expect(screen.getByTestId('where').textContent).toBe('/agents/c/c2?store=glow');
  expect(screen.getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected')).toBe('true');
  await vi.waitFor(() => expect(thread().scrollTop).toBe(120));
  // The composer's knowledge chip opens the panel, hidden or not, on the Knowledge tab.
  fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Store + General knowledge' }));
  expect((await screen.findByRole('tab', { name: 'Knowledge' })).getAttribute('aria-selected')).toBe('true');
});

test("switching stores keeps the conversation's draft and touches no run", async () => {
  vi.stubGlobal('innerWidth', 1440);
  const fetch = api();
  renderAt('/agents/c/c1?store=glow');
  fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Half a thought' } });
  const pick = (name: RegExp) => fireEvent.click(within(document.getElementById('store-switcher')!).getByRole('menuitem', { name, hidden: true }));
  pick(/Peak Gear/);
  expect(await screen.findByText("Peak Gear's agents")).toBeTruthy();
  pick(/Glow Botanics/);
  expect(await screen.findByRole('heading', { name: 'Spring hero line' })).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Half a thought');
  expect(fetch.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')).toEqual([]);
});

test('no stores: the workspace says how to add one', async () => {
  api([]);
  renderAt('/agents');
  expect(await screen.findByText('No stores yet')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Add a store' }).getAttribute('href')).toBe('/settings');
});

test('/ focuses the list search unless typing; ↑/↓ move through the list', async () => {
  api();
  renderAt('/agents?store=glow');
  const list = within(await screen.findByRole('navigation', { name: 'Conversations' }));
  const first = await list.findByRole('link', { name: /Spring hero line/ });
  const second = list.getByRole('link', { name: /FAQ rewrite/ });
  const search = screen.getByRole('searchbox', { name: 'Search conversations' });
  fireEvent.keyDown(document.body, { key: '/' });
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: '/' }); // typing a slash in the field stays there
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
  expect([first.tabIndex, second.tabIndex]).toEqual([0, -1]); // one tab stop
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(first);
});

test('through the real Shell: moving between conversations keeps the workspace mounted and AI Agents lit', async () => {
  api();
  renderApp(<App />, '/agents/c/c1?store=glow');
  expect(await screen.findByRole('heading', { name: 'Spring hero line' })).toBeTruthy();
  const list = screen.getByRole('navigation', { name: 'Conversations' });
  fireEvent.click(screen.getByRole('link', { name: /FAQ rewrite/ }));
  expect(await screen.findByRole('heading', { name: 'FAQ rewrite' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Conversations' })).toBe(list);
  expect(screen.getByRole('link', { name: 'AI Agents' }).getAttribute('aria-current')).toBe('page');
});

test("a finished run's notification opens the conversation holding the run", async () => {
  api();
  renderApp(<App />, '/agents/c/c1?store=glow');
  expect(await screen.findByRole('heading', { name: 'Spring hero line' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Copywriter finished/ }));
  expect(await screen.findByRole('heading', { name: 'FAQ rewrite' })).toBeTruthy();
  expect(screen.getByTestId('where').textContent).toBe('/agents/c/c2?store=glow');
});
