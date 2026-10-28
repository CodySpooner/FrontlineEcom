// Drives the Claude Agent SDK the way T3 Code's ClaudeAdapterV2 does (partial-message streaming, resume,
// canUseTool, per-run mcpServers), minus Effect. Ideas ported from pingdotgg/t3code:
// MIT License, Copyright (c) 2026 T3 Tools Inc.
import { createSdkMcpServer, query, tool, type Options, type SDKAssistantMessageError, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, ClaudeAccount } from '@frontline/shared';
import type { Engine, RunInput } from './engine';
import { assemblePrompt } from './prompt';
import { ROLES } from './roles';
import { callTool, channel, requestApproval, runTools } from './tools';

/** Why the SDK stopped a run early, in the owner's words (the run's error notification). */
const STOPPED: Partial<Record<string, string>> = {
  error_max_turns: 'Stopped: the run hit its 40-turn limit before finishing. Give it a narrower task.',
  error_max_budget_usd: "Stopped: the run used its share of today's AI budget for this store. Raise it in Settings.",
};
const RESEARCH_TURNS = 30;
const STOPPED_RESEARCH: Partial<Record<string, string>> = {
  error_max_turns: `Stopped: this research step hit its ${RESEARCH_TURNS}-turn limit before finishing.`,
  error_max_budget_usd: "Stopped: the research task's budget, or today's AI budget for this store, ran out.",
};

export interface ClaudeEngineOptions {
  /** Defaults to `FRONTLINE_AGENT_MODEL` or claude-opus-5-5. */
  model?: string;
  /** Per-run extras: `mcpServers`, `canUseTool`, `maxBudgetUsd`… */
  queryOptions?: (input: RunInput) => Partial<Options>;
  /** Swapped in tests so they never call Claude. */
  query?: (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;
}

/** Errors the SDK flags on an assistant message, in the owner's words with what to do (Claude Code's own text says "run /login"). */
const ERRORS: Record<SDKAssistantMessageError, string> = {
  authentication_failed: "Claude isn't signed in on this computer. Open a terminal, run `claude`, sign in with /login, then run the agent again.",
  oauth_org_not_allowed: "Your Claude login's organization doesn't allow Claude Code. Open a terminal, run `claude`, sign in with another account with /login, then run the agent again.",
  account_on_hold: "Your Claude account is on hold, so agents can't run. Check your account at claude.ai.",
  verification_required: 'Claude needs you to verify your account. Open a terminal, run `claude` and follow its steps, then run the agent again.',
  billing_error: "Claude reported a billing problem with your account, so agents can't run. Check your plan at claude.ai.",
  rate_limit: "You've hit your Claude usage limit for now. Agents can run again once it resets.",
  overloaded: 'Claude is overloaded right now. Retry in a few minutes.',
  invalid_request: 'Claude turned the request down as invalid. Retry; if it happens again, start a new conversation.',
  model_not_found: "The agent model isn't available on your Claude login. Set FRONTLINE_AGENT_MODEL to one that is.",
  server_error: 'Claude had a server error. Retry in a few minutes.',
  unknown: 'Claude stopped with an unknown error. Retry; if it keeps happening, check status.anthropic.com.',
  max_output_tokens: "The reply hit Claude's output limit. Retry and ask for a shorter answer, or split the task.",
  cloud_credential_error: "Claude Code's cloud provider credentials failed. Fix them in your Claude Code setup, then run the agent again.",
};
/** The ones that fail every run the same way until the owner fixes them: the run stops at once, the owner is told once a day. */
const ACCOUNT: SDKAssistantMessageError[] = ['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required', 'billing_error', 'rate_limit', 'model_not_found', 'cloud_credential_error'];

/** The model agents run on: `FRONTLINE_AGENT_MODEL` or claude-opus-5-5. */
export const agentModel = () => process.env.FRONTLINE_AGENT_MODEL ?? 'claude-opus-5-5';

/**
 * Who Claude Code is signed in as here, asked without a prompt, so it spends no usage. It starts the CLI (~6 s).
 * Signed out reads `tokenSource: 'none'`; an API key or a cloud provider (no email) counts as signed in.
 */
export async function claudeAccount(cwd?: string, run: typeof query = query, timeoutMs = 30_000): Promise<ClaudeAccount> {
  const checkedAt = new Date().toISOString();
  const q = run({ prompt: (async function* () { await new Promise(() => {}); })(), options: { ...(cwd && { cwd }) } }); // accountInfo needs streaming input
  let timer: NodeJS.Timeout | undefined;
  try {
    const late = new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error(`Claude Code didn't answer in ${timeoutMs / 1000} s.`)), timeoutMs)));
    const info = await Promise.race([q.accountInfo(), late]);
    const signedIn = info.tokenSource !== 'none' || (!!info.apiKeySource && info.apiKeySource !== 'none');
    return { signedIn, ...(info.email && { email: info.email }), ...(info.subscriptionType && { subscription: info.subscriptionType }), checkedAt };
  } catch (e) {
    return { signedIn: false, checkedAt, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
    q.close();
  }
}

/** True for an account problem (signed out, usage limit…): every run fails the same way until the owner fixes it. */
export const isAccountError = (message: string) => ACCOUNT.some((code) => ERRORS[code] === message);

