// The Codex runtime (decision 9): the Codex CLI installed on this machine, spawned directly (`codex exec --json`), kept
// apart from the owner's own Codex setup, with the app's tools over a run-scoped MCP endpoint the API mounts (codexMcp).
import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CODEX_TESTED, codexRegistryModels, RUNTIME_REGISTRY, type AgentEvent, type RuntimeCapabilities, type RuntimeModel } from '@frontline/shared';
import type { Engine, RunInput } from './engine';
import { assemblePrompt } from './prompt';
import { ROLES } from './roles';
import { allows, callTool, channel, runTools, type AppTool, type ToolContext } from './tools';

/**
 * Codex features that act outside the app's control, off on every spawn and checked present and off on CLI versions
 * AA-15 didn't test. AA-15 checked 0.163.0's source: what is left (code mode's V8 isolate has no imports, files or
 * network; apply_patch is refused under read-only with approval never) reaches nothing but the app's tools and web search.
 */
export const CODEX_FEATURES_OFF = [
  'shell_tool', 'hooks', 'multi_agent', 'multi_agent_v2', 'apps', 'plugins', 'image_generation', 'browser_use', 'computer_use', 'in_app_browser', 'goals', 'view_image',
  'skill_mcp_dependency_install',
];
const ISOLATION = [
  ...CODEX_FEATURES_OFF.flatMap((f) => ['-c', `features.${f}=false`]),
  // Skills from ~/.agents/skills load whatever CODEX_HOME is; they, the bundled ones and any AGENTS.md stay out.
  ...['skills.include_instructions=false', 'skills.bundled.enabled=false', 'project_doc_max_bytes=0'].flatMap((c) => ['-c', c]),
];
const TOKEN_VAR = 'FRONTLINE_MCP_TOKEN';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Child = Pick<ChildProcessWithoutNullStreams, 'pid' | 'exitCode' | 'signalCode' | 'kill'>;

const installed = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
/** Where the Codex installer puts the CLI, else `codex` on PATH. */
export const codexBin = () => (installed && existsSync(installed) ? installed : 'codex');

/**
 * Every codex process starts here: no shell, the app's own CODEX_HOME and only the variables it needs, so
 * FRONTLINE_SECRET_KEY and integration tokens never reach it. `token`: the run's MCP bearer, which Codex reads by name.
 */
export function spawnCodex(args: string[], o: { home: string; cwd?: string; token?: string; spawn?: Spawn }): ChildProcessWithoutNullStreams {
  if (resolve(o.home) === resolve(homedir(), '.codex')) throw new Error("The app never runs Codex on the owner's own ~/.codex.");
  const env: Record<string, string> = { CODEX_HOME: o.home };
  for (const k of ['PATH', 'SYSTEMROOT', 'USERPROFILE']) if (process.env[k]) env[k] = process.env[k]!;
  if (o.token) env[TOKEN_VAR] = o.token;
  return (o.spawn ?? spawn)(codexBin(), args, { shell: false, windowsHide: true, env, ...(o.cwd ? { cwd: o.cwd } : {}) });
}

/** Stops the process the app spawned and all it started, by PID: never by image name (the owner's Codex app runs codex.exe too). */
// ponytail: outside Windows only the child itself is killed; a process group if the app ever ships there.
export function killTree(child: Child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}

/** Runs a short codex command (no model turn) and collects what it printed. */
function run(args: string[], o: { home: string; spawn?: Spawn; timeoutMs?: number }): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnCodex(args, o);
    } catch {
      return done({ code: null, out: '' });
    }
    let out = '';
    const timer = setTimeout(() => killTree(child), o.timeoutMs ?? 30_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => (clearTimeout(timer), done({ code: null, out })));
    child.on('close', (code) => (clearTimeout(timer), done({ code, out })));
    child.stdin.end();
  });
}

/** True when `codex features list` (under the run flags) lacks one of the features the app turns off, or shows it on. */
export function featuresChanged(listing: string) {
  const enabled = new Map(listing.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3).map((p) => [p[0], p.at(-1)]));
  return CODEX_FEATURES_OFF.some((f) => enabled.get(f) !== 'false');
}

