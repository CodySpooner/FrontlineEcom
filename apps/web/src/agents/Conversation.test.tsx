// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { INTERRUPTED, type AgentConfig, type AgentRunDetail, type Conversation as ConversationRecord, type Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Conversation, ReadOnlyRun } from './Conversation';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const store = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected: true } as Store;
const config = { id: 'cfg', storeId: 'glow', agentId: 'glow:ad_strategist', runtime: 'claude', model: 'claude-opus-5-5', effort: 'high', tools: [], knowledge: ['store', 'general'], permissions: { budgetUsd: 3, saveFindings: 'off' }, createdAt: '2026-10-28T09:00:00Z' } as AgentConfig;
const conversation = (state: ConversationRecord['state'] = 'completed'): ConversationRecord => ({
  id: 'c1',
  storeId: 'glow',
  configId: 'cfg',
  agentId: 'glow:ad_strategist',
  type: 'ad_strategist',
  title: 'Plan the holiday test',
  pinned: false,
  createdAt: '2026-10-28T09:00:00Z',
  updatedAt: '2026-10-28T09:00:00Z',
  lastActivityAt: '2026-10-28T10:03:12Z',
  state,
});
const run = (id: string, status: AgentRunDetail['status'], extra: Partial<AgentRunDetail> = {}): AgentRunDetail => ({
  id,
  storeId: 'glow',
  agentId: 'glow:ad_strategist',
  conversationId: 'c1',
  task: 'Plan the test',
  status,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  createdAt: '2026-10-28T10:00:00Z',
  runtime: 'claude',
  model: 'claude-opus-5-5',
  effort: 'high',
  transcript: [],
  ...extra,
});

/** The thread's runs (oldest first); every POST and PATCH is recorded and answered with a queued run. */
function api(runs: AgentRunDetail[]) {
  return stubApi((url, init) => {
    const u = new URL(url, 'http://x');
    if (init?.method === 'POST' && u.pathname === '/api/conversations') return { conversation: { ...conversation(), id: 'c2' }, run: run('n1', 'queued') };
    if (init?.method === 'POST' || init?.method === 'PATCH') return u.pathname.endsWith('/stop') || init.method === 'PATCH' ? conversation() : run('n1', 'queued');
    if (u.pathname === '/api/conversations/c1/thread') return { items: runs, total: runs.length };
    if (u.pathname === '/api/agent-types') return [{ id: 'ad_strategist', name: 'Ad Strategist', description: '', baseRole: 'ad_strategist' }];
    if (u.pathname === '/api/kb/cards/k1') return { id: 'k1', storeId: 'glow', stage: 'supported', title: 'Gift buyers convert', status: 'active' };
    if (u.pathname === '/api/kb/cards/k2') return { id: 'k2', storeId: 'peak', stage: 'validated', title: "Peak's secret", status: 'active' };
    const found = runs.find((r) => u.pathname === `/api/runs/${r.id}`);
    return found;
  });
}
const sent = (fetch: ReturnType<typeof api>, method: string) => fetch.mock.calls.filter(([, init]) => init?.method === method).map(([url, init]) => [url, JSON.parse(String(init!.body ?? '{}'))]);
const show = (c = conversation()) => renderApp(<Conversation store={store} conversation={c} config={config} buttons={null} />);