/** Runs on the owner's local Claude Code login (no API key needed). */
export function claudeEngine(opts: ClaudeEngineOptions = {}): Engine {
  const run = opts.query ?? query;
  return async function* (input) {
    // Claude Code built-ins are capitalized (WebSearch); app tools come over the in-process MCP server. Research gets web
    // search and the research tools: no WebFetch (pages go through fetch_source's guarded reader) and none of the store's.
    const research = input.mode === 'research';
    const builtins = research ? ['WebSearch'] : ROLES[input.agent.role].tools.filter((t) => /^[A-Z]/.test(t));
    const events = channel<AgentEvent>();
    const ctx = input.env && { ...input.env, store: input.store, agent: input.agent, emit: events.push, signal: input.signal };
    const appTools = ctx ? runTools(input.agent.role, input.mode) : [];
    const connected = (!research && ctx?.externalMcp?.(input.store.id)) || {};
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
    const model = opts.model ?? agentModel();
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
          const shown = JSON.stringify(toolInput);
          // The owner approves what they can read: an input cut to fit would run in full.
          if (shown.length > 2000) return { behavior: 'deny', message: `Not sent: the input is ${shown.length} characters and the owner's request shows 2000. Split it into smaller calls.` };
          const { approved, message } = await requestApproval(ctx, {
            title: `Allow ${toolName.replace(/^mcp__/, '').replace('__', ': ')}`,
            reason: shown,
            action: { kind: 'tool_use', payload: { tool: toolName, input: toolInput } },
          });
          return approved ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message };
        },
        abortController,
        // Runaway guard: a run stops at 40 turns (a research step at 30), or at what it may spend.
        maxTurns: research ? RESEARCH_TURNS : 40,
        ...(input.budgetUsd !== undefined ? { maxBudgetUsd: Math.max(0.01, input.budgetUsd) } : {}),
        ...(input.resume ? { resume: input.resume } : {}),
        ...opts.queryOptions?.(input),
      },
    });
    // A resumed session's results carry its running total (checked 2026-10-26): this query's cost is the difference.
    const own = (e: AgentEvent): AgentEvent =>
      (e.type === 'done' || e.type === 'error') && e.usage && input.sessionCostUsd ? { ...e, usage: { ...e.usage, costUsd: Math.max(0, e.usage.costUsd - input.sessionCostUsd) } } : e;
    const spent = new Map<string, number>(); // assistant message id → its estimated cost (the SDK repeats a message per block)
    let flagged: SDKAssistantMessageError | undefined; // the last error flagged on a reply: a failed result says why with it
    (async () => {
      for await (const message of messages) {
        if (message.type === 'system' && message.subtype === 'init') input.onSession?.(message.session_id);
        if (message.type === 'assistant' && message.message.usage) {
          spent.set(message.message.id, estimate(message.message.usage, model));
          input.onSpend?.([...spent.values()].reduce((a, b) => a + b, 0));
        }
        if (message.type === 'assistant' && message.parent_tool_use_id === null && message.error) flagged = message.error;
        for (const event of toAgentEvents(message, input.mode, flagged)) events.push(own(event));
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

/**
 * Maps one SDK message to our events. Subagent traffic (parent_tool_use_id set) is not surfaced. `flagged`: the last
 * error flagged on a reply; an account one stops the run there, any other explains the failed result.
 */
export function toAgentEvents(message: SDKMessage, mode?: RunInput['mode'], flagged?: SDKAssistantMessageError): AgentEvent[] {
  switch (message.type) {
    case 'stream_event': {
      const { event } = message;
      return message.parent_tool_use_id === null && event.type === 'content_block_delta' && event.delta.type === 'text_delta'
        ? [{ type: 'text_delta', text: event.delta.text }]
        : [];
    }
    case 'assistant':
      if (message.parent_tool_use_id !== null) return [];
      if (message.error && ACCOUNT.includes(message.error)) return [{ type: 'error', message: ERRORS[message.error], code: message.error }];
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
      const failed = (text: string, code: string): AgentEvent[] => [{ type: 'error', message: text, code, ...(usage ? { usage } : {}), ...(message.session_id ? { sessionId: message.session_id } : {}) }];
      if (flagged && (message.is_error || message.subtype === 'error_during_execution')) return failed(ERRORS[flagged], flagged);
      if (message.subtype === 'error_during_execution') return failed(`Stopped: ${message.errors.join('; ') || 'Claude hit an error while working'}. Retry; if it happens again, start a new conversation.`, message.subtype);
      if (message.subtype !== 'success') return failed((mode === 'research' ? STOPPED_RESEARCH : STOPPED)[message.subtype] ?? (message.errors.join('; ') || message.subtype), message.subtype);
      if (message.is_error) return failed(message.result || 'Claude returned an error', 'unknown');
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

/**
 * A write on an ad server (mcp__meta_ads__…) whose name, or any identifier in its input (a key, or a value like
 * {"field": "daily_budget"}), touches budget, bid, spend or status. Identifiers split on _ and camelCase, so ad copy
 * ("Forbidden fruit") doesn't count.
 */
export const movesSpend = (toolName: string, input: unknown) =>
  /^mcp__\w+_ads__/.test(toolName) &&
  (/budget|bid|spend|status|pause|resume|activate/i.test(toolName.split('__').at(-1)!) ||
    [...JSON.stringify(input).matchAll(/"([A-Za-z][A-Za-z0-9_]*)"/g)].some((m) => m[1]!.split(/_|(?<=[a-z0-9])(?=[A-Z])/).some((w) => /^(budget|bids?|spend|status)$/i.test(w))));
