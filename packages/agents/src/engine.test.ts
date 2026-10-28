import type { HookCallback, McpSdkServerConfigWithInstance, ModelInfo, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Agent, AgentConfig, AgentEvent, AgentRole, Store } from '@frontline/shared';
import { describe, expect, test } from 'vitest';
import { APP_TOOLS, claudeAccount, claudeEngine, claudeModels, defaultEngine, estimate, fakeEngine, ROLES, runAgent, toAgentEvents, type RunInput, type ToolEnv } from './index';

const store: Store = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'America/Chicago', color: '#ff8f98', connected: false };
const agent: Agent = { id: 'glow:market_analyst', storeId: 'glow', role: 'market_analyst', status: 'idle' };
const input: RunInput = { agent, store, task: 'Summarize last week' };

async function collect(events: AsyncIterable<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}
const text = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');

describe('fake engine', () => {
  test('streams a deterministic reply and ends with done', async () => {
    const events = await collect(runAgent(input, fakeEngine()));
    expect(text(events)).toBe('Analytics Specialist for Glow Haus: on it — "Summarize last week".');
    expect(events.at(-1)).toEqual({ type: 'done', sessionId: 'fake-glow:market_analyst', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });
    expect(await collect(runAgent(input, fakeEngine()))).toEqual(events);
    const job = await collect(runAgent({ ...input, task: 'Daily briefing: compare yesterday with the 7-day average. Then act.' }, fakeEngine()));
    expect(text(job)).toBe('Analytics Specialist for Glow Haus: on it — "Daily briefing".');
  });

  test('resume keeps the session id', async () => {
    const events = await collect(runAgent({ ...input, resume: 'sess-1' }, fakeEngine()));
    expect(events.at(-1)).toMatchObject({ type: 'done', sessionId: 'sess-1' });
  });

  test('a research run has only the research tools', async () => {
    const events = await collect(runAgent({ ...input, mode: 'research', env: {} as ToolEnv }, fakeEngine(() => [{ call: 'store_summary' }])));
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ output: 'Tool store_summary is not available', isError: true });
  });

  test('plays a custom script', async () => {
    const script: AgentEvent[] = [
      { type: 'tool_call', id: 't1', name: 'analytics_summary', input: { range: 7 } },
      { type: 'tool_result', id: 't1', output: '{"revenue":1200}', isError: false },
      { type: 'done', sessionId: 's', usage: { inputTokens: 1, outputTokens: 2, costUsd: 0 } },
    ];
    expect(await collect(runAgent(input, fakeEngine(() => script)))).toEqual(script);
  });
});

test("claudeAccount reads the login and its models without a prompt, isolated as runs are, and says why when it can't", async () => {
  const closed: string[] = [];
  const opened: Options[] = [];
  const models = [{ value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Most capable', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] }];
  const fake = (account: () => Promise<object>) =>
    (({ options }: { options: Options }) => (opened.push(options), { initializationResult: async () => ({ account: await account(), models }), close: () => closed.push(String(options.cwd)) })) as never;
  // The two shapes Claude Code answered on a real machine (signed in; empty config dir).
  expect(await claudeAccount('/s', fake(async () => ({ email: 'o@x.com', organization: 'O', subscriptionType: 'Claude Max', apiProvider: 'firstParty' })))).toEqual({
    signedIn: true, email: 'o@x.com', subscription: 'Claude Max', checkedAt: expect.any(String),
    models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', description: 'Most capable', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' }],
  });
  expect(await claudeAccount('/s', fake(async () => ({ tokenSource: 'none', apiProvider: 'firstParty' })))).toMatchObject({ signedIn: false });
  expect((await claudeAccount('/s', fake(async () => ({ tokenSource: 'none', apiKeySource: 'ANTHROPIC_API_KEY' })))).signedIn).toBe(true);
  expect(await claudeAccount('/s', fake(() => new Promise(() => {})), 10)).toMatchObject({ signedIn: false, error: "Claude Code didn't answer in 0.01 s." });
  expect(closed).toEqual(['/s', '/s', '/s', '/s']); // the CLI is never left running
  expect(opened.every((o) => o.settingSources?.length === 0 && o.cwd === '/s')).toBe(true);
});