/** The app-server's model/list rows as the app lists them: hidden ones out, the catalog's effort ids as given. */
export const codexModels = (rows: { id: string; displayName?: string; description?: string; hidden?: boolean; isDefault?: boolean; defaultReasoningEffort?: string; supportedReasoningEfforts?: { reasoningEffort: string }[] }[]): RuntimeModel[] =>
  rows
    .filter((m) => !m.hidden)
    .map((m) => ({
      id: m.id,
      label: m.displayName ?? m.id,
      ...(m.description ? { description: m.description } : {}),
      efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
      ...(m.defaultReasoningEffort ? { defaultEffort: m.defaultReasoningEffort } : {}),
      ...(m.isDefault ? { default: true } : {}),
    }));

/** The live catalog without a turn, over the app-server's stdio (AA-01: model/list marks the default and drops hidden models). */
// ponytail: the first page only (8 models in 0.163.0); follow nextCursor if catalogs ever page.
function listModels(home: string, spawner?: Spawn): Promise<RuntimeModel[] | undefined> {
  return new Promise((done) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnCodex(['app-server'], { home, ...(spawner ? { spawn: spawner } : {}) });
    } catch {
      return done(undefined);
    }
    const finish = (models?: RuntimeModel[]) => (clearTimeout(timer), killTree(child), done(models));
    const timer = setTimeout(() => finish(), 30_000);
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    child.on('error', () => finish());
    child.on('close', () => finish());
    child.stdin.on('error', () => {});
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', (line) => {
      let m: { id?: number; result?: { data?: Parameters<typeof codexModels>[0] } };
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.id === 1) send({ method: 'initialized' }), send({ id: 2, method: 'model/list', params: {} });
      if (m.id === 2) finish(m.result?.data?.length ? codexModels(m.result.data) : undefined);
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'frontline', version: '1' } } });
  });
}

/**
 * GET /api/runtimes' Codex row, checked without a model turn: installed (`codex --version`), signed in to the app's
 * CODEX_HOME (`codex login status`), the catalog (the registry when that fails, flagged) and, on a CLI version AA-15
 * didn't test, every feature the app turns off still present and off.
 */
export async function codexStatus(home: string, spawner?: Spawn): Promise<RuntimeCapabilities> {
  const checkedAt = new Date().toISOString();
  const o = { home, ...(spawner ? { spawn: spawner } : {}) };
  const registry = { models: codexRegistryModels(), source: 'registry' as const, registryVersion: RUNTIME_REGISTRY.version };
  const v = await run(['--version'], o);
  const version = /\d+\.\d+\.\d+\S*/.exec(v.out)?.[0];
  if (v.code !== 0 || !version) return { runtime: 'codex', connected: false, reason: 'Install the Codex CLI', ...registry, checkedAt };
  const [login, models, features] = await Promise.all([run(['login', 'status'], o), listModels(home, spawner), CODEX_TESTED.includes(version) ? undefined : run(['features', 'list', ...ISOLATION], o)]);
  const reason = features && (features.code !== 0 || featuresChanged(features.out)) ? `Not available: Codex ${version} changed a feature the app turns off` : login.code !== 0 ? 'Set up Codex' : undefined;
  return { runtime: 'codex', connected: !reason, ...(reason ? { reason } : {}), ...(models ? { models, source: 'discovered' as const } : registry), version, checkedAt };
}

/** "Set up Codex": `codex login` on the app's CODEX_HOME. The owner signs in in their browser; the app never sees the token. */
export function codexSetup(home: string, spawner?: Spawn, onDone?: () => void) {
  const child = spawnCodex(['login'], { home, ...(spawner ? { spawn: spawner } : {}) });
  child.stdin.on('error', () => {});
  child.stdout.resume();
  child.stderr.resume();
  child.on('error', () => onDone?.());
  child.on('close', () => onDone?.());
  child.stdin.end();
}

