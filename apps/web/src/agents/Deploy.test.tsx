// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { CODEX_ULTRA, type AgentPreset, type Store } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { Deploy } from './Deploy';
import { Workspace } from './Workspace';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const store = (id: string, name: string, connected: boolean) => ({ id, name, platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#c2461c', connected }) as Store;
const STORES = [store('glow', 'Glow Botanics', false), store('peak', 'Peak Gear', true)];
const type = (id: string, name: string, baseRole = id) => ({ id, name, description: `${name} does things.`, baseRole, contract: { tools: [] } });
const preset = (id: string, name: string, config: Partial<AgentPreset['config']>, builtin = false): AgentPreset => ({ id, name, builtin, createdAt: '', config: { role: 'copywriter', ...config } });
const GROUPS: Record<string, object[]> = {
  copywriter: [
    { id: 'data', name: 'Store data', access: 'read', tools: ['store_summary', 'list_products'] },
    { id: 'creatives', name: 'Creatives', access: 'approval', tools: ['create_creative'], integration: { kind: 'higgsfield', connected: false } },
    { id: 'drafts', name: 'Drafts and changes', access: 'approval', tools: ['draft_page', 'publish_page'] },
  ],
  ad_strategist: [
    { id: 'data', name: 'Store data', access: 'read', tools: ['store_summary', 'list_campaigns'] },
    { id: 'drafts', name: 'Drafts and changes', access: 'approval', tools: ['propose_ad_change'] },
  ],
};

/** `codex`: Codex's row as the server reports it ('' signed in, else its reason); null leaves it out. */
function api({ autonomy = 'ask', posts = [] as { url: string; body: unknown }[], refuse = 0, codex = null as string | null } = {}) {
  let refusals = refuse;
  stubApi((url, init) => {
    const u = new URL(url, 'http://x');
    const s = u.searchParams.get('store');
    if (init?.method === 'POST') {
      posts.push({ url: `${u.pathname}${u.search}`, body: JSON.parse(String(init.body)) });
      if (refusals-- > 0) return reply({ error: 'A run budget is a positive number of dollars.', field: 'permissions.budgetUsd' }, 400);
      if (u.pathname === '/api/presets') return preset('p9', 'Saved', {});
      if (u.pathname === '/api/runtimes/codex/setup') return reply({ started: true }, 202);
      if (u.pathname === '/api/conversations/c1/config') return reply({ error: 'That conversation ran on demo data, before the store went live: start a new one.' }, 409);
      return reply({ conversation: { id: 'new1', storeId: s }, run: { id: 'r1', storeId: s, agentId: `${s}:copywriter`, status: 'queued', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } } }, 201);
    }
    if (u.pathname === '/api/stores') return STORES;
    if (u.pathname === '/api/agent-types') return [type('copywriter', 'Copywriter'), type('ad_strategist', 'Ad Strategist'), type('cr1', 'Brand voice', 'copywriter')];
    if (u.pathname === '/api/presets') {
      const t = u.searchParams.get('type')!;
      const voice = preset('p2', 'Brand voice preset', { customRoleId: 'cr1', runtime: 'claude', model: 'claude-opus-5-5' });
      if (t === 'copywriter')
        return [
          preset('default:copywriter', 'Write store copy', {}, true),
          preset('p1', 'Short voice', { runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'low', tools: ['store_summary', 'list_products', 'create_creative', 'publish_page'], permissions: { budgetUsd: 2, stopAfterMin: 15, saveFindings: 'ask' }, objective: 'Write the spring hero line' }),
          voice,
        ];
      return t === 'cr1' ? [preset('default:cr1', 'Brand voice', {}, true), voice] : [preset(`default:${t}`, 'Plan campaigns', {}, true)];
    }
    if (u.pathname === '/api/tool-groups') return GROUPS[u.searchParams.get('type')!] ?? GROUPS.copywriter;
    if (u.pathname === '/api/runtimes')
      return [
        {
          runtime: 'claude', connected: true, source: 'discovered', checkedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
          models: [
            { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', default: true },
            { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
            { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', efforts: [] },
          ],
        },
        ...(codex === null
          ? []
          : [
              {
                runtime: 'codex', connected: !codex, ...(codex ? { reason: codex } : {}), source: 'discovered', version: '0.163.0', checkedAt: new Date(Date.now() - 60_000).toISOString(),
                models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', description: 'Latest workhorse model.', efforts: ['low', 'medium', 'high', 'ultra'], defaultEffort: 'low', default: true }],
              },
            ]),
      ];
    if (u.pathname === '/api/agents') return ['glow', 'peak'].map((id) => ({ id: `${id}:ad_strategist`, storeId: id, role: 'ad_strategist', enabled: true, autonomy, status: 'idle' }));
    if (u.pathname === '/api/caps') return [{ storeId: s, autopilot: { 'ads.set_budget': { enabled: true, maxUsdPerDay: 50 } } }];
    if (u.pathname === '/api/conversations') return { items: [], total: 0, byType: { copywriter: 1 } };
    if (u.pathname === '/api/conversations/c1') return { id: 'c1', storeId: 'glow', configId: 'cfg', agentId: 'glow:copywriter', type: 'copywriter', title: 'Spring hero line', pinned: false, createdAt: '', updatedAt: '', lastActivityAt: '', state: 'completed', config: { id: 'cfg', runtime: 'demo', tools: [], knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } } };
    if (u.pathname === '/api/conversations/c1/thread') return { items: [], total: 0 };
    return undefined;
  });
}
const dialog = () => screen.getByRole('dialog', { name: 'Deploy an agent' });
const radio = (group: string, name: string | RegExp) => within(within(dialog()).getByRole('radiogroup', { name: group })).getByRole('radio', { name });
const spending = () => screen.getByText('Ask before spending money').textContent;
const renderDeploy = (storeId = 'glow', typeId = 'copywriter') =>
  renderApp(
    <Routes>
      <Route path="*" element={<Deploy store={STORES.find((s) => s.id === storeId)!} type={typeId} onClose={() => undefined} />} />
    </Routes>,
    '/agents?store=glow',
  );

test('Deploy agent opens Deploy on the store, with Demo (free) on a demo store; New conversation preselects its type', async () => {
  api();
  renderApp(
    <Routes>
      {['/agents/c/:id', '/agents'].map((p) => (
        <Route key={p} path={p} element={<Workspace />} />
      ))}
    </Routes>,
    '/agents?store=glow',
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Deploy agent' }));
  expect(screen.getByTestId('where').textContent).toContain('deploy=');
  expect((await within(dialog()).findByRole('radio', { name: /^Copywriter/ })).getAttribute('aria-checked')).toBe('true');
  expect(radio('Runtime', 'Demo (free)').getAttribute('aria-checked')).toBe('true');
  expect(within(dialog()).getByText('Demo data')).toBeTruthy();
  expect(within(dialog()).queryByRole('combobox', { name: 'Model' })).toBeNull();
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Deploy an agent' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'New conversation', hidden: true }));
  expect(screen.getByTestId('where').textContent).toContain('deploy=copywriter');
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Deploy an agent' })).getByRole('button', { name: 'Close' }));
  fireEvent.click(await screen.findByRole('button', { name: /more agent types/ }));
  fireEvent.click(screen.getByRole('button', { name: 'New conversation with Ad Strategist' }));
  expect(screen.getByTestId('where').textContent).toContain('deploy=ad_strategist');
  expect((await within(dialog()).findByRole('radio', { name: /^Ad Strategist/ })).getAttribute('aria-checked')).toBe('true');
});

test('a preset fills every field; Start sends exactly that config, and a refusal shows on its field', async () => {
  const posts: { url: string; body: unknown }[] = [];
  api({ posts, refuse: 1 });
  renderDeploy();
  const presets = await screen.findByRole('combobox', { name: 'Start from a preset' });
  await waitFor(() => expect((presets as HTMLSelectElement).value).toBe('default:copywriter'));
  fireEvent.change(presets, { target: { value: 'p1' } });
  await waitFor(() => expect(radio('Runtime', 'Claude').getAttribute('aria-checked')).toBe('true'));
  expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe('claude-sonnet-5-5');
  expect(radio('Effort', 'Low').getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('Models and effort levels come from your Claude connection, checked 2 min ago.')).toBeTruthy();
  expect(screen.getByText('This store has demo data: the agent works on sample numbers and uses your real Claude usage.')).toBeTruthy();
  expect((screen.getByRole('switch', { name: 'Draft pages' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('switch', { name: 'Make creatives' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('spinbutton', { name: 'Budget for this run' }) as HTMLInputElement).value).toBe('2');
  expect((screen.getByRole('spinbutton', { name: 'Stop after' }) as HTMLInputElement).value).toBe('15');
  expect(radio('Save findings to knowledge', 'Ask me').getAttribute('aria-checked')).toBe('true');
  expect((screen.getByRole('textbox', { name: 'Objective' }) as HTMLTextAreaElement).value).toBe('Write the spring hero line');
  expect((screen.getByRole('textbox', { name: /Conversation title/ }) as HTMLInputElement).value).toBe('Write the spring hero line');
  expect(screen.getByText('Suggested')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  expect(await screen.findByText('A run budget is a positive number of dollars.')).toBeTruthy();
  expect(screen.getByText('Checked by the app before it starts. An unsupported combination is refused with the reason.')).toBeTruthy(); // the field has it, not the footer
  fireEvent.change(screen.getByRole('textbox', { name: /Conversation title/ }), { target: { value: 'Hero line' } });
  expect(screen.queryByText('Suggested')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/agents/c/new1?store=glow'));
  const [first, second] = posts.map((p) => p.body as Record<string, unknown>);
  expect(second).toEqual({
    clientRequestId: first!.clientRequestId,
    type: 'copywriter',
    message: 'Write the spring hero line',
    title: 'Hero line',
    config: { runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'low', tools: ['store_summary', 'list_products', 'create_creative', 'publish_page'], knowledge: ['store', 'general'], permissions: { budgetUsd: 2, stopAfterMin: 15, saveFindings: 'ask' } },
  });
});

test('a custom-role preset selects that role, a type change goes back to its Default, and Save as preset saves the choices', async () => {
  const posts: { url: string; body: unknown }[] = [];
  api({ posts });
  renderDeploy();
  const presets = await screen.findByRole('combobox', { name: 'Start from a preset' });
  await waitFor(() => expect((presets as HTMLSelectElement).value).toBe('default:copywriter'));
  fireEvent.change(presets, { target: { value: 'p2' } });
  await waitFor(() => expect(radio('Agent type', /^Brand voice/).getAttribute('aria-checked')).toBe('true'));
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Start from a preset' }) as HTMLSelectElement).value).toBe('p2'));
  // A model without effort levels shows no effort picker and sends none.
  fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), { target: { value: 'claude-haiku-4-5-20251001' } });
  expect(within(dialog()).queryByRole('radiogroup', { name: 'Effort' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save as preset' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Preset name' }), { target: { value: 'Haiku voice' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toEqual({ url: '/api/presets?store=glow', body: { name: 'Haiku voice', type: 'cr1', config: { runtime: 'claude', model: 'claude-haiku-4-5-20251001', knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } } } });
  fireEvent.click(radio('Agent type', /^Ad Strategist/));
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Start from a preset' }) as HTMLSelectElement).value).toBe('default:ad_strategist'));
  expect(radio('Runtime', 'Demo (free)').getAttribute('aria-checked')).toBe('true');
});

test("spending's locked row: autopilot's kind and cap when the seat, the store's rule and the ad-proposal tool all allow it, else Always", async () => {
  api({ autonomy: 'autopilot' });
  renderDeploy('peak', 'ad_strategist');
  await screen.findByRole('switch', { name: 'Propose ad pauses and budgets' });
  expect(spending()).toBe('Ask before spending moneyAutopilot: Change ad budgets up to $50/day · Agent settings');
  expect(within(dialog()).getByRole('button', { name: 'Agent settings' })).toBeTruthy();
  expect(within(dialog()).queryByRole('radio', { name: 'Demo (free)' })).toBeNull(); // a live store never runs on the demo engine
  fireEvent.click(screen.getByRole('switch', { name: 'Propose ad pauses and budgets' }));
  expect(spending()).toBe('Ask before spending moneyAlways');
  cleanup();
  api({ autonomy: 'ask' });
  renderDeploy('peak', 'ad_strategist');
  await screen.findByRole('switch', { name: 'Propose ad pauses and budgets' });
  expect(spending()).toBe('Ask before spending moneyAlways');
});

test('"Change runtime or model…" opens from the runtime chip and posts the new choice; a refusal shows its reason', async () => {
  const posts: { url: string; body: unknown }[] = [];
  api({ posts });
  renderApp(
    <Routes>
      <Route path="/agents/c/:id" element={<Workspace />} />
    </Routes>,
    '/agents/c/c1?store=glow',
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Demo (free): change runtime or model' }));
  const change = await screen.findByRole('dialog', { name: 'Change runtime or model' });
  const switchTo = within(change).getByRole('button', { name: 'Switch' });
  expect(switchTo.hasAttribute('disabled')).toBe(true); // nothing changed yet
  fireEvent.click(within(change).getByRole('radio', { name: 'Claude' }));
  fireEvent.click(await within(change).findByRole('radio', { name: 'High' }));
  fireEvent.click(switchTo);
  expect(await within(change).findByText('That conversation ran on demo data, before the store went live: start a new one.')).toBeTruthy();
  expect(posts).toEqual([{ url: '/api/conversations/c1/config?store=glow', body: { runtime: 'claude', model: 'claude-opus-5-5', effort: 'high' } }]);
});

test('Codex in Deploy: Set up Codex when signed out, ultra refused with its reason, Stop after required and no budget, and Start sends a Codex config', async () => {
  const posts: { url: string; body: unknown }[] = [];
  api({ posts, codex: 'Set up Codex' });
  renderDeploy('peak');
  fireEvent.click(await within(dialog()).findByRole('radio', { name: 'Codex' }));
  expect(radio('Runtime', 'Codex').title).toBe('Set up Codex');
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Set up Codex' }));
  expect(await within(dialog()).findByText(/^Sign in to Codex in the browser window that opened, then check again./)).toBeTruthy();
  expect(posts).toEqual([{ url: '/api/runtimes/codex/setup', body: {} }]);
  expect(within(dialog()).getByRole('button', { name: 'Check again' })).toBeTruthy();
  const ultra = radio('Effort', 'Ultra');
  expect([ultra.getAttribute('aria-disabled'), ultra.title]).toEqual(['true', CODEX_ULTRA]);
  fireEvent.click(ultra);
  expect(radio('Effort', 'Low').getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('Models and effort levels come from your Codex CLI 0.163.0, checked 1 min ago.')).toBeTruthy();
  expect(screen.getByText(/^Codex replies appear when complete\./)).toBeTruthy();
  expect(screen.queryByRole('spinbutton', { name: 'Budget for this run' })).toBeNull();
  expect((screen.getByRole('spinbutton', { name: 'Stop after' }) as HTMLInputElement).value).toBe('20');
  fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), { target: { value: 'Write the hero line' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect((posts[1]!.body as { config: object }).config).toEqual({ runtime: 'codex', model: 'gpt-6.1-sol', effort: 'low', knowledge: ['store', 'general'], permissions: { stopAfterMin: 20, saveFindings: 'off' } });
});

test('Codex shows only when the server reports it; moving a conversation to Codex sends a Stop after', async () => {
  api();
  renderDeploy();
  await within(dialog()).findByRole('radio', { name: 'Claude' });
  expect(within(dialog()).queryByRole('radio', { name: 'Codex' })).toBeNull();
  cleanup();
  const posts: { url: string; body: unknown }[] = [];
  api({ posts, codex: '' });
  renderApp(
    <Routes>
      <Route path="/agents/c/:id" element={<Workspace />} />
    </Routes>,
    '/agents/c/c1?store=glow',
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Demo (free): change runtime or model' }));
  const change = await screen.findByRole('dialog', { name: 'Change runtime or model' });
  fireEvent.click(within(change).getByRole('radio', { name: 'Codex' }));
  expect((within(change).getByRole('spinbutton', { name: 'Stop after' }) as HTMLInputElement).value).toBe('20');
  fireEvent.click(within(change).getByRole('button', { name: 'Switch' }));
  await waitFor(() => expect(posts).toEqual([{ url: '/api/conversations/c1/config?store=glow', body: { runtime: 'codex', model: 'gpt-6.1-sol', effort: 'low', stopAfterMin: 20 } }]));
});

test("Deploy's attachments go with the first message", async () => {
  const posts: { url: string; body: unknown }[] = [];
  api({ posts });
  renderDeploy();
  fireEvent.click(await screen.findByRole('button', { name: /^Tools and knowledge/ }));
  fireEvent.change(screen.getByLabelText('Documents to attach'), { target: { files: [new File(['brief'], 'brief.txt')] } });
  expect(await screen.findByRole('button', { name: /^Tools and knowledge.* · 1 attached$/ })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), { target: { value: 'Use the brief' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]!.body).toMatchObject({ message: 'Use the brief', attachments: [{ name: 'brief.txt', data: btoa('brief') }] });
});