test("discovered models dedupe on the id an alias resolves to, keep the alias's name, and take default efforts from the registry", () => {
  const all = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
  // Rows as Claude Code answered on this machine (AA-01), plus a model the registry doesn't know.
  const rows = [
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5', supportedEffortLevels: [...all] },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Most capable', supportedEffortLevels: [...all] },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: '', supportedEffortLevels: [...all] },
    { value: 'claude-opus-4-7', displayName: 'Opus 4.7', description: '', supportedEffortLevels: [...all] },
    { value: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
    { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: '' },
    { value: 'claude-next-9', displayName: 'Next 9', description: '', supportedEffortLevels: ['low', 'medium'] },
  ] as ModelInfo[];
  expect(claudeModels(rows).map((m) => [m.id, m.label, m.defaultEffort, m.default ?? false, m.effortsFromRegistry ?? false])).toEqual([
    ['claude-opus-5-5', 'Opus 5.5', 'medium', true, false],
    ['claude-sonnet-5-5', 'Sonnet 5.5', 'medium', false, false],
    ['claude-opus-4-7', 'Opus 4.7', 'xhigh', false, false],
    ['claude-sonnet-4-6', 'Sonnet 4.6', 'high', false, false],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5', undefined, false, true], // no effort fields: the registry says it takes none
    ['claude-next-9', 'Next 9', 'low', false, false],
  ]);
  expect(claudeModels(rows).find((m) => m.id === 'claude-haiku-4-5-20251001')?.efforts).toEqual([]);
});

test('connected stores get Claude and demo stores the fake engine, unless the env forces one', async () => {
  const named = (name: string) => async function* (): AsyncGenerator<AgentEvent> {
    yield { type: 'text_delta', text: name };
  };
  const pick = async (connected: boolean) => text(await collect(defaultEngine(named('claude'), named('fake'))({ ...input, store: { ...store, connected } })));
  const [forced, vitest] = [process.env.FRONTLINE_AGENT_ENGINE, process.env.VITEST];
  try {
    delete process.env.FRONTLINE_AGENT_ENGINE;
    expect(await pick(true)).toBe('fake'); // a test run without the root config still never reaches Claude
    delete process.env.VITEST;
    expect([await pick(true), await pick(false)]).toEqual(['claude', 'fake']);
    // Research needs a real model even on a demo store: the demo engine can't read the web.
    expect(text(await collect(defaultEngine(named('claude'), named('fake'))({ ...input, mode: 'research' })))).toBe('claude');
    // The owner picked Claude for this conversation on a demo store.
    expect(text(await collect(defaultEngine(named('claude'), named('fake'))({ ...input, config: { runtime: 'claude' } as AgentConfig })))).toBe('claude');
    process.env.FRONTLINE_AGENT_ENGINE = 'claude';
    expect(await pick(false)).toBe('claude');
  } finally {
    process.env.FRONTLINE_AGENT_ENGINE = forced;
    process.env.VITEST = vitest;
  }
  expect([await pick(true), process.env.FRONTLINE_AGENT_ENGINE]).toEqual(['fake', 'fake']);
});

describe('runAgent', () => {
  test('turns a thrown error into an error event', async () => {
    const boom = async function* (): AsyncGenerator<AgentEvent> {
      yield { type: 'text_delta', text: 'hi' };
      throw new Error('login expired');
    };
    expect(await collect(runAgent(input, boom))).toEqual([{ type: 'text_delta', text: 'hi' }, { type: 'error', message: 'login expired' }]);
  });

  test('adds an error when the engine stops without a result, Cancelled when aborted', async () => {
    const silent = async function* (): AsyncGenerator<AgentEvent> {};
    expect(await collect(runAgent(input, silent))).toEqual([{ type: 'error', message: 'Run ended without a result' }]);
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await collect(runAgent({ ...input, signal: ctrl.signal }, fakeEngine()))).toEqual([{ type: 'error', message: 'Cancelled' }]);
  });

  test('stops after the first terminal event', async () => {
    const chatty = fakeEngine(() => [
      { type: 'error', message: 'first' },
      { type: 'text_delta', text: 'late' },
    ]);
    expect(await collect(runAgent(input, chatty))).toEqual([{ type: 'error', message: 'first' }]);
  });
});