/**
 * A store's empty working folder, outside every git repo: Codex walks up from it to the first `.git` (its project-root
 * marker) and would load that repo's AGENTS.md. In development the data folder is inside this repo, so the root is the
 * user's local app data (FRONTLINE_CODEX_WORK overrides it; tests use a temp folder).
 */
export function codexWork(storeId: string, root = process.env.FRONTLINE_CODEX_WORK ?? join(process.env.LOCALAPPDATA ?? homedir(), 'FrontlineEcom', 'codex-work')) {
  const dir = resolve(root, storeId);
  mkdirSync(dir, { recursive: true });
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) throw new Error(`Codex can't run: its work folder ${dir} is inside the git repository at ${d}, whose AGENTS.md would load. Set FRONTLINE_CODEX_WORK to a folder outside it.`);
    if (dirname(d) === d) return dir;
  }
}

const SIGNED_OUT = "Codex isn't signed in for this app. Choose Codex in Deploy an agent and use Set up Codex, then run the agent again.";
const LIMIT = "You've hit your Codex usage limit for now. Agents can run again once it resets.";
const NOT_INSTALLED = "The Codex CLI isn't installed on this computer. Install it, then run the agent again.";
/** Codex account errors: every run fails the same way until the owner fixes it (told once a day, like Claude's). */
export const CODEX_ACCOUNT = [SIGNED_OUT, LIMIT, NOT_INSTALLED];

const clean = (message: string) => message.replace(/,? (cf-ray|request id): [^,)]+/g, '');

/** A Codex failure in the owner's words. "No conversation found…" sends a follow-up to the recap, as Claude's does (runs.ts). */
export function codexError(message: string, sessionId?: string): Extract<AgentEvent, { type: 'error' }> {
  const session = sessionId ? { sessionId } : {};
  if (/\b401\b|unauthorized|not logged in/i.test(message)) return { type: 'error', message: SIGNED_OUT, code: 'codex_signed_out', ...session };
  if (/usage limit|\b429\b/i.test(message)) return { type: 'error', message: LIMIT, code: 'codex_usage_limit', ...session };
  if (/no rollout found/i.test(message)) return { type: 'error', message: 'No conversation found: Codex no longer has this session.', code: 'session_not_found' };
  return { type: 'error', message: `Codex stopped: ${clean(message)}`, code: 'codex_error', ...session };
}

/**
 * Maps `codex exec --json` lines to the run's events (exec_events.rs, event_processor_with_jsonl_output.rs): the thread id
 * is the session, the answer arrives whole, usage is tokens (no dollars), `turn.failed` or a failed exit ends the run,
 * other errors and reroutes are activity lines. The app's own tool calls are reported by the MCP endpoint, which sees
 * each one even when code mode makes it.
 */