test('the thread: meta chips, markdown with evidence and numbered citations, activity from real events, attempts and a model handoff', async () => {
  const fetch = api([
    run('r1', 'done', { task: 'First look', runtime: 'demo', model: undefined, effort: undefined, transcript: [{ type: 'text_delta', text: 'Hello' }] }),
    run('r2', 'error', { state: 'failed', error: 'Rate limited', transcript: [{ type: 'tool_call', id: 't', name: 'propose_ad_change', input: {} }, { type: 'tool_result', id: 't', output: 'ok', isError: false }, { type: 'error', message: 'Rate limited' }] }),
    run('r3', 'done', {
      retryOf: 'r2',
      startedAt: '2026-10-28T10:00:00Z',
      endedAt: '2026-10-28T10:03:12Z',
      usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.42 },
      transcript: [
        { type: 'notice', text: "Ran at High: Max isn't available on this account." },
        { type: 'tool_call', id: '1', name: 'metrics_timeseries', input: { days: 14 } },
        { type: 'tool_result', id: '1', output: 'csv', isError: false },
        { type: 'tool_call', id: '2', name: 'search_knowledge', input: { query: 'gift' } },
        { type: 'tool_result', id: '2', output: 'cards', isError: false },
        { type: 'text_delta', text: '| Angle | Budget |\n|---|---|\n| Gift | $600 |\n\nGift wins [kb:k1] [measured]. Not [kb:k2]. Again [kb:k1].' },
      ],
    }),
  ]);
  show();
  expect(await screen.findByText('Worked for 3m 12s · 3 steps')).toBeTruthy();
  expect(screen.getByText("Ran at High: Max isn't available on this account.")).toBeTruthy(); // never hidden (decision 9)
  expect(screen.getByRole('heading', { name: 'Plan the holiday test' }).getAttribute('title')).toBe('Plan the holiday test');
  for (const text of ['Claude · Opus 5.5 · High', 'This run $0.42 of $3.00', 'Glow Haus']) expect(screen.getAllByText(text)[0]).toBeTruthy(); // the runtime is also on each reply
  expect(screen.getByText(/^Switched to Claude · Opus 5\.5 · High · the history stays here/)).toBeTruthy();
  expect(screen.getByText('Read 14 days of store metrics')).toBeTruthy();
  expect(screen.getByText('Searched the knowledge base for "gift"')).toBeTruthy();
  expect(within(screen.getByRole('table')).getByText('$600')).toBeTruthy();
  expect(screen.getByText('Measured')).toBeTruthy();
  // Citations number in order of first use; a card cited again keeps its number; another store's card shows no title.
  expect(screen.getAllByRole('link', { name: '1' }).map((a) => a.getAttribute('href'))).toEqual(['/knowledge?card=k1&ws=glow', '/knowledge?card=k1&ws=glow']);
  const sources = screen.getByLabelText('Sources');
  expect((await within(sources).findByText('Gift buyers convert')).closest('a')!.getAttribute('href')).toBe('/knowledge?card=k1&ws=glow');
  expect(within(sources).getByText('Research-Supported')).toBeTruthy();
  expect(await within(sources).findByText('not available in this store')).toBeTruthy();
  expect(within(sources).queryByText("Peak's secret")).toBeNull();
  // The failed attempt folds under its retry, saying it acted.
  expect(screen.getByText('Attempt 1 · failed')).toBeTruthy();
  expect(screen.getByText(/may have changed something before it ended: it ran propose_ad_change/)).toBeTruthy();
  // Retry only on the latest reply.
  const retry = screen.getAllByRole('button', { name: 'Retry' });
  expect(retry).toHaveLength(1);
  fireEvent.click(retry[0]!);
  await vi.waitFor(() => expect(sent(fetch, 'POST')[0]?.[0]).toBe('/api/conversations/c1/runs/r3/retry?store=glow'));
});

test('the header: rename inline, pin from the menu, and Stop only while a reply runs', async () => {
  const fetch = api([run('r1', 'running')]);
  show(conversation('running'));
  fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Holiday plan' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Pin', hidden: true }));
  fireEvent.click(screen.getByRole('button', { name: /Stop run/ }));
  await vi.waitFor(() => expect(sent(fetch, 'POST')).toHaveLength(1));
  expect(sent(fetch, 'PATCH')).toEqual([
    ['/api/conversations/c1?store=glow', { title: 'Holiday plan' }],
    ['/api/conversations/c1?store=glow', { pinned: true }],
  ]);
  expect(sent(fetch, 'POST')).toEqual([['/api/conversations/c1/stop?store=glow', {}]]);
  expect(screen.getByText('Running')).toBeTruthy();
  cleanup();
  show();
  await screen.findByText('Done');
  expect(screen.queryByRole('button', { name: /Stop run/ })).toBeNull();
});

