// Drives the Claude Agent SDK the way T3 Code's ClaudeAdapterV2 does (partial-message streaming, resume,
// canUseTool, per-run mcpServers), minus Effect. Ideas ported from pingdotgg/t3code:
// MIT License, Copyright (c) 2026 T3 Tools Inc.
import { createSdkMcpServer, query, tool, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@frontline/shared';
import type { Engine, RunInput } from './engine';
import { assemblePrompt } from './prompt';
import { ROLES } from './roles';
import { callTool, channel, requestApproval, toolsFor } from './tools';

export interface ClaudeEngineOptions {
  /** Defaults to `FRONTLINE_AGENT_MODEL` or claude-opus-5-5. */
  model?: string;
  /** Per-run extras: `mcpServers`, `allowedTools`, `canUseTool`, `maxBudgetUsd`… */
  queryOptions?: (input: RunInput) => Partial<Options>;
  /** Swapped in tests so they never call Claude. */
  query?: (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;
}

/** Runs on the owner's local Claude Code login (no API key needed). */
export function claudeEngine(opts: ClaudeEngineOptions = {}): Engine {
  const run = opts.query ?? query;
  return async function* (input) {
    // Claude Code built-ins are capitalized (WebSearch); app tools come over the in-process MCP server.
    const builtins = ROLES[input.agent.role].tools.filter((t) => /^[A-Z]/.test(t));
    const events = channel<AgentEvent>();
    const ctx = input.env && { ...input.env, store: input.store, agent: input.agent, emit: events.push, signal: input.signal };
    const appTools = ctx ? toolsFor(input.agent.role) : [];
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
        // Isolated from the owner's coding setup: no CLAUDE.md/settings, no file or shell tools.
        settingSources: [],
        tools: builtins,
        allowedTools: [...builtins, ...appTools.map((t) => `mcp__frontline__${t.name}`)],
        ...(appTools.length ? { mcpServers: { frontline } } : {}),
        permissionMode: 'default',
        // Anything not pre-approved above (e.g. a write tool on a connected store's MCP) goes to the owner.
        canUseTool: async (toolName, toolInput) => {
          if (!ctx) return { behavior: 'deny', message: 'Tool not available in this run.' };
          const { approved, message } = await requestApproval(ctx, {
            title: `Allow ${toolName.replace(/^mcp__/, '').replace('__', ': ')}`,
            reason: JSON.stringify(toolInput).slice(0, 400),
            action: { kind: 'tool_use', payload: { tool: toolName, input: toolInput } },
          });
          return approved ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message };
        },
        abortController,
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
      if (message.subtype !== 'success') return [{ type: 'error', message: message.errors.join('; ') || message.subtype }];
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
