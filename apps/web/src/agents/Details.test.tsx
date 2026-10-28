// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { AgentRunDetail, ConversationDetail, Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Conversation } from './Conversation';
import { Details, type DetailsTab } from './Details';
import { useStored } from './layout';
import { SettingsDrawer } from './settings';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const store = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected: true } as Store;
const detail = (tools: string[]): ConversationDetail => ({
  id: 'c1',
  storeId: 'glow',
  configId: 'cfg',
  agentId: 'glow:ad_strategist',
  type: 'ad_strategist',
  title: 'Plan the holiday test',
  pinned: false,
  createdAt: '2026-10-28T09:00:00Z',
  updatedAt: '2026-10-28T09:00:00Z',
  lastActivityAt: '2026-10-28T10:00:00Z',
  state: 'failed',
  config: { id: 'cfg', storeId: 'glow', agentId: 'glow:ad_strategist', runtime: 'claude', model: 'claude-opus-5-5', effort: 'high', tools, knowledge: ['store', 'general'], permissions: { budgetUsd: 3, saveFindings: 'off' }, createdAt: '2026-10-28T09:00:00Z' },
});
const run = (id: string, status: AgentRunDetail['status'], extra: Partial<AgentRunDetail> = {}): AgentRunDetail => ({
  id,
  storeId: 'glow',
  agentId: 'glow:ad_strategist',
  conversationId: 'c1',
  task: `Task ${id}`,
  status,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.42 },
  createdAt: '2026-10-28T10:00:00Z',
  startedAt: '2026-10-28T10:00:00Z',
  endedAt: '2026-10-28T10:01:05Z',
  runtime: 'claude',
  model: 'claude-opus-5-5',
  transcript: [],
  ...extra,
});

function api({ autonomy = 'ask', tools = ['store_summary', 'list_campaigns', 'propose_ad_change', 'meta_ads'] }: { autonomy?: string; tools?: string[] } = {}) {
  return stubApi((url) => {
    const u = new URL(url, 'http://x');
    if (u.pathname === '/api/conversations/c1') return detail(tools);
    if (u.pathname === '/api/conversations/c1/thread') return { items: [run('r1', 'done'), run('r2', 'error', { error: 'Rate limited' })], total: 2 };
    if (u.pathname === '/api/conversations/c1/tools')
      return [
        { id: 'data', name: 'Store data', access: 'read', tools: ['store_summary', 'list_campaigns'] },
        { id: 'drafts', name: 'Drafts and changes', access: 'approval', tools: ['propose_ad_change'] },
        { id: 'meta_ads', name: 'Meta Ads (MCP)', access: 'approval', tools: [], integration: { kind: 'meta_ads', connected: false } },
      ];
    if (u.pathname === '/api/agents') return [{ id: 'glow:ad_strategist', storeId: 'glow', role: 'ad_strategist', enabled: true, autonomy, status: 'idle' }];
    if (u.pathname === '/api/caps') return [{ storeId: 'glow', adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, agentCostPerDay: 10, autopilot: { 'ads.set_budget': { enabled: true, maxUsdPerDay: 50 } } }];
    if (u.pathname === '/api/claude-account') return { signedIn: true, checkedAt: '2026-10-28T10:00:00Z' };
    if (u.pathname === '/api/runs') return [run('r9', 'done', { conversationId: undefined, task: 'Weekly ad check' })];
    if (u.pathname === '/api/agent-types')
      return [
        {
          id: 'ad_strategist', name: 'Ad Strategist', description: 'Runs paid acquisition.', baseRole: 'ad_strategist',
          contract: { responsibility: 'You run paid acquisition.', kpi: 'blended ROAS', workflow: ['Establish the objective.', 'Read the campaigns.'], tools: ['review_campaigns', 'meta_ads'], knowledge: ['advertising'], outputs: ['Moves.'], checks: ['List the questions still open.'] },
        },
      ];
    return undefined;
  });
}
/** The panel as the workspace holds it: the tab kept per browser. */
function Panel() {
  const [tab, setTab] = useStored<DetailsTab>('fe.agents.tab', 'details');
  return <Details store={store} conversationId="c1" tab={tab} onTab={setTab} />;
}
const tool = (name: string) => screen.getByText(name).closest('li')!;