test('the composer keeps a draft per conversation, sends on Enter, and a queued message can be cancelled', async () => {
  localStorage.setItem('fe.agents.draft.c1', 'Half typed');
  const fetch = api([run('r1', 'running', { transcript: [{ type: 'tool_call', id: '1', name: 'list_campaigns', input: {} }] }), run('r2', 'queued', { task: 'And the winter angle?' })]);
  show(conversation('running'));
  const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  expect(box.value).toBe('Half typed');
  fireEvent.change(box, { target: { value: 'Scale the winner' } });
  expect(await screen.findByText('Draft saved')).toBeTruthy();
  expect(localStorage.getItem('fe.agents.draft.c1')).toBe('Scale the winner');
  // The running reply's activity is open and says what it's doing.
  expect(await screen.findByText('Working · 1 step')).toBeTruthy();
  expect(screen.getByText('Read the ad campaigns').closest('details')!.open).toBe(true);
  // The queued message waits behind it, with Cancel.
  expect(screen.getByText('Queued: sends when this reply finishes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(box, { key: 'Enter' });
  await vi.waitFor(() => expect(box.value).toBe(''));
  const posts = sent(fetch, 'POST');
  expect(posts[0]).toEqual(['/api/conversations/c1/stop?store=glow', { runId: 'r2' }]);
  expect(posts[1]![0]).toBe('/api/conversations/c1/messages?store=glow');
  expect(posts[1]![1]).toMatchObject({ message: 'Scale the winner', clientRequestId: expect.any(String) });
  expect(localStorage.getItem('fe.agents.draft.c1')).toBeNull();
});

test('the context chip links back to what the conversation was opened from; a reply links what it made', async () => {
  const done = run('r1', 'done', {
    transcript: [{ type: 'text_delta', text: 'Done.' }],
    deliverables: [
      { kind: 'creative', id: 'cr1', title: 'Glow in 3 steps', creativeKind: 'copy' },
      { kind: 'page_draft', id: 'pd 1', title: 'Serum page' },
      { kind: 'flow_draft', id: 'fd1', title: 'Welcome flow' },
      { kind: 'campaign', id: 'glow-c1', title: 'Prospecting · Broad' },
    ],
  });
  api([done]);
  show({ ...conversation(), context: { kind: 'campaign', network: 'meta', id: 'glow-c1', name: 'Prospecting · Broad' } });
  expect((await screen.findByRole('link', { name: 'Campaign · Prospecting · Broad' })).getAttribute('href')).toBe('/analytics');
  const made = within(await screen.findByLabelText('Made in this reply'));
  expect(made.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['Creative · Glow in 3 steps', '/creative?tab=copy'],
    ['Page draft · Serum page', '/builder?draft=pd%201'],
    ['Campaign · Prospecting · Broad', '/analytics'],
  ]);
  fireEvent.click(made.getByRole('button', { name: 'Flow draft · Welcome flow' }));
  expect(screen.getByTestId('where').textContent).toBe('/?settings=email_sms&tab=flows');
  cleanup();
  api([done]);
  show({ ...conversation(), context: { kind: 'run', id: 'r0', name: 'Weekly ad check' } });
  expect((await screen.findByRole('link', { name: 'Continued from · Weekly ad check' })).getAttribute('href')).toBe('/agents?store=glow&run=r0');
});

test('an interrupted reply shows the banner with Resume, and no Retry', async () => {
  const fetch = api([run('r1', 'error', { error: INTERRUPTED, state: 'interrupted', transcript: [{ type: 'text_delta', text: 'Half an answer' }] })]);
  show(conversation('interrupted'));
  expect(await screen.findByText(/Interrupted: the app quit while this reply was running/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await vi.waitFor(() => expect(sent(fetch, 'POST')[0]?.[0]).toBe('/api/conversations/c1/runs/r1/resume?store=glow'));
});

test('a run with no conversation reads alone with Continue, except an Ask KB all-stores run and one that compared stores', async () => {
  const plain = run('r9', 'done', { conversationId: undefined, task: 'Weekly ad check', transcript: [{ type: 'text_delta', text: 'All good' }] });
  const fetch = api([plain]);
  renderApp(<ReadOnlyRun store={store} run={plain} buttons={null} />);
  expect(await screen.findByText('All good')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'First message' }), { target: { value: 'Now scale the best one' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue in a new conversation' }));
  await vi.waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/agents/c/c2?store=glow'));
  expect(sent(fetch, 'POST')[0]).toEqual(['/api/conversations?store=glow', { clientRequestId: expect.any(String), fromRunId: 'r9', message: 'Now scale the best one' }]);
  for (const other of [
    run('r10', 'done', { conversationId: undefined, task: 'Which hooks work? The cards come from every store and General: compare them, and say which store each finding is from.' }),
    run('r11', 'done', { conversationId: undefined, transcript: [{ type: 'tool_call', id: '1', name: 'mcp__frontline__compare_stores', input: {} }] }),
  ]) {
    cleanup();
    api([other]);
    renderApp(<ReadOnlyRun store={store} run={other} buttons={null} />);
    expect(await screen.findByText(/read other stores' data/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue in a new conversation' })).toBeNull();
  }
});

test('a conversation from before the store went live sends the refused message as a new conversation in one click', async () => {
  const fetch = stubApi((url, init) => {
    const u = new URL(url, 'http://x');
    if (init?.method === 'POST' && u.pathname === '/api/conversations/c1/messages') return new Response(JSON.stringify({ error: 'That conversation ran on demo data, before the store went live: start a new one.' }), { status: 409 });
    if (init?.method === 'POST' && u.pathname === '/api/conversations') return { conversation: { ...conversation(), id: 'c2' }, run: run('n1', 'queued') };
    if (u.pathname === '/api/conversations/c1/thread') return { items: [run('r1', 'done')], total: 1 };
    if (u.pathname === '/api/runs/r1') return run('r1', 'done');
    return undefined;
  });
  show();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Headlines for the real catalog' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Send as a new conversation' }));
  await vi.waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/agents/c/c2?store=glow'));
  const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => [url, JSON.parse(String(init!.body))]);
  expect(posts).toEqual([
    ['/api/conversations/c1/messages?store=glow', { clientRequestId: expect.any(String), message: 'Headlines for the real catalog' }],
    ['/api/conversations?store=glow', { clientRequestId: expect.any(String), type: 'ad_strategist', message: 'Headlines for the real catalog' }],
  ]);
});

