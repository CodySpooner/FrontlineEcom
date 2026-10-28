// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import type { Conversation, SquadMission, SquadMissionStep, Store } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { Workspace } from './Workspace';

const scrolled: string[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const STORES = [{ id: 'glow', name: 'Glow Botanics', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected: false } as Store];
const cfg = (id: string, agent = 'copywriter') => ({ id, storeId: 'glow', agentId: `glow:${agent}`, runtime: 'demo', tools: [], knowledge: ['store', 'general'], permissions: { saveFindings: 'off' }, createdAt: '' });
const said = (summary: string, extra = {}) => ({ summary, output: `${summary} In full.`, evidence: [], openQuestions: [], disagreesWith: [], ...extra });
const step = (id: string, configId: string, extra: Partial<SquadMissionStep>): SquadMissionStep => ({ id, kind: 'task', role: 'copywriter', configId, task: id, dependsOn: [], status: 'waiting', ...extra });
const RUNNING: SquadMission = {
  id: 'tm1',
  storeId: 'glow',
  title: 'Spring launch',
  createdAt: '2026-10-28T10:00:00Z',
  status: 'running',
  kind: 'team',
  objective: 'Plan the spring launch for the LED mask.',
  conversationId: 'tc1',
  maxConcurrent: 2,
  retries: 2,
  spentUsd: 0,
  ownerNotes: [],
  participants: [
    { configId: 'k-lead', name: 'Analytics Specialist', type: 'market_analyst', config: cfg('k-lead', 'market_analyst') as never },
    { configId: 'k-a', name: 'Copywriter', type: 'copywriter', config: cfg('k-a') as never },
    { configId: 'k-b', name: 'Ad Strategist', type: 'ad_strategist', config: cfg('k-b', 'ad_strategist') as never },
  ],
  steps: [
    step('plan', 'k-lead', { kind: 'plan', role: 'market_analyst', task: 'Plan the spring launch', status: 'done', runId: 'r-plan' }),
    step('t1', 'k-a', { task: 'Write three hooks', status: 'done', runId: 'r-t1', contribution: said('Three hooks, the first on the glow.', { evidence: ['https://example.com/trend', '[kb:card1]'] }) }),
    step('t2', 'k-b', { role: 'ad_strategist', task: 'Plan the test', dependsOn: ['t1'], status: 'done', runId: 'r-t2', contribution: said('A $300 test on hook one.', { disagreesWith: ['t1: lead with the price, not the glow.'] }) }),
    step('t3', 'k-a', { task: 'Write the page', dependsOn: ['t2'], status: 'error', interrupted: true, note: 'Interrupted by an app restart: resume it to go on.', runId: 'r-t3' }),
    step('synthesis', 'k-lead', { kind: 'synthesis', role: 'market_analyst', dependsOn: ['t1', 't2', 't3'] }),
  ],
};
const DONE: SquadMission = {
  ...RUNNING,
  id: 'tm2',
  title: 'Summer plan',
  conversationId: 'tc2',
  status: 'done',
  steps: [...RUNNING.steps.slice(0, 3), { ...RUNNING.steps[4]!, status: 'done', runId: 'r-syn', unresolved: ['The Ad Strategist, task t2 disagrees: t1: lead with the price.'] }],
};
const conversation = (id: string, title: string, extra: Partial<Conversation> = {}): Conversation => ({ id, storeId: 'glow', configId: `cfg-${id}`, agentId: 'glow:copywriter', type: 'copywriter', title, pinned: false, createdAt: '2026-10-28T10:00:00Z', updatedAt: '2026-10-28T10:00:00Z', lastActivityAt: '2026-10-28T10:00:00Z', state: 'completed', ...extra });
// A team's conversation row keeps the lead's type; only the list's filter and counts call it 'team'.
const lead = { type: 'market_analyst', agentId: 'glow:market_analyst', state: 'idle' } as const;
const CONVERSATIONS = [conversation('tc1', 'Spring launch', { ...lead, teamId: 'tm1' }), conversation('tc2', 'Summer plan', { ...lead, teamId: 'tm2' }), conversation('c1', 'Spring hero line')];
const text = (t: string) => [{ type: 'text_delta', text: t }];
const run = (id: string, extra: object = {}) => ({ id, storeId: 'glow', agentId: 'glow:copywriter', task: 'A team step', status: 'done', runtime: 'demo', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, createdAt: '2026-10-28T10:05:00Z', endedAt: '2026-10-28T10:06:00Z', transcript: [], teamId: 'tm1', ...extra });
const RUNS: Record<string, object> = {
  'r-plan': run('r-plan'),
  'r-t1': run('r-t1', { transcript: text('Hook one: the glow. [kb:card1]') }),
  'r-t2': run('r-t2', { transcript: text('Test plan in full.') }),
  'r-t3': run('r-t3', { status: 'error', error: 'Interrupted by an app restart.' }),
  'r-syn': run('r-syn', { teamId: 'tm2', transcript: text('The team agrees on the glow hook.') }),
  'r-f1': run('r-f1', { teamId: undefined, conversationId: 'tc2', task: 'Which line do we test first?', transcript: text('Line one, at $300.') }),
};
const TYPES = [
  { id: 'copywriter', name: 'Copywriter', description: '', baseRole: 'copywriter' },
  { id: 'ad_strategist', name: 'Ad Strategist', description: '', baseRole: 'ad_strategist' },
];
const RUNTIMES = [{ runtime: 'claude', connected: true, source: 'registry', registryVersion: '2026-10-28', checkedAt: '', models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium'], defaultEffort: 'medium', default: true }] }];

function api({ posts = [] as { url: string; body: unknown }[], refuse = undefined as object | undefined } = {}) {
  return stubApi((url, init) => {
    const u = new URL(url, 'http://x');
    const asked = u.searchParams.get('store');
    if (init?.method === 'POST') {
      posts.push({ url: `${u.pathname}${u.search}`, body: JSON.parse(String(init.body)) });
      if (refuse && u.pathname === '/api/teams') return reply(refuse, 400);
      if (u.pathname === '/api/teams') return reply({ ...RUNNING, id: 'tm9' }, 201);
      if (u.pathname.endsWith('/messages')) return reply(run('r-f2', { conversationId: 'tc2', status: 'queued' }), 201);
      if (u.pathname.endsWith('/resume')) return reply(run('r-t3b', { status: 'queued' }), 201);
      return RUNNING;
    }
    if (u.pathname === '/api/stores') return STORES;
    if (u.pathname === '/api/health') return { connectors: [] };
    if (u.pathname === '/api/agent-types') return TYPES;
    if (u.pathname === '/api/runtimes') return RUNTIMES;
    if (u.pathname === '/api/conversations/counts') return {};
    if (u.pathname === '/api/conversations') {
      const type = u.searchParams.get('type');
      const items = asked !== 'glow' || u.searchParams.get('view') ? [] : CONVERSATIONS.filter((c) => !type || (c.type === type && !c.teamId));
      return { items, total: items.length, byType: { team: 2, copywriter: 1 } };
    }
    const team = /^\/api\/teams\/(\w+)$/.exec(u.pathname)?.[1];
    if (team) return asked === 'glow' && (team === 'tm1' || team === 'tm2') ? (team === 'tm1' ? RUNNING : DONE) : reply({ error: 'Team not found' }, 404);
    const r = /^\/api\/runs\/([\w-]+)$/.exec(u.pathname)?.[1];
    if (r) return RUNS[r] ?? reply({ error: 'Run not found' }, 404);
    if (u.pathname.startsWith('/api/kb/cards/card1')) return { id: 'card1', title: 'Glow hooks work', storeId: 'glow', stage: 'supported' };
    const [, id, thread] = /^\/api\/conversations\/([^/]+)(\/thread)?$/.exec(u.pathname) ?? [];
    const found = CONVERSATIONS.find((c) => c.id === id);
    if (thread) return id === 'tc2' ? { items: [RUNS['r-f1']], total: 1 } : { items: [], total: 0 };
    if (found) return { ...found, config: cfg(found.configId) };
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

test('a team URL reopens the team: the plan with dependencies, contributions with sources and handoffs, Unresolved with Compare both, Resume, To: Lead as a note, Stop team', async () => {
  const posts: { url: string; body: unknown }[] = [];
  api({ posts });
  renderAt('/agents/t/tm1?store=glow');
  expect(await screen.findByRole('heading', { name: 'Spring launch' })).toBeTruthy();
  expect(screen.getByText('max 2 at once · 2 retries per task')).toBeTruthy(); // no Claude participant: no money
  const plan = within(screen.getByLabelText('Plan'));
  expect(plan.getByText(/Ad Strategist · Plan the test/).textContent).toContain('after 1');
  expect(plan.getByText('Interrupted by an app restart: resume it to go on.')).toBeTruthy();
  fireEvent.click(plan.getByRole('button', { name: 'Resume' }));
  await waitFor(() => expect(posts.at(-1)).toEqual({ url: '/api/teams/tm1/steps/t3/resume?store=glow', body: { clientRequestId: expect.any(String) } }));

  expect((await screen.findAllByText(/finished · Demo \(free\) · \$0\.00/)).length).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: '2 sources' }));
  const sources = within(screen.getByLabelText('Sources for task 1'));
  expect(sources.getByRole('link', { name: 'https://example.com/trend' }).getAttribute('href')).toBe('https://example.com/trend');
  expect(await sources.findByText('Glow hooks work')).toBeTruthy();
  expect(screen.getByText("Task 1's contribution handed to Ad Strategist")).toBeTruthy();
  expect(screen.getByText("Task 2's contribution handed to Copywriter")).toBeTruthy();

  expect(screen.getByText(/Ad Strategist \(task 2\) disagrees with Copywriter \(task 1\): lead with the price, not the glow\./)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Compare both' }));
  const compare = within(screen.getByRole('dialog', { name: 'Compare both' }));
  expect(compare.getByText('Three hooks, the first on the glow. In full.')).toBeTruthy();
  expect(compare.getByText('A $300 test on hook one. In full.')).toBeTruthy();
  fireEvent.click(compare.getByRole('button', { name: /close/i }));
  expect(screen.getByText(/Final synthesis by the lead arrives after tasks 1 to 3\./)).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Message the lead'), { target: { value: 'Keep the price under $40.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(posts.at(-1)).toEqual({ url: '/api/teams/tm1/notes?store=glow', body: { clientRequestId: expect.any(String), text: 'Keep the price under $40.' } }));
  expect(screen.queryByRole('button', { name: /Add agent/ })).toBeNull(); // the lead has planned
  fireEvent.click(screen.getByRole('button', { name: /Stop team/ }));
  await waitFor(() => expect(posts.at(-1)).toEqual({ url: '/api/teams/tm1/cancel?store=glow', body: {} }));
  // The details panel starts closed for a team; opened, it's the team variant.
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
  const details = within(await screen.findByRole('dialog', { name: 'Details' }));
  expect(details.getByText('Sub-teams: Off')).toBeTruthy();
  expect(details.getAllByText('Demo (free)').length).toBe(3);
});

test("a team step's run link opens the team on that participant's tab, scrolled to the run; Open full output does the same", async () => {
  api();
  renderAt('/agents?store=glow&run=r-t2');
  await screen.findByRole('tab', { name: /Ad Strategist/ });
  expect(screen.getByTestId('where').textContent).toBe('/agents/t/tm1?store=glow&run=r-t2');
  expect(screen.getByRole('tab', { name: /Ad Strategist/ }).getAttribute('aria-selected')).toBe('true');
  expect(await screen.findByText('Test plan in full.')).toBeTruthy();
  expect(scrolled).toContain('run-r-t2');
  fireEvent.click(screen.getByRole('tab', { name: 'Thread' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Open full output' }).length).toBe(2)); // each card waits for its run
  fireEvent.click(screen.getAllByRole('button', { name: 'Open full output' })[0]!);
  expect(screen.getByRole('tab', { name: /Copywriter/ }).getAttribute('aria-selected')).toBe('true');
  expect(within(screen.getByRole('region', { name: 'Task 1' })).getByText('Write three hooks', { exact: false })).toBeTruthy();
  await waitFor(() => expect(scrolled).toContain('run-r-t1'));
  cleanup();
  api();
  renderAt('/agents/t/tm1?store=peak');
  expect(await screen.findByText('Store not found')).toBeTruthy();
  cleanup();
  api();
  renderAt('/agents/t/nope?store=glow');
  expect(await screen.findByText('Team not found')).toBeTruthy();
});

test("an ended team shows its synthesis and follow-ups, and To: Lead sends a message in the team's conversation", async () => {
  const posts: { url: string; body: unknown }[] = [];
  api({ posts });
  renderAt('/agents/t/tm2?store=glow');
  expect(await screen.findByText('The team agrees on the glow hook.')).toBeTruthy();
  expect(await screen.findByText('Which line do we test first?')).toBeTruthy();
  expect(await screen.findByText('Line one, at $300.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Stop team/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Message the lead'), { target: { value: 'And the second?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(posts.at(-1)).toEqual({ url: '/api/conversations/tc2/messages?store=glow', body: { clientRequestId: expect.any(String), message: 'And the second?' } }));
});

test("the list's team rows: 'N agents' and participant sub-rows while a team runs, Ready with its unresolved count after; a team's conversation opens the team", async () => {
  api();
  renderAt('/agents/c/tc1?store=glow');
  expect(await screen.findByRole('heading', { name: 'Spring launch' })).toBeTruthy();
  expect(screen.getByTestId('where').textContent).toBe('/agents/t/tm1?store=glow');
  const list = within(screen.getByRole('navigation', { name: 'Conversations' }));
  const running = await list.findByRole('link', { name: /Spring launch/ });
  expect(running.getAttribute('href')).toBe('/agents/t/tm1?store=glow');
  expect(running.getAttribute('aria-current')).toBe('page');
  await waitFor(() => expect(running.textContent).toContain('3 agents'));
  // The sub-row: its dot's word, the role, and the task it's on (here its interrupted one).
  expect(list.getByRole('link', { name: /Copywriter.*Write the page/ }).getAttribute('href')).toBe('/agents/t/tm1?store=glow&participant=k-a');
  expect(list.getByRole('link', { name: /Summer plan/ }).textContent).toContain('Ready · 1 unresolved');
  fireEvent.click(list.getByRole('button', { name: /Create team/ }));
  expect(await screen.findByRole('dialog', { name: 'Create a team' })).toBeTruthy();
  expect(screen.getByTestId('where').textContent).toContain('create=team');
});

test('Add agent shows while the lead is still planning, and adds a participant', async () => {
  const posts: { url: string; body: unknown }[] = [];
  const planning = { ...RUNNING, steps: [{ ...RUNNING.steps[0]!, status: 'running' as const }] };
  const fetch = api({ posts });
  const answer = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url: string, init?: RequestInit) => (new URL(url, 'http://x').pathname === '/api/teams/tm1' && !init?.method ? reply(planning) : answer(url, init)));
  renderAt('/agents/t/tm1?store=glow');
  expect(await screen.findByText('is planning the work')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Add agent/ }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Add agent' }));
  await dialog.findByRole('group', { name: 'New participant' });
  fireEvent.click(dialog.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(posts.at(-1)).toEqual({ url: '/api/teams/tm1/participants?store=glow', body: { type: 'copywriter', config: { runtime: 'demo' } } }));
});

test('Create team: participants with a lead (sent first), a team budget only with a Claude participant, a refusal under its row', async () => {
  const posts: { url: string; body: unknown }[] = [];
  api({ posts, refuse: { error: 'Codex needs a "Stop after" limit.', field: 'participants.0.runtime' } });
  renderAt('/agents?store=glow&create=team');
  const dialog = within(await screen.findByRole('dialog', { name: 'Create a team' }));
  fireEvent.change(dialog.getByLabelText('Shared objective'), { target: { value: 'Plan the spring launch for the LED mask.' } });
  await dialog.findByRole('group', { name: 'Participant 1' });
  expect(dialog.queryByLabelText('Team budget')).toBeNull(); // the demo engine isn't charged
  fireEvent.click(dialog.getByRole('button', { name: /Add participant/ }));
  const second = within(dialog.getByRole('group', { name: 'Participant 2' }));
  fireEvent.change(second.getByLabelText('Agent type'), { target: { value: 'ad_strategist' } });
  fireEvent.change(second.getByLabelText('Ad Strategist: runtime, model and effort'), { target: { value: 'claude|claude-opus-5-5|medium' } });
  fireEvent.click(second.getByRole('radio', { name: 'Lead' }));
  fireEvent.change(dialog.getByLabelText('Team budget'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start team' }));
  await waitFor(() => expect(posts.at(-1)?.url).toBe('/api/teams?store=glow'));
  expect(posts.at(-1)!.body).toEqual({
    clientRequestId: expect.any(String),
    title: 'Plan the spring launch for the LED mask.',
    objective: 'Plan the spring launch for the LED mask.',
    participants: [
      { type: 'ad_strategist', config: { runtime: 'claude', model: 'claude-opus-5-5', effort: 'medium' } },
      { type: 'copywriter', config: { runtime: 'demo' } },
    ],
    budgetUsd: 5,
    maxConcurrent: 2,
    retries: 2,
  });
  // The refusal names participants.0, the lead: it shows under the lead's row, the second on screen.
  expect(await second.findByText('Codex needs a "Stop after" limit.')).toBeTruthy();
});

test('Collaborate opens Create team with the conversation as the lead, lending its settings, and its title as the objective', async () => {
  const posts: { url: string; body: unknown }[] = [];
  api({ posts });
  renderAt('/agents/c/c1?store=glow');
  fireEvent.click(await screen.findByRole('button', { name: /Collaborate/ }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Create a team' }));
  expect((dialog.getByLabelText('Shared objective') as HTMLTextAreaElement).value).toBe('Spring hero line');
  const lead = within(await dialog.findByRole('group', { name: 'Participant 1' }));
  await waitFor(() => expect((lead.getByLabelText('Copywriter: new or from a conversation') as HTMLSelectElement).value).toBe('c1'));
  fireEvent.change(dialog.getByLabelText('Shared objective'), { target: { value: 'Turn the hero line into a launch plan.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start team' }));
  await waitFor(() => expect(posts.at(-1)?.url).toBe('/api/teams?store=glow'));
  expect((posts.at(-1)!.body as { participants: unknown }).participants).toEqual([{ type: 'copywriter', fromConversationId: 'c1' }]);
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/agents/t/tm9?store=glow'));
});