export function codexEvents(input: Pick<RunInput, 'onSession' | 'onRuntime'>) {
  let session: string | undefined;
  let ended = false;
  let said = false;
  let lastError: string | undefined;
  let lastNotice = '';
  const notice = (text: string): AgentEvent[] => {
    const key = clean(text).replace(/\d+/g, '#');
    if (key === lastNotice) return []; // "Reconnecting... 2/5", "3/5"…: one line
    lastNotice = key;
    return [{ type: 'notice', text: clean(text) }];
  };
  const item = (it: Record<string, unknown>): AgentEvent[] => {
    const id = String(it.id);
    switch (it.type) {
      case 'agent_message': {
        const text = `${said ? '\n\n' : ''}${String(it.text ?? '')}`;
        said = true;
        return [{ type: 'text_delta', text }];
      }
      case 'web_search':
        said = false;
        return [{ type: 'tool_call', id, name: 'WebSearch', input: { query: it.query } }, { type: 'tool_result', id, output: 'Searched the web.', isError: false }];
      case 'mcp_tool_call': {
        if (it.server === 'frontline' && it.status !== 'failed') return [];
        said = false;
        const result = it.result as { content?: { type: string; text?: string }[] } | undefined;
        const error = (it.error as { message?: string } | undefined)?.message;
        return [
          { type: 'tool_call', id, name: `mcp__${String(it.server)}__${String(it.tool)}`, input: it.arguments },
          { type: 'tool_result', id, output: error ?? (result?.content ?? []).map((c) => c.text ?? `[${c.type}]`).join('\n'), isError: it.status === 'failed' },
        ];
      }
      case 'command_execution':
        return notice(`Codex tried to run a command outside the app's tools (${String(it.status)}): ${String(it.command)}`);
      case 'file_change':
        return notice(`Codex tried to change files outside the app's tools (${String(it.status)}): ${((it.changes as { path: string }[]) ?? []).map((c) => c.path).join(', ')}`);
      case 'error': {
        const rerouted = /^model rerouted: (\S+) -> (\S+)/.exec(String(it.message));
        if (!rerouted) return notice(String(it.message));
        input.onRuntime?.({ actualModel: rerouted[2] });
        return [{ type: 'notice', text: `Ran on ${rerouted[2]}: Codex rerouted it from ${rerouted[1]}.` }];
      }
      default:
        return []; // reasoning, todo_list
    }
  };
  return {
    line(raw: string): AgentEvent[] {
      let e: { type?: string; thread_id?: string; message?: string; item?: Record<string, unknown>; error?: { message?: string }; usage?: Record<string, number> };
      try {
        e = JSON.parse(raw);
      } catch {
        return [];
      }
      switch (e.type) {
        case 'thread.started':
          session = e.thread_id;
          if (session) input.onSession?.(session);
          return [];
        case 'item.completed':
          return e.item ? item(e.item) : [];
        case 'error':
          lastError = String(e.message);
          return notice(lastError);
        case 'turn.completed':
          ended = true;
          return [{ type: 'done', sessionId: session ?? '', usage: { inputTokens: e.usage?.input_tokens ?? 0, outputTokens: e.usage?.output_tokens ?? 0, costUsd: 0 } }];
        case 'turn.failed':
          ended = true;
          return [codexError(e.error?.message ?? lastError ?? 'the turn failed', session)];
        default:
          return [];
      }
    },
    /** The process exited: a non-zero exit without `turn.failed` ends the run with stderr's error (a session not found, a bad flag). */
    exited(code: number | null, stderr: string): AgentEvent[] {
      if (ended || code === 0) return [];
      return [codexError(/^Error: (.+)$/m.exec(stderr)?.[1] ?? lastError ?? `codex exited with code ${code}`, session)];
    },
  };
}

/** Live Codex runs by MCP bearer token: in memory only, never in the DB, a config, a transcript or a log. */
const RUNS = new Map<string, { ctx: ToolContext; tools: AppTool[] }>();

/**
 * The run-scoped MCP endpoint Codex reaches the app's tools on (decision 9), on the API at 127.0.0.1. The bearer token
 * picks the run: it lists only that run's tools and calls them with the run's own context (store snapshot, approvals that
 * free its slot, Stop), and an ended run's token is refused. Each request gets its own server (stateless, JSON replies).
 */
