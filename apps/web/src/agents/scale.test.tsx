// @vitest-environment jsdom
// AA-22: the workspace at scale (500 conversations, a 300-message thread, 25 stores, 3 runs streaming at once).
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import type { AgentEvent, Conversation, Store } from '@frontline/shared';
import { useLive } from '../api/client';
import { renderApp, stubApi } from '../test-utils';
import { inkOn } from './ListPane';
import { Workspace } from './Workspace';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const store = (n: number) => ({ id: n ? `s${n}` : 'glow', name: n ? `Store ${String(n).padStart(2, '0')}` : 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected: true }) as Store;
const conversation = (id: string, title: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  storeId: 'glow',
  configId: `cfg-${id}`,
  agentId: 'glow:copywriter',
  type: 'copywriter',
  title,
  pinned: false,
  createdAt: '2026-10-28T08:00:00Z',
  updatedAt: '2026-10-28T08:00:00Z',
  lastActivityAt: '2026-10-28T08:00:00Z',
  state: 'completed',
  ...extra,
});
const run = (id: string, conversationId: string, task: string, extra: object = {}) => ({ id, storeId: 'glow', agentId: 'glow:copywriter', conversationId, task, status: 'done', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, createdAt: '2026-10-28T08:00:00Z', transcript: [], ...extra });
const TYPES = [{ id: 'copywriter', name: 'Copywriter', description: '', baseRole: 'copywriter' }];

/** The workspace's API with `conversations` paged 50 at a time and `threads` 20 at a time (newest page first), like the server. */
function api({ stores = [store(0)], conversations = [] as Conversation[], threads = {} as Record<string, () => object[]> }) {
  const page = <T,>(all: T[], size: number, cursor: string | null, newestFirst = false) => {
    const end = cursor ? Number(cursor) : newestFirst ? all.length : 0;
    const [from, to] = newestFirst ? [Math.max(0, end - size), end] : [end, Math.min(all.length, end + size)];
    const more = newestFirst ? from > 0 : to < all.length;
    return { items: all.slice(from, to), total: all.length, ...(more ? { next: String(newestFirst ? from : to) } : {}) };
  };
  return stubApi((url) => {
    const u = new URL(url, 'http://x');
    const p = u.searchParams;
    if (u.pathname === '/api/stores') return stores;
    if (u.pathname === '/api/health') return { connectors: [] };
    if (u.pathname === '/api/agent-types') return TYPES;
    if (u.pathname === '/api/conversations/counts') return {};
    if (u.pathname === '/api/conversations') {
      const view = p.get('view');
      const items = conversations.filter((c) => (view === 'pinned' ? c.pinned : view === 'archived' ? false : !c.pinned));
      return { ...page(items, 50, p.get('cursor')), byType: { copywriter: items.length } };
    }
    const [, id, thread] = /^\/api\/conversations\/([^/]+)(\/thread)?$/.exec(u.pathname) ?? [];
    const found = conversations.find((c) => c.id === id);
    if (found && thread) return page(threads[found.id]?.() ?? [], 20, p.get('before'), true);
    if (found) return { ...found, config: { runtime: 'demo', tools: [], knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } } };
    return undefined;
  });
}
const renderAt = (path: string, extra?: React.ReactNode) =>
  renderApp(
    <>
      {extra}
      <Routes>
        {['/agents/c/:id', '/agents'].map((p) => (
          <Route key={p} path={p} element={<Workspace />} />
        ))}
      </Routes>
    </>,
    path,
  );
const pane = async () => within(await screen.findByRole('navigation', { name: 'Conversations' }));
const rows = () => document.querySelectorAll('[data-row]').length;

test('500 conversations: the list keeps one page of rows plus Pinned until older ones are asked for', async () => {
  vi.stubGlobal('innerWidth', 1440);
  const all = Array.from({ length: 500 }, (_, i) => conversation(`c${i}`, `Conversation ${i}`, i < 3 ? { pinned: true } : {}));
  api({ conversations: all });
  renderAt('/agents?store=glow');
  const list = await pane();
  await list.findByRole('link', { name: /Conversation 3(?!\d)/ });
  expect(rows()).toBe(50 + 3);
  fireEvent.click(list.getByRole('button', { name: 'Show older' }));
  await list.findByRole('link', { name: /Conversation 60(?!\d)/ });
  expect(rows()).toBe(100 + 3);
});