test('Details: runtime, tools with access and connection state, the approval lines and limits; spending asks unless autopilot applies', async () => {
  api();
  renderApp(<Panel />);
  expect(await screen.findByText('Claude · signed in')).toBeTruthy();
  expect(screen.getByText('Opus 5.5 · High effort')).toBeTruthy();
  expect(screen.getByText("Fixed when the conversation started. Other stores' data is never read.")).toBeTruthy();
  expect(within(await screen.findByText('Store data').then((e) => e.closest('li')!)).getByText('Read')).toBeTruthy();
  expect(within(tool('Drafts and changes')).getByText('Drafts need approval')).toBeTruthy();
  expect(within(tool('Meta Ads (MCP)')).getByRole('link', { name: 'Set up' }).getAttribute('href')).toBe('/integrations');
  expect(screen.getByText('Spending always asks you first.')).toBeTruthy();
  expect(screen.getByText('This run $0.42 of $3.00')).toBeTruthy();
  expect(screen.getByText('No limit')).toBeTruthy(); // Stop after
  cleanup();
  // On autopilot with a rule on, and propose_ad_change among the tools: the rule, and the drafts group says so.
  api({ autonomy: 'autopilot', tools: ['store_summary', 'propose_ad_change', 'compare_stores'] });
  renderApp(<Panel />);
  expect(await screen.findByText('Change ad budgets up to $50/day is auto-approved (autopilot)')).toBeTruthy();
  expect(within(await screen.findByText('Drafts and changes').then((e) => e.closest('li')!)).getByText('Autopilot up to the caps below')).toBeTruthy();
  expect(screen.getByText(/^Also reads your other stores' names/)).toBeTruthy();
  cleanup();
  // Autopilot without propose_ad_change: spending still asks.
  api({ autonomy: 'autopilot', tools: ['store_summary'] });
  renderApp(<Panel />);
  expect(await screen.findByText('Spending always asks you first.')).toBeTruthy();
});

test("'Role instructions and checks' opens the type's contract", async () => {
  api();
  renderApp(<Panel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Role instructions and checks' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ad Strategist: role instructions and checks' });
  expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Establish the objective.', 'Read the campaigns.', 'Moves.', 'List the questions still open.']);
  expect(within(dialog).getByText('review campaigns, Meta Ads')).toBeTruthy();
  expect(within(dialog).getByText('Knowledge areas: advertising')).toBeTruthy();
});

test('Activity lists the runs newest first with runtime, cost, duration and the error', async () => {
  api();
  renderApp(<Panel />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
  const rows = await screen.findAllByRole('listitem');
  expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/^Failed1m 5sTask r2Claude · Opus 5\.5 · \$0\.42Rate limited/), expect.stringMatching(/^Done1m 5sTask r1Claude · Opus 5\.5 · \$0\.42$/)]);
  expect(localStorage.getItem('fe.agents.tab')).toBe('"activity"');
});

test('the conversation menu opens the seat settings drawer; a History row opens the run', async () => {
  api();
  renderApp(
    <>
      <Conversation store={store} conversation={detail([])} config={detail([]).config} buttons={null} />
      <SettingsDrawer storeId="glow" />
    </>,
    '/agents/c/c1?store=glow',
  );
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Agent settings', hidden: true }));
  const drawer = await screen.findByRole('dialog', { name: 'Ad Strategist settings' });
  expect(screen.getByTestId('where').textContent).toBe('/agents/c/c1?store=glow&settings=ad_strategist&tab=settings');
  expect(await within(drawer).findByText('Deployment')).toBeTruthy();
  expect(within(drawer).queryByRole('tab', { name: 'Flows' })).toBeNull(); // Email & SMS only
  fireEvent.click(within(drawer).getByRole('tab', { name: 'History' }));
  fireEvent.click(await within(drawer).findByRole('button', { name: 'Weekly ad check' }));
  expect(screen.getByTestId('where').textContent).toBe('/agents?store=glow&run=r9');
});

test("the Knowledge tab lists the latest reply's cards, the store's then General's, with how each was used and a count, then the findings saved here", async () => {
  const fetch = api();
  const stub = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/conversations/c1/knowledge?store=glow'
      ? new Response(JSON.stringify([
          { id: 'k1', title: 'Gift buyers convert', stage: 'supported', storeId: 'glow', how: ['prompt', 'cited'] },
          { id: 'k3', title: 'Hooks in general', stage: 'hypothesis', storeId: null, how: ['search'] },
        ]))
      : url === '/api/conversations/c1/findings?store=glow'
        ? new Response(JSON.stringify([{ id: 'k9', title: 'Photo strips lift add-to-cart', stage: 'hypothesis', storeId: 'glow', status: 'proposed', at: '2026-10-28T10:00:00Z' }]))
        : stub(url, init),
  );
  renderApp(<Panel />);
  const tab = await screen.findByRole('tab', { name: 'Knowledge 2' });
  fireEvent.click(tab);
  const panel = screen.getByRole('tabpanel', { name: 'Knowledge' });
  await within(panel).findByText('Saved from this conversation');
  expect(within(panel).getAllByRole('heading').map((h) => h.textContent)).toEqual(["Glow Haus's knowledge", 'General knowledge', 'Saved from this conversation']);
  expect(within(panel).getByRole('link', { name: 'Photo strips lift add-to-cart' }).closest('li')!.textContent).toBe('Photo strips lift add-to-cartUnreviewed');
  expect(within(panel).getByRole('link', { name: 'Gift buyers convert' }).getAttribute('href')).toBe('/knowledge?card=k1&ws=glow');
  expect(within(panel).getByText('Research-Supported · In its prompt · Cited')).toBeTruthy();
  expect(within(panel).getByText('Hypothesis, unproven · Searched for')).toBeTruthy();
});
