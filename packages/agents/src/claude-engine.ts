// Drives the Claude Agent SDK the way T3 Code's ClaudeAdapterV2 does (partial-message streaming, resume,
// canUseTool, per-run mcpServers), minus Effect. Ideas ported from pingdotgg/t3code:
// MIT License, Copyright (c) 2026 T3 Tools Inc.
import { createSdkMcpServer, query, tool, type Options, type SDKAssistantMessageError, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@frontline/shared';
import type { Engine, RunInput } from './engine';
import { assemblePrompt } from './prompt';
import { ROLES } from './roles';
import { callTool, channel, requestApproval, toolsFor } from './tools';

/** Why the SDK stopped a run early, in the owner's words (the run's error notification). */
const STOPPED: Partial<Record<string, string>> = {
  error_max_turns: 'Stopped: the run hit its 40-turn limit before finishing. Give it a narrower task.',
  error_max_budget_usd: "Stopped: the run used its share of today's AI budget for this store. Raise it in Settings.",
};

export interface ClaudeEngineOptions {
  /** Defaults to `FRONTLINE_AGENT_MODEL` or claude-opus-5-5. */
  model?: string;
  /** Per-run extras: `mcpServers`, `canUseTool`, `maxBudgetUsd`… */
  queryOptions?: (input: RunInput) => Partial<Options>;
  /** Swapped in tests so they never call Claude. */
  query?: (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;
}

/** Account problems the SDK flags on an assistant message, in the owner's words (Claude Code's own text says "run /login"). */
const ACCOUNT: Partial<Record<SDKAssistantMessageError, string>> = {
  authentication_failed: "Claude isn't signed in on this computer. Open a terminal, run `claude`, sign in with /login, then run the agent again.",
  billing_error: "Claude reported a billing problem with your account, so agents can't run. Check your plan at claude.ai.",
  rate_limit: "You've hit your Claude usage limit for now. Agents can run again once it resets.",
  model_not_found: "The agent model isn't available on your Claude login. Set FRONTLINE_AGENT_MODEL to one that is.",
};

/** True for an account problem (signed out, usage limit…): every run fails the same way until the owner fixes it. */
export const isAccountError = (message: string) => Object.values(ACCOUNT).includes(message);

/** Runs on the owner's local Claude Code login (no API key needed). */
export function claudeEngine(opts: ClaudeEngineOptions = {}): Engine {
  const run = opts.query ?? query;
  return async function* (input) {
    // Claude Code built-ins are capitalized (WebSearch); app tools come over the in-process MCP server.
    const builtins = ROLES[input.agent.role].tools.filter((t) => /^[A-Z]/.test(t));
    const events = channel<AgentEvent>();
    const ctx = input.env && { ...input.env, store: input.store, agent: input.agent, emit: events.push, signal: input.signal };
    const appTools = ctx ? toolsFor(input.agent.role) : [];
    const connected = ctx?.externalMcp?.(input.store.id) ?? {};
    const externalMcp = Object.fromEntries((ROLES[input.agent.role].mcp ?? []).flatMap((k) => (connected[k] ? [[k, connected[k]]] : [])));
    const frontline = createSdkMcpServer({
      name: 'frontline',
      version: '1.0.0',
      tools: appTools.map((t) =>
        tool(t.name, t.description, t.input, async (args) => {
          const { output, isError } = await callTool(t, args, ctx!);
          return { content: [{ type: 'text', text: output }], isError };
        }),
      ),
    });
    const abortController = new AbortController();
    input.signal?.addEventListener('abort', () => abortController.abort(), { once: true });
    const model = opts.model ?? process.env.FRONTLINE_AGENT_MODEL ?? 'claude-opus-5-5';
    const messages = run({
      prompt: input.task,
      options: {
        model,
        systemPrompt: input.systemPrompt ?? assemblePrompt(input),
        includePartialMessages: true,
        // Isolated from the owner's coding setup: no CLAUDE.md/settings, no file or shell tools, no skill listing, and
        // only our MCP servers (the login's claude.ai connectors otherwise attach to every run: ~8k tokens a turn).
        settingSources: [],
        tools: builtins,
        skills: [],
        strictMcpConfig: true,
        mcpServers: { ...(appTools.length ? { frontline } : {}), ...externalMcp },
        permissionMode: 'default',
        // Every call comes here (no allowedTools, so the SDK doesn't warn that they shadow this callback): the role's
        // built-ins and app tools run (app tools gate their own side effects through request_approval), external reads
        // run, and anything else (e.g. a write tool on a connected store's MCP) goes to the owner.
        canUseTool: async (toolName, toolInput) => {
          if ((builtins as string[]).includes(toolName) || toolName.startsWith('mcp__frontline__')) return { behavior: 'allow', updatedInput: toolInput };
          if (!ctx) return { behavior: 'deny', message: 'Tool not available in this run.' };
          if (isReadOnly(toolName)) return { behavior: 'allow', updatedInput: toolInput };
          if (movesSpend(toolName, toolInput)) {
            return { behavior: 'deny', message: "Not allowed: budget, bid and status changes on an ad account go through propose_ad_change (the Ad Strategist's), where the owner's caps apply." };
          }
          const { approved, message } = await requestApproval(ctx, {
            title: `Allow ${toolName.replace(/^mcp__/, '').replace('__', ': ')}`,
            reason: JSON.stringify(toolInput).slice(0, 2000),
            action: { kind: 'tool_use', payload: { tool: toolName, input: toolInput } },
          });
          return approved ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message };
        },
        abortController,
        // Runaway guard: a run stops at 40 turns, or at what is left of the store's daily AI budget.
        maxTurns: 40,
        ...(input.budgetUsd !== undefined ? { maxBudgetUsd: Math.max(0.01, input.budgetUsd) } : {}),
        ...(input.resume ? { resume: input.resume } : {}),
        ...opts.queryOptions?.(input),
      },
    });
    // A resumed session's results carry its running total (checked 2026-10-26): this query's cost is the difference.
    const own = (e: AgentEvent): AgentEvent =>
      (e.type === 'done' || e.type === 'error') && e.usage && input.sessionCostUsd ? { ...e, usage: { ...e.usage, costUsd: Math.max(0, e.usage.costUsd - input.sessionCostUsd) } } : e;
    const spent = new Map<string, number>(); // assistant message id → its estimated cost (the SDK repeats a message per block)
    (async () => {
      for await (const message of messages) {
        if (message.type === 'assistant' && message.message.usage) {
          spent.set(message.message.id, estimate(message.message.usage, model));
          input.onSpend?.([...spent.values()].reduce((a, b) => a + b, 0));
        }
        for (const event of toAgentEvents(message)) events.push(own(event));
      }
    })().then(() => events.end(), events.end);
    yield* events.drain();
  };
}

/** List prices by model family, USD per million tokens: [input, output, cache read] (claude-api skill, 2026-10-26). */
const PRICES: Record<string, [number, number, number]> = { fable: [10, 50, 0.25], opus: [4, 20, 0.2], sonnet: [2, 10, 0.2], haiku: [0.1, 0.5, 0.01] };

/**
 * An assistant message's cost at the run model's list prices, cache writes at 2x input (Claude Code caches for an hour).
 * It counts for a run that never gets an exact total (cancelled, crashed, a cut-off reflection), and the run saves
 * whichever is higher, so it must not read high: on Opus prices a Haiku run would be charged ~40x against the store's
 * budget. Checked 2026-10-26 on a real Opus run: $0.0757 estimated vs $0.0758 billed.
 */
// ponytail: the family's current prices (Haiku's cache read assumed 0.1x input); an older, pricier model in a family
// reads low until its result's exact total arrives. Unknown families use Opus.
export const estimate = (
  u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null },
  model = 'claude-opus-5-5',
) => {
  const [input, output, read] = Object.entries(PRICES).find(([family]) => model.includes(family))?.[1] ?? PRICES.opus!;
  return (u.input_tokens * input + (u.cache_creation_input_tokens ?? 0) * input * 2 + (u.cache_read_input_tokens ?? 0) * read + u.output_tokens * output) / 1e6;
};