test('a 300-message thread keeps only the newest page until earlier messages are asked for', async () => {
  vi.stubGlobal('innerWidth', 1440);
  const thread = Array.from({ length: 300 }, (_, i) => run(`r${i}`, 'c1', `Message ${i}`, { transcript: [{ type: 'text_delta', text: `Answer ${i}` }] }));
  api({ conversations: [conversation('c1', 'Long one')], threads: { c1: () => thread } });
  renderAt('/agents/c/c1?store=glow');
  expect(await screen.findByText('Answer 299')).toBeTruthy();
  const shown = () => screen.queryAllByText(/^Answer \d+$/).length;
  expect(shown()).toBe(20);
  expect(screen.queryByText('Answer 279')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show earlier messages' }));
  expect(await screen.findByText('Answer 279')).toBeTruthy();
  expect(shown()).toBe(40);
});

test('25 stores: the store picker scrolls, starts on the current store and moves with the arrow keys', async () => {
  vi.stubGlobal('innerWidth', 1440);
  api({ stores: [store(0), ...Array.from({ length: 24 }, (_, i) => store(i + 1))] });
  renderAt('/agents?store=s12');
  await screen.findByRole('button', { name: 'Store 12: switch store' });
  const picker = document.getElementById('store-switcher')!;
  const items = within(picker).getAllByRole('menuitem', { hidden: true });
  expect(items).toHaveLength(25);
  expect(picker.className).toContain('overflow-y-auto');
  // Opening focuses the current store (Popover's onToggle); ↓/↑ move from there.
  const current = items.find((i) => i.getAttribute('aria-current'))!;
  expect(current.textContent).toContain('Store 12');
  current.focus();
  fireEvent.keyDown(current, { key: 'ArrowDown' });
  expect(document.activeElement?.textContent).toContain('Store 13');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(document.activeElement?.textContent).toContain('Store 11');
  fireEvent.click(items.at(-1)!);
  expect(await screen.findByRole('button', { name: 'Store 24: switch store' })).toBeTruthy();
});

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  constructor() {
    FakeSocket.all.push(this);
  }
  close() {}
}
function Live() {
  useLive();
  return null;
}

test('three runs stream at once, each into its own thread; switching conversations neither mixes nor drops text', async () => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('WebSocket', FakeSocket);
  // The server's side: each run's transcript so far and its event count, which a thread fetch answers with.
  const server: Record<string, { transcript: AgentEvent[]; seq: number; status: string }> = { r1: { transcript: [], seq: 0, status: 'running' }, r2: { transcript: [], seq: 0, status: 'running' }, r3: { transcript: [], seq: 0, status: 'running' } };
  const threadOf = (id: string, c: string) => () => [run(id, c, `Ask ${c}`, { ...server[id], transcript: [...server[id]!.transcript], ...(server[id]!.status === 'running' ? { seq: server[id]!.seq } : {}) })];
  api({
    conversations: [conversation('c1', 'First', { state: 'running' }), conversation('c2', 'Second', { state: 'running' }), conversation('c3', 'Third', { state: 'running' })],
    threads: { c1: threadOf('r1', 'c1'), c2: threadOf('r2', 'c2'), c3: threadOf('r3', 'c3') },
  });
  renderAt('/agents/c/c1?store=glow', <Live />);
  act(() => FakeSocket.all[0]!.onopen?.());
  const emit = (id: string, event: AgentEvent) => {
    const s = server[id]!;
    s.seq++;
    s.transcript.push(event);
    if (event.type === 'done') s.status = 'done';
    act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'run_event', runId: id, agentId: 'glow:copywriter', storeId: 'glow', event, seq: s.seq }) }));
  };
  const say = (id: string, text: string) => emit(id, { type: 'text_delta', text });
  expect(await screen.findByText('Ask c1')).toBeTruthy();
  const list = await pane();
  expect(list.getAllByText('Running')).toHaveLength(3); // each row says its own state

  for (const [word, n] of [['Alpha', 1], ['Beta', 2], ['Gamma', 3]] as const) say(`r${n}`, `${word} one`);
  expect(await screen.findByText('Alpha one')).toBeTruthy();
  for (const [word, n] of [['Alpha', 1], ['Beta', 2], ['Gamma', 3]] as const) say(`r${n}`, ` ${word.toLowerCase()} two`);
  expect(await screen.findByText('Alpha one alpha two')).toBeTruthy();
  expect(screen.queryByText(/Beta|Gamma/)).toBeNull();

  fireEvent.click(list.getByRole('link', { name: /Second/ }));
  expect(await screen.findByText('Beta one beta two')).toBeTruthy();
  say('r2', ' beta three');
  say('r1', ' alpha three'); // the conversation not shown keeps streaming into its copy
  say('r3', ' gamma three');
  expect(await screen.findByText('Beta one beta two beta three')).toBeTruthy();
  expect(screen.queryByText(/Alpha|Gamma/)).toBeNull();

  fireEvent.click(list.getByRole('link', { name: /Third/ }));
  expect(await screen.findByText('Gamma one gamma two gamma three')).toBeTruthy();
  for (const id of ['r1', 'r2', 'r3']) emit(id, { type: 'done', sessionId: 's', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } });
  fireEvent.click(list.getByRole('link', { name: /First/ }));
  expect(await screen.findByText('Alpha one alpha two alpha three')).toBeTruthy();
  expect(screen.queryByText(/Beta|Gamma/)).toBeNull();
});

test("a store's letter is near-black on a light colour and white on a dark one", () => {
  expect(inkOn('#ff8f98')).toBe('#111114');
  expect(inkOn('#ff2a3a')).toBe('#111114');
  expect(inkOn('#c2461c')).toBe('#ffffff');
  expect(inkOn('#13131a')).toBe('#ffffff');
});
