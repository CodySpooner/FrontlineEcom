import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Agent, AgentEvent, Store } from '@frontline/shared';
import { describe, expect, test } from 'vitest';
import { claudeEngine, fakeEngine, runAgent, toAgentEvents, type RunInput } from './index';

const store: Store = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'America/Chicago', color: '#ff8f98', connected: false };
const agent: Agent = { id: 'glow:market_analyst', storeId: 'glow', role: 'market_analyst', status: 'idle', level: 1, xp: 0 };
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
    expect(text(events)).toBe('Market Analyst for Glow Haus: on it — "Summarize last week".');
    expect(events.at(-1)).toEqual({ type: 'done', sessionId: 'fake-glow:market_analyst', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });
    expect(await collect(runAgent(input, fakeEngine()))).toEqual(events);
  });

  test('resume keeps the session id', async () => {
    const events = await collect(runAgent({ ...input, resume: 'sess-1' }, fakeEngine()));
    expect(events.at(-1)).toMatchObject({ type: 'done', sessionId: 'sess-1' });
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
    expect(frames.flatMap(toAgentEvents)).toEqual([
      { type: 'text_delta', text: 'Revenue ' },
      { type: 'tool_call', id: 'tu1', name: 'mcp__frontline__analytics_summary', input: { range: 7 } },
      { type: 'tool_result', id: 'tu1', output: '{"revenue":1200}', isError: false },
      { type: 'text_delta', text: 'is up.' },
      { type: 'done', sessionId: 'abc', usage: { inputTokens: 115, outputTokens: 7, costUsd: 0.012 } },
    ]);
  });

  test('maps failed results to error events', () => {
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'error_max_turns', errors: [] }))).toEqual([{ type: 'error', message: 'error_max_turns' }]);
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'error_during_execution', errors: ['boom', 'bang'] }))).toEqual([{ type: 'error', message: 'boom; bang' }]);
    expect(toAgentEvents(sdk({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' }))).toEqual([{ type: 'error', message: 'Not logged in' }]);
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
      tools: [],
      maxTurns: 3,
    });
  });
});
