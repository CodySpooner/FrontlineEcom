import { randomBytes } from 'node:crypto';
import { claudeEngine, getAgent, isReadOnly, movesSpend, runAgent, type ClaudeEngineOptions, type RunInput } from '@frontline/agents';
import type { AgentEvent } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { getStore } from '../stores';
import { toolEnv } from './agents';

const key = randomBytes(32);
let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  createApp(db, key);
  saveIntegration(db, key, { kind: 'meta_ads', storeId: 'peak', values: { adAccountId: 'act_1', accessToken: 'tok-123' } });
});

const input = (agentId: string): RunInput => {
  const agent = getAgent(db, agentId)!;
  return { agent, store: getStore(db, agent.storeId)!, task: 't', env: toolEnv(db, () => key) };
};

test("a store's connected Meta Ads becomes the official MCP server with its token; demo stores get none", () => {
  const env = toolEnv(db, () => key);
  expect(env.externalMcp?.('peak')).toEqual({ meta_ads: { type: 'http', url: 'https://mcp.facebook.com/ads', headers: { Authorization: 'Bearer tok-123' } } });
  expect(env.externalMcp?.('glow')).toEqual({});
});

test('read-style external tools run freely; everything else asks', () => {
  expect(['mcp__meta_ads__get_insights', 'mcp__meta_ads__list_campaigns', 'mcp__meta_ads__search'].every(isReadOnly)).toBe(true);
  expect(['mcp__meta_ads__create_campaign', 'mcp__meta_ads__update_adset_budget', 'mcp__meta_ads__getaway', 'WebFetch'].some(isReadOnly)).toBe(false);
});

/** Fake SDK: records the options, asks permission for each tool, and reports the answers as text. */
function recording(tools: (string | [string, object])[]) {
  const seen: { mcpServers?: unknown } = {};
  const query: NonNullable<ClaudeEngineOptions['query']> = (params) =>
    (async function* () {
      seen.mcpServers = params.options.mcpServers;
      for (const tool of tools) {
        const [t, toolInput] = typeof tool === 'string' ? [tool, {}] : tool;
        const d = await params.options.canUseTool!(t, toolInput as never, { signal: new AbortController().signal } as never);
        yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${t}=${d?.behavior} ` } } } as never;
      }
      yield { type: 'result', subtype: 'success', is_error: false, result: '', session_id: 's', total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never;
    })();
  return { seen, query };
}

test("an ad write that moves spend is refused even when the budget is named as a value; one too long to show the owner is refused, not cut", async () => {
  expect(movesSpend('mcp__meta_ads__update_adset', { field: 'daily_budget', value: 5000 })).toBe(true);
  expect(movesSpend('mcp__meta_ads__update_adset', { changes: [{ path: 'bidAmount', to: 900 }] })).toBe(true);
  expect(movesSpend('mcp__meta_ads__update_ad', { headline: 'Forbidden fruit', body: 'Spend less on skincare', status_note: undefined })).toBe(false);
  const { query } = recording([['mcp__meta_ads__update_ad', { headline: 'New hook', body: 'x'.repeat(2100), link: 'https://elsewhere.example' }]]);
  const events: AgentEvent[] = [];
  for await (const e of runAgent(input('peak:ad_strategist'), claudeEngine({ query }))) events.push(e);
  expect(events.some((e) => e.type === 'approval_request')).toBe(false);
  expect(events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('')).toBe('mcp__meta_ads__update_ad=deny ');
});

test('ad roles get the server; reads are allowed, writes become approval requests', async () => {
  const { seen, query } = recording(['mcp__frontline__review_campaigns', 'mcp__frontline__WebFetch', 'mcp__meta_ads__get_insights', 'mcp__meta_ads__create_campaign']);
  const events: AgentEvent[] = [];
  for await (const e of runAgent(input('peak:ad_strategist'), claudeEngine({ query }))) {
    events.push(e);
    if (e.type === 'approval_request') decide(db, e.approval.id, 'deny');
  }
  expect(Object.keys(seen.mcpServers as object)).toEqual(['frontline', 'meta_ads']);
  const requests = events.flatMap((e) => (e.type === 'approval_request' ? [e.approval.title] : []));
  expect(requests).toEqual(['Allow meta_ads: create_campaign']);
  expect(events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('')).toBe(
    'mcp__frontline__review_campaigns=allow mcp__frontline__WebFetch=allow mcp__meta_ads__get_insights=allow mcp__meta_ads__create_campaign=deny ',
  );

  const copy = recording([]);
  for await (const _ of runAgent(input('peak:copywriter'), claudeEngine({ query: copy.query })));
  expect(Object.keys(copy.seen.mcpServers as object)).toEqual(['frontline']);
});