/** Maps one SDK message to our events. Subagent traffic (parent_tool_use_id set) is not surfaced. */
export function toAgentEvents(message: SDKMessage): AgentEvent[] {
  switch (message.type) {
    case 'stream_event': {
      const { event } = message;
      return message.parent_tool_use_id === null && event.type === 'content_block_delta' && event.delta.type === 'text_delta'
        ? [{ type: 'text_delta', text: event.delta.text }]
        : [];
    }
    case 'assistant':
      if (message.parent_tool_use_id !== null) return [];
      if (message.error && ACCOUNT[message.error]) return [{ type: 'error', message: ACCOUNT[message.error]! }];
      return message.message.content.flatMap((block): AgentEvent[] =>
        // Our own tools read as in demo runs (store_summary); external ones keep their server (mcp__meta_ads__…).
        block.type === 'tool_use' ? [{ type: 'tool_call', id: block.id, name: block.name.replace(/^mcp__frontline__/, ''), input: block.input }] : [],
      );
    case 'user': {
      const { content } = message.message;
      if (message.parent_tool_use_id !== null || typeof content === 'string') return [];
      return content.flatMap((block): AgentEvent[] =>
        block.type === 'tool_result'
          ? [{ type: 'tool_result', id: block.tool_use_id, output: resultText(block.content), isError: block.is_error ?? false }]
          : [],
      );
    }
    case 'result': {
      const u = message.usage;
      // A run that stops early still spent money: errors carry it too, so the store's daily AI budget sees it.
      const usage = u && { inputTokens: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens, outputTokens: u.output_tokens, costUsd: message.total_cost_usd };
      const failed = (text: string): AgentEvent[] => [{ type: 'error', message: text, ...(usage ? { usage } : {}) }];
      if (message.subtype !== 'success') return failed(STOPPED[message.subtype] ?? (message.errors.join('; ') || message.subtype));
      if (message.is_error) return failed(message.result || 'Claude returned an error');
      return [{ type: 'done', sessionId: message.session_id, usage }];
    }
    default:
      return [];
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b: { type?: string; text?: string }) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');
}

// ponytail: external tools are judged by name (their read-only annotations don't reach canUseTool). Anything that
// doesn't read like a read goes to the owner, so a misnamed write still asks.
const READ_VERBS = /^(get|list|search|read|fetch|describe|lookup|find)(_|$)/;
export const isReadOnly = (toolName: string) => toolName.startsWith('mcp__') && READ_VERBS.test(toolName.split('__').at(-1) ?? '');

/** A write on an ad server (mcp__meta_ads__…) whose name or input keys touch budget, bid, spend or status. */
export const movesSpend = (toolName: string, input: unknown) =>
  /^mcp__\w+_ads__/.test(toolName) && (/budget|bid|spend|status|pause|resume|activate/i.test(toolName.split('__').at(-1)!) || /"[^"]*(budget|bid|spend|status)[^"]*"\s*:/i.test(JSON.stringify(input)));