export async function codexMcp(req: Request): Promise<Response> {
  const run = RUNS.get(/^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('authorization') ?? '')?.[1] ?? '');
  if (!run) return Response.json({ error: 'Unknown or ended run.' }, { status: 401 });
  const server = new McpServer({ name: 'frontline', version: '1.0.0' });
  for (const t of run.tools) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.input }, async (args) => {
      const id = randomUUID();
      run.ctx.emit({ type: 'tool_call', id, name: t.name, input: args });
      const { output, isError } = await callTool(t, args, run.ctx);
      run.ctx.emit({ type: 'tool_result', id, output, isError });
      return { content: [{ type: 'text', text: output }], isError };
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export interface CodexEngineOptions {
  /** The app's own CODEX_HOME: its sign-in and per-run instruction files, never the owner's ~/.codex. */
  home: string;
  /** The MCP endpoint's address (the API's port is known once it listens). */
  mcpUrl: () => string;
  /** Where the per-store work folders go (codexWork's default otherwise). */
  workRoot?: string;
  /** The installed CLI's version, recorded on each run. */
  version?: () => Promise<string | undefined>;
  /** Swapped in tests: no test spawns codex.exe. */
  spawn?: Spawn;
}

const toml = (s: string) => JSON.stringify(s); // a JSON string is a TOML basic string

/**
 * Runs a turn on the installed Codex CLI: the user turn on stdin, the role prompt in a per-run instructions file
 * (Windows caps a command line at 32,767 characters), read-only, approval never, every outside feature off, and the
 * app's tools over the MCP endpoint. Stop (and Stop after, through the run's abort) kills only the spawned tree.
 */
export function codexEngine(opts: CodexEngineOptions): Engine {
  return async function* (input) {
    const events = channel<AgentEvent>();
    const ctx = input.env && { ...input.env, store: input.store, agent: input.agent, emit: events.push, signal: input.signal };
    const token = randomBytes(32).toString('hex');
    if (ctx) RUNS.set(token, { ctx, tools: runTools(input.agent.role, input.mode, input.config) });
    const instructions = join(opts.home, 'instructions', `${randomUUID()}.md`);
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      const { model, effort } = input.config ?? {};
      const runtimeVersion = await opts.version?.();
      input.onRuntime?.({ runtime: 'codex', ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(runtimeVersion ? { runtimeVersion } : {}) });
      mkdirSync(dirname(instructions), { recursive: true });
      writeFileSync(instructions, input.systemPrompt ?? assemblePrompt(input));
      const web = ROLES[input.agent.role].tools.includes('WebSearch') && allows(input.config, 'WebSearch');
      const flags = [
        '--json',
        '--skip-git-repo-check',
        ...(model ? ['-m', model] : []),
        ...(effort ? ['-c', `model_reasoning_effort=${toml(effort)}`] : []),
        '-c', `model_instructions_file=${toml(instructions)}`,
        '-c', 'sandbox_mode="read-only"',
        '-c', 'approval_policy="never"',
        '-c', `web_search=${web ? '"live"' : '"disabled"'}`,
        ...ISOLATION,
        ...(ctx ? ['-c', `mcp_servers.frontline.url=${toml(opts.mcpUrl())}`, '-c', `mcp_servers.frontline.bearer_token_env_var="${TOKEN_VAR}"`, '-c', 'mcp_servers.frontline.tool_timeout_sec=86400'] : []),
        // The app's tools ask the owner themselves (approvals, ask_owner). Codex's own gate would ask too, and under
        // approval "never" it refuses every tool without readOnlyHint (mcp_tool_call.rs, 0.163.0), so it is off for them.
        ...(ctx ? ['-c', 'mcp_servers.frontline.default_tools_approval_mode="approve"'] : []),
      ];
      const c = (child = spawnCodex(['exec', ...(input.resume ? ['resume', ...flags, input.resume] : flags), '-'], { home: opts.home, cwd: codexWork(input.store.id, opts.workRoot), ...(ctx ? { token } : {}), ...(opts.spawn ? { spawn: opts.spawn } : {}) }));
      input.signal?.addEventListener('abort', () => killTree(c), { once: true });
      const map = codexEvents(input);
      let stderr = '';
      c.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
      createInterface({ input: c.stdout }).on('line', (line) => map.line(line).forEach(events.push));
      c.on('error', (e) => (events.push((e as NodeJS.ErrnoException).code === 'ENOENT' ? { type: 'error', message: NOT_INSTALLED, code: 'codex_not_installed' } : codexError(e.message)), events.end()));
      c.on('close', (code) => {
        if (!input.signal?.aborted) map.exited(code, stderr).forEach(events.push);
        events.end();
      });
      c.stdin.on('error', () => {}); // a child that exits before reading its turn
      c.stdin.end(input.task);
      yield* events.drain();
    } finally {
      RUNS.delete(token);
      if (child) killTree(child);
      rmSync(instructions, { force: true });
    }
  };
}
