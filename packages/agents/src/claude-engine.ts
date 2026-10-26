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
  error_max_budget_usd: "Stopped: the run used what was left of today's AI budget for this store. Raise it in Settings.",
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
    const messages = run({
      prompt: input.task,
      options: {
        model: opts.model ?? process.env.FRONTLINE_AGENT_MODEL ?? 'claude-opus-5-5',
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
          const { approved, message } = await requestApproval(ctx, {
            title: `Allow ${toolName.replace(/^mcp__/, '').replace('__', ': ')}`,
            reason: JSON.stringify(toolInput).slice(0, 400),
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
    (async () => {
      for await (const message of messages) for (const event of toAgentEvents(message)) events.push(event);
    })().then(() => events.end(), events.end);
    yield* events.drain();
  };
}

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
        block.type === 'tool_use' ? [{ type: 'tool_call', id: block.id, name: block.name, input: block.input }] : [],
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
      if (message.subtype !== 'success') return [{ type: 'error', message: STOPPED[message.subtype] ?? (message.errors.join('; ') || message.subtype) }];
      if (message.is_error) return [{ type: 'error', message: message.result || 'Claude returned an error' }];
      const u = message.usage;
      return [
        {
          type: 'done',
          sessionId: message.session_id,
          usage: {
            inputTokens: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
            outputTokens: u.output_tokens,
            costUsd: message.total_cost_usd,
          },
        },
      ];
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