// Minimal SDK frames; only the fields toAgentEvents reads.
const sdk = (m: object) => m as SDKMessage;
const frames = [
  sdk({ type: 'system', subtype: 'init', session_id: 'abc' }),
  sdk({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Revenue ' } } }),
  sdk({ type: 'stream_event', parent_tool_use_id: 'sub', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'subagent' } } }),
  sdk({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } } }),
  sdk({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Revenue ' }, { type: 'tool_use', id: 'tu1', name: 'mcp__frontline__analytics_summary', input: { range: 7 } }] } }),
  sdk({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '{"revenue":1200}' }] }] } }),
  sdk({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'is up.' } } }),
  sdk({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Revenue is up.',
    session_id: 'abc',
    total_cost_usd: 0.012,
    usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 },
  }),
];

describe('Claude engine', () => {
  test('maps SDK frames to agent events', () => {
    expect(frames.flatMap((m) => toAgentEvents(m))).toEqual([
      { type: 'text_delta', text: 'Revenue ' },
      { type: 'tool_call', id: 'tu1', name: 'analytics_summary', input: { range: 7 } },
      { type: 'tool_result', id: 'tu1', output: '{"revenue":1200}', isError: false },
      { type: 'text_delta', text: 'is up.' },
      { type: 'done', sessionId: 'abc', usage: { inputTokens: 115, outputTokens: 7, costUsd: 0.012 } },
    ]);
  });

  test('maps failed results to error events', () => {
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'error_max_turns', errors: [] }))).toEqual([{ type: 'error', message: 'Stopped: the run hit its 40-turn limit before finishing. Give it a narrower task.', code: 'error_max_turns' }]);
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'error_max_turns', errors: [], session_id: 'abc' }))[0]).toMatchObject({ sessionId: 'abc' }); // the next message goes on from it
    const u = { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10_000, output_tokens: 500 };
    expect(estimate(u)).toBeCloseTo(0.032);
    expect(estimate(u, 'claude-sonnet-5-5')).toBeCloseTo(0.016); // 2 + 8 + 1 + 5 thousandths (cache reads $0.10)
    expect(estimate(u, 'claude-haiku-5-5')).toBeCloseTo(0.00085, 5); // 0.1 + 0.4 + 0.1 + 0.25 thousandths
    // Haiku 5.5 prompts over 100K tokens pay its higher prices: 0.5 + 6 + 1.25 thousandths.
    expect(estimate({ input_tokens: 1000, cache_read_input_tokens: 120_000, output_tokens: 500 }, 'claude-haiku-5-5')).toBeCloseTo(0.00775, 5);
    expect(estimate(u, 'claude-haiku-4-5-20251001')).toBeCloseTo(0.0085); // a legacy model at its own prices, not its family's
    expect(estimate(u, 'claude-fable-5')).toBeCloseTo(0.085); // cache reads $1
    expect(estimate(u, 'claude-opus-4-8-20260101')).toBeCloseTo(0.0425); // a dated id
    expect(estimate(u, 'some-new-model')).toBe(estimate(u));
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'error_max_budget_usd', errors: ['x'] }))[0]).toMatchObject({ message: expect.stringMatching(/^Stopped: the run used its share of today's AI budget/) });
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'error_during_execution', errors: ['boom', 'bang'] }))).toEqual([{ type: 'error', message: 'Stopped: boom; bang. Retry; if it happens again, start a new conversation.', code: 'error_during_execution' }]);
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' }))).toEqual([{ type: 'error', message: 'Not logged in', code: 'unknown' }]);
    // Account problems arrive on an assistant message first, worded for Claude Code ("run /login"): the owner gets Frontline's words.
    const failed = (error: string) => toAgentEvents(sdk({ type: 'assistant', parent_tool_use_id: null, error, message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } }));
    expect(failed('authentication_failed')).toEqual([{ type: 'error', message: expect.stringMatching(/^Claude isn't signed in on this computer\. Open a terminal, run `claude`/), code: 'authentication_failed' }]);
    expect(failed('rate_limit')[0]).toMatchObject({ message: expect.stringMatching(/usage limit/) });
    expect(failed('server_error')).toEqual([]);
    // Any other flagged error explains the failed result, with its code (the run manager retries the passing ones).
    const result = (flagged: string) => toAgentEvents(sdk({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529' }), undefined, flagged as never);
    expect(result('overloaded')).toEqual([{ type: 'error', message: 'Claude is overloaded right now. Retry in a few minutes.', code: 'overloaded' }]);
    expect(result('max_output_tokens')[0]).toMatchObject({ message: expect.stringMatching(/output limit\. Retry and ask for a shorter answer/), code: 'max_output_tokens' });
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's' }), undefined, 'max_output_tokens')[0]).toMatchObject({ type: 'done' }); // recovered
  });

  test('passes prompt, resume and isolation options to query()', async () => {
    let seen: { prompt: string; options: Options } | undefined;
    const engine = claudeEngine({
      model: 'claude-opus-5-5',
      queryOptions: () => ({ maxTurns: 3 }),
      query: (params) => {
        seen = params;
        return (async function* () {
          yield* frames;
        })();
      },
    });
    const events = await collect(runAgent({ ...input, resume: 'abc', systemPrompt: 'SYS' }, engine));
    expect(text(events)).toBe('Revenue is up.');
    expect(seen?.prompt).toBe('Summarize last week');
    expect(seen?.options).toMatchObject({
      model: 'claude-opus-5-5',
      systemPrompt: 'SYS',
      resume: 'abc',
      includePartialMessages: true,
      settingSources: [],
      tools: ['WebSearch', 'WebFetch'],
      skills: [],
      strictMcpConfig: true, // the owner's claude.ai connectors stay out of agent runs
      maxTurns: 3,
      effort: 'medium', // always explicit: Opus 5.5's default, not whatever the bundled CLI defaults to
    });
    expect(seen?.options).not.toHaveProperty('fallbackModel');
  });

  test("a configured run asks for its model and effort, records what ran, and says so when that differs", async () => {
    let options: Options | undefined;
    const said: object[] = [];
    const engine = claudeEngine({
      query: (params) => {
        options = params.options;
        return (async function* () {
          yield sdk({ type: 'system', subtype: 'init', session_id: 'abc', model: 'claude-sonnet-5' });
          const hook = params.options.hooks!.Stop![0]!.hooks[0] as HookCallback;
          await hook({ hook_event_name: 'Stop', effort: { level: 'medium' } } as never, undefined, { signal: new AbortController().signal });
          yield* frames.slice(1);
        })();
      },
    });
    const config = { model: 'claude-sonnet-5-5', effort: 'max', tools: [] } as unknown as AgentConfig;
    const events = await collect(runAgent({ ...input, config, onRuntime: (r) => said.push(r) }, engine));
    expect(options).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'max' });
    expect(said).toEqual([{ runtime: 'claude', model: 'claude-sonnet-5-5', effort: 'max' }, { actualModel: 'claude-sonnet-5' }, { effortApplied: 'medium' }]);
    expect(events.filter((e) => e.type === 'notice')).toEqual([
      { type: 'notice', text: "Ran on Sonnet 5: Sonnet 5.5 wasn't used for this reply." },
      { type: 'notice', text: "Ran at Medium: Max isn't available on this account." },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  test('a Fable run without usage credits says what to do', () => {
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'success', is_error: true, result: 'This model requires usage credits.' }))[0]).toMatchObject({
      message: 'Fable bills usage credits on your Claude plan, and none are available. Add usage credits at claude.ai, or choose another model for this agent.',
    });
  });

  test("a resumed session's running total becomes this query's own cost; errors carry what was spent", async () => {
    const result = (o: object) => sdk({ type: 'result', session_id: 'abc', total_cost_usd: 0.5, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 2 }, ...o });
    const engine = (frame: SDKMessage) => claudeEngine({ query: () => (async function* () { yield frame; })() });
    const ok = await collect(runAgent({ ...input, resume: 'abc', sessionCostUsd: 0.2 }, engine(result({ subtype: 'success', is_error: false, result: 'x' }))));
    expect(ok.at(-1)).toEqual({ type: 'done', sessionId: 'abc', usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.3 } });
    const stopped = await collect(runAgent(input, engine(result({ subtype: 'error_max_turns', is_error: true, errors: [] }))));
    expect(stopped.at(-1)).toMatchObject({ type: 'error', usage: { costUsd: 0.5 } });
  });

  test('tells the run its conversation as soon as Claude starts one, so a cancelled reply can still be continued', async () => {
    const seen: string[] = [];
    const engine = claudeEngine({ query: () => (async function* () { yield sdk({ type: 'system', subtype: 'init', session_id: 'abc' }); })() });
    await collect(runAgent({ ...input, onSession: (id) => seen.push(id) }, engine));
    expect(seen).toEqual(['abc']);
  });

  test('reports its running spend from each assistant message, once per message id', async () => {
    const said = (id: string, output_tokens: number) => sdk({ type: 'assistant', parent_tool_use_id: null, message: { id, content: [], usage: { input_tokens: 1000, output_tokens } } });
    const engine = claudeEngine({ query: () => (async function* () { yield* [said('m1', 0), said('m1', 500), said('m2', 1000)]; })() });
    const spent: number[] = [];
    await collect(runAgent({ ...input, onSpend: (usd) => spent.push(usd) }, engine));
    expect(spent.map((n) => n.toFixed(3))).toEqual(['0.004', '0.014', '0.038']); // m1 counted once, at its final count
  });

  test('caps every run at 40 turns and at what is left of the daily AI budget', async () => {
    let seen: Options | undefined;
    const engine = claudeEngine({
      query: (params) => {
        seen = params.options;
        return (async function* () {
          yield* frames;
        })();
      },
    });
    await collect(runAgent({ ...input, budgetUsd: 1.25 }, engine));
    expect(seen).toMatchObject({ maxTurns: 40, maxBudgetUsd: 1.25 });
    await collect(runAgent(input, engine));
    expect(seen?.maxBudgetUsd).toBeUndefined();
  });

  test('a research run searches the web with the research tools only, gets 30 turns, and says why it stopped in research terms', async () => {
    let seen: Options | undefined;
    const engine = claudeEngine({ query: (params) => ((seen = params.options), (async function* () { yield* frames; })()) });
    const env = { externalMcp: () => ({ meta_ads: { type: 'http', url: 'https://mcp.test' } }) } as unknown as ToolEnv;
    await collect(runAgent({ ...input, agent: { ...agent, role: 'ad_strategist' }, mode: 'research', env, budgetUsd: 0.8 }, engine));
    expect(seen).toMatchObject({ tools: ['WebSearch'], maxTurns: 30, maxBudgetUsd: 0.8 });
    expect(Object.keys(seen!.mcpServers!)).toEqual(['frontline']); // the research tools, and none of the store's servers
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'error_max_turns', errors: [] }), 'research')).toEqual([{ type: 'error', message: 'Stopped: this research step hit its 30-turn limit before finishing.', code: 'error_max_turns' }]);
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'error_max_budget_usd', errors: [] }), 'research')).toEqual([{ type: 'error', message: "Stopped: the research task's budget, or today's AI budget for this store, ran out.", code: 'error_max_budget_usd' }]);
  });

  // What Claude sees: every app tool's zod input must come out of the in-process MCP server as a valid object schema.
  test('serves every app tool over MCP (the research ones in research runs) with an object input schema', async () => {
    const listed = new Set<string>();
    const runs = [...(Object.keys(ROLES) as AgentRole[]).map((role) => ({ role, mode: undefined })), { role: 'market_analyst' as AgentRole, mode: 'research' as const }];
    for (const { role, mode } of runs) {
      let options: Options | undefined;
      const engine = claudeEngine({
        query: (params) => {
          options = params.options;
          return (async function* () {
            yield* frames;
          })();
        },
      });
      await collect(runAgent({ ...input, agent: { ...agent, role }, mode, env: {} as ToolEnv }, engine));
      const server = (options?.mcpServers?.frontline as McpSdkServerConfigWithInstance).instance;
      const client = new Client({ name: 'test', version: '1.0.0' });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      for (const t of (await client.listTools()).tools) {
        expect(t.inputSchema.type, t.name).toBe('object');
        listed.add(t.name);
      }
      await client.close();
    }
    expect([...listed].sort()).toEqual(APP_TOOLS.map((t) => t.name).sort());
  });
});