test("while the agent waits on its question, the composer answers it and the card says to answer below", async () => {
  const q = { id: 'q1', storeId: 'glow', agentId: 'glow:ad_strategist', runId: 'r1', conversationId: 'c1', title: 'Which budget?', reason: 'Test at $40/day or $80/day?', status: 'pending', createdAt: '2026-10-28T10:01:00Z', action: { kind: 'question', payload: {} } };
  const asking = run('r1', 'running', { transcript: [{ type: 'approval_request', approval: q as never }] });
  const fetch = stubApi((url, init) => {
    const u = new URL(url, 'http://x');
    if (init?.method === 'POST') return { ...q, status: 'approved', decisionNote: '$40/day' };
    if (u.pathname === '/api/approvals' && u.searchParams.get('status') === 'pending') return [q];
    if (u.pathname === '/api/approvals') return [];
    if (u.pathname === '/api/conversations/c1/thread') return { items: [asking], total: 1 };
    if (u.pathname === '/api/agent-types') return [{ id: 'ad_strategist', name: 'Ad Strategist', description: '', baseRole: 'ad_strategist' }];
    return u.pathname === '/api/runs/r1' ? asking : undefined;
  });
  show(conversation('waiting_for_input'));
  expect(await screen.findByText('Answer in the message box below.')).toBeTruthy();
  expect(screen.getByText('Needs reply')).toBeTruthy();
  const box = await screen.findByPlaceholderText("Answer Ad Strategist's question");
  fireEvent.change(box, { target: { value: '$40/day' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
  await vi.waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => [url, JSON.parse(String(init!.body))])).toEqual([['/api/approvals/q1/answer?store=glow', { text: '$40/day' }]]));
  await vi.waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
});
