import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_TESTED, CODEX_ULTRA, type Agent, type AgentConfig, type AgentEvent, type Store } from '@frontline/shared';
import { describe, expect, test, vi } from 'vitest';
import { CODEX_FEATURES_OFF, CODEX_TURN, codexEngine, codexError, codexEvents, codexStatus, codexWork, fakeCodex, featuresChanged, isAccountError, runAgent, spawnCodex, type FakeCodexChild, type RunInput } from './index';

const store: Store = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'America/Chicago', color: '#ff8f98', connected: true };
const agent: Agent = { id: 'glow:copywriter', storeId: 'glow', role: 'copywriter', status: 'idle' };
const config = { runtime: 'codex', model: 'gpt-6.1-sol', effort: 'medium', tools: [], knowledge: ['store'], permissions: { stopAfterMin: 20, saveFindings: 'off' } } as unknown as AgentConfig;
const input: RunInput = { agent, store, task: 'Draft the spring hero line', systemPrompt: 'You are the Copywriter.', config };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const collect = async (events: AsyncIterable<AgentEvent>) => {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
};
const home = () => mkdtempSync(join(tmpdir(), 'codex-home-'));
/** A codex that answers the turn from source. */
const answering = () =>
  fakeCodex(async (child) => {
    await child.turn;
    for (const { line } of CODEX_TURN) child.write(line);
    child.exit(0);
  });

describe('codex exec --json events', () => {
  test.each([
    { result: null, error: { message: 'Tool call refused: approval required' } },
    { result: { content: [{ type: 'text', text: 'Unknown tool: read_theme_files' }] }, error: null },
  ])('a failed frontline call remains visible even when the endpoint never handled it: %j', (failure) => {
    const map = codexEvents({});
    const item = { id: 'failed-tool', type: 'mcp_tool_call', server: 'frontline', tool: 'read_theme_files', arguments: {}, status: 'failed', ...failure };
    expect(map.line(JSON.stringify({ type: 'item.completed', item }))).toEqual([
      { type: 'tool_call', id: 'failed-tool', name: 'mcp__frontline__read_theme_files', input: {} },
      { type: 'tool_result', id: 'failed-tool', output: failure.error?.message ?? failure.result!.content[0]!.text, isError: true },
    ]);
    expect(map.line(JSON.stringify({ type: 'item.completed', item: { ...item, status: 'completed', error: null } }))).toEqual([]);
  });

  test('a turn (recorded up to Stop, then from source): the thread is the session, app tool calls come from the endpoint, a reroute is said and recorded, the answer and tokens arrive', () => {
    const onSession = vi.fn();
    const onRuntime = vi.fn();
    const map = codexEvents({ onSession, onRuntime });
    expect(CODEX_TURN.map((l) => l.from).join(' ')).toBe(`${'recorded '.repeat(4)}${'source '.repeat(CODEX_TURN.length - 4)}`.trim());
    expect(CODEX_TURN.flatMap(({ line }) => map.line(JSON.stringify(line)))).toEqual([
      { type: 'tool_call', id: 'item_2', name: 'WebSearch', input: { query: 'at-home skincare device trends' } },
      { type: 'tool_result', id: 'item_2', output: 'Searched the web.', isError: false },
      { type: 'notice', text: 'Ran on gpt-6-luna: Codex rerouted it from gpt-6.1-sol.' },
      { type: 'notice', text: 'Reconnecting... 1/5 (stream disconnected before completion)' }, // its 2/5 is the same line
      { type: 'text_delta', text: 'Revenue is up 12% on last month.' },
      { type: 'text_delta', text: '\n\nLead with the LED mask.' },
      { type: 'done', sessionId: '01a18351-07d0-7142-b1b5-fa784025752f', usage: { inputTokens: 24763, outputTokens: 122, costUsd: 0 } },
    ]);
    expect(onSession).toHaveBeenCalledWith('01a18351-07d0-7142-b1b5-fa784025752f');
    expect(onRuntime).toHaveBeenCalledWith({ actualModel: 'gpt-6-luna' });
    expect(map.exited(0, '')).toEqual([]);
  });

  test('recorded: a signed-out turn (codex-cli 0.163.0) fails with "Set up Codex", an account error, after one line per retry series', () => {
    const map = codexEvents({});
    const events = fixture('codex-0.163.0-signed-out.jsonl').trim().split('\n').flatMap((l) => map.line(l));
    const end = events.at(-1)!;
    expect(end).toMatchObject({ type: 'error', code: 'codex_signed_out', sessionId: '01a18258-00ea-7240-b833-d56f8c7156e9' });
    expect(isAccountError((end as { message: string }).message)).toBe(true);
    expect((end as { message: string }).message).toContain('Set up Codex');
    const notices = events.filter((e) => e.type === 'notice').map((e) => (e as { text: string }).text);
    expect(notices).toHaveLength(4); // the WebSocket retries, the fallback to HTTPS, the HTTPS retries, the last error
    expect(notices.join('\n')).not.toMatch(/cf-ray|request id/);
    expect(map.exited(1, 'HTTP error: 401 Unauthorized')).toEqual([]); // turn.failed already ended it
  });

  test('a failed exit without turn.failed ends the run with its stderr: a session gone sends a follow-up to the recap', () => {
    expect(codexEvents({}).exited(1, 'Error: thread/resume: thread/resume failed: no rollout found for thread id 0000 (code -32600)\n')).toEqual([
      { type: 'error', message: 'No conversation found: Codex no longer has this session.', code: 'session_not_found' },
    ]);
    expect(codexEvents({}).exited(3, '')).toEqual([{ type: 'error', message: 'Codex stopped: codex exited with code 3', code: 'codex_error' }]);
    expect(codexError("You've hit your usage limit. Try again at 5 PM.")).toMatchObject({ code: 'codex_usage_limit' });
    expect(isAccountError(codexError('usage limit').message)).toBe(true);
  });
});

describe('isolation', () => {
  test('recorded: 0.163.0 lists every feature the app turns off, as off; a list missing one, or showing one on, is a changed CLI', () => {
    const listing = fixture('codex-0.163.0-features.txt');
    expect(featuresChanged(listing)).toBe(false);
    expect(featuresChanged(listing.replace(/^goals .*$/m, ''))).toBe(true);
    expect(featuresChanged(listing.replace(/^(hooks\s+stable\s+)false/m, '$1true'))).toBe(true);
    expect(CODEX_FEATURES_OFF.length).toBe(13);
  });

  test("never the owner's ~/.codex; a work folder inside a git repo is refused", () => {
    expect(() => spawnCodex(['--version'], { home: join(homedir(), '.codex'), spawn: fakeCodex(() => {}).spawn })).toThrow(/never runs Codex/);
    const repo = mkdtempSync(join(tmpdir(), 'codex-repo-'));
    mkdirSync(join(repo, '.git'));
    expect(() => codexWork('glow', join(repo, 'work'))).toThrow(/inside the git repository/);
    expect(codexWork('glow')).toBe(join(process.env.FRONTLINE_CODEX_WORK!, 'glow'));
  });

  test('a 40,000-character turn goes on stdin, argv stays short and holds flags and ids only, under a scrubbed env, every outside feature off', async () => {
    const task = 'x'.repeat(40_000);
    const saved = process.env.FRONTLINE_SECRET_KEY;
    process.env.FRONTLINE_SECRET_KEY = 'not-for-codex';
    const fake = fakeCodex(async (child) => {
      const turn = await child.turn;
      child.write({ type: 'thread.started', thread_id: 't1' });
      child.write({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: `got ${turn.length}` } });
      child.write({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
      child.exit(0);
    });
    const h = home();
    let instructions = '';
    const events = await collect(runAgent({ ...input, task, onRuntime: () => {} }, codexEngine({ home: h, mcpUrl: () => 'http://127.0.0.1:1/api/codex/mcp', spawn: fake.spawn, version: async () => '0.163.0' })));
    if (saved === undefined) delete process.env.FRONTLINE_SECRET_KEY;
    else process.env.FRONTLINE_SECRET_KEY = saved;
    const child = fake.spawned[0]!;
    expect(events.find((e) => e.type === 'text_delta')).toEqual({ type: 'text_delta', text: 'got 40000' });
    expect(child.args.join(' ').length).toBeLessThan(4000);
    expect(child.args.join(' ')).not.toContain('xxxxx');
    expect(child.args.slice(0, 1)).toEqual(['exec']);
    expect(child.args.at(-1)).toBe('-');
    for (const f of CODEX_FEATURES_OFF) expect(child.args).toContain(`features.${f}=false`);
    expect(child.args).toEqual(expect.arrayContaining(['--json', '--skip-git-repo-check', '-m', 'gpt-6.1-sol', 'model_reasoning_effort="medium"', 'sandbox_mode="read-only"', 'approval_policy="never"', 'web_search="disabled"', 'skills.include_instructions=false', 'project_doc_max_bytes=0']));
    expect(child.args.some((a) => a.startsWith('mcp_servers.'))).toBe(false); // no app tools without the app's data
    expect(Object.keys(child.env).sort()).toEqual(['CODEX_HOME', 'PATH', 'SYSTEMROOT', 'USERPROFILE'].filter((k) => k === 'CODEX_HOME' || process.env[k]));
    expect(child.env.CODEX_HOME).toBe(h);
    expect(child.options).toMatchObject({ shell: false, cwd: join(process.env.FRONTLINE_CODEX_WORK!, 'glow') });
    instructions = JSON.parse(child.args.find((a) => a.startsWith('model_instructions_file='))!.slice('model_instructions_file='.length));
    expect(instructions.startsWith(join(h, 'instructions'))).toBe(true);
    expect(existsSync(instructions)).toBe(false); // the per-run file goes with the run
  });

  test('the role prompt is in the per-run file while it runs; a follow-up resumes its thread; the CLI version is recorded', async () => {
    let prompt = '';
    const fake = fakeCodex(async (child: FakeCodexChild) => {
      await child.turn;
      prompt = readFileSync(JSON.parse(child.args.find((a) => a.startsWith('model_instructions_file='))!.slice('model_instructions_file='.length)), 'utf8');
      child.write({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
      child.exit(0);
    });
    const onRuntime = vi.fn();
    await collect(runAgent({ ...input, resume: 'thread-9', onRuntime }, codexEngine({ home: home(), mcpUrl: () => '', spawn: fake.spawn, version: async () => '0.163.0' })));
    expect(prompt).toBe('You are the Copywriter.');
    expect(fake.spawned[0]!.args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(fake.spawned[0]!.args.slice(-2)).toEqual(['thread-9', '-']);
    expect(onRuntime).toHaveBeenCalledWith({ runtime: 'codex', model: 'gpt-6.1-sol', effort: 'medium', runtimeVersion: '0.163.0' });
  });

  test('Stop kills the spawned process and the run reads Cancelled', async () => {
    const fake = fakeCodex(async (child) => {
      await child.turn;
      child.write({ type: 'thread.started', thread_id: 't1' });
    });
    const abort = new AbortController();
    const run = collect(runAgent({ ...input, signal: abort.signal }, codexEngine({ home: home(), mcpUrl: () => '', spawn: fake.spawn })));
    await vi.waitFor(() => expect(fake.spawned[0]?.listenerCount('close')).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    abort.abort();
    expect((await run).at(-1)).toEqual({ type: 'error', message: 'Cancelled' });
    expect(fake.spawned[0]!.signalCode).toBe('SIGKILL');
  });

  test('Stop kills only the spawned tree: a recorded child and grandchild PID are both gone (never matched by image name)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-tree-'));
    const script = join(dir, 'tree.mjs');
    // The fake codex: starts a grandchild, writes both PIDs into its CODEX_HOME, and waits.
    writeFileSync(
      script,
      `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(process.env.CODEX_HOME + '/pids.json', JSON.stringify([process.pid, grandchild.pid]));
setInterval(() => {}, 1000);
`,
    );
    const h = home();
    const abort = new AbortController();
    const engine = codexEngine({ home: h, mcpUrl: () => '', spawn: (_cmd, _args, o) => spawn(process.execPath, [script], o) });
    const run = collect(runAgent({ ...input, signal: abort.signal }, engine));
    await vi.waitFor(() => expect(existsSync(join(h, 'pids.json'))).toBe(true), { timeout: 10_000 });
    const pids = JSON.parse(readFileSync(join(h, 'pids.json'), 'utf8')) as number[];
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(pids.every(alive)).toBe(true);
    abort.abort();
    await run;
    await vi.waitFor(() => expect(pids.filter(alive)).toEqual([]), { timeout: 10_000 });
  }, 20_000);
});

describe('status and discovery, without a model turn', () => {
  /** A codex CLI at `version`: login status exits `login`; features list prints `features`; app-server answers model/list. */
  const cli = (version: string | undefined, login: number, features = fixture('codex-0.163.0-features.txt')) =>
    fakeCodex(async (child) => {
      const [cmd] = child.args;
      if (cmd === '--version') return version ? (child.write(`codex-cli ${version}`), child.exit(0)) : child.emit('error', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));
      if (cmd === 'login') return child.exit(login);
      if (cmd === 'features') return child.write(features), child.exit(0);
      if (cmd === 'app-server') {
        child.stdin.on('data', (d: Buffer) => {
          for (const m of String(d).trim().split('\n').map((l) => JSON.parse(l) as { id?: number; method: string })) {
            if (m.method === 'initialize') child.write({ id: m.id, result: {} });
            if (m.method === 'model/list') {
              child.write({
                id: m.id,
                result: {
                  data: [
                    { id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', description: 'Latest workhorse model.', hidden: false, isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: ['low', 'max', 'ultra'].map((reasoningEffort) => ({ reasoningEffort, description: '…' })) },
                    { id: 'gpt-hidden', displayName: 'Hidden', hidden: true, isDefault: false, supportedReasoningEfforts: [] },
                  ],
                },
              });
            }
          }
        });
      }
    });

  test('signed in on a tested CLI: connected, the live catalog without hidden models, and no features check', async () => {
    const fake = cli(CODEX_TESTED[0], 0);
    expect(await codexStatus(home(), fake.spawn)).toEqual({
      runtime: 'codex',
      connected: true,
      models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', description: 'Latest workhorse model.', efforts: ['low', 'max', 'ultra'], defaultEffort: 'low', default: true }],
      source: 'discovered',
      version: '0.163.0',
      checkedAt: expect.any(String),
    });
    expect(fake.spawned.map((c) => c.args[0])).toEqual(['--version', 'login', 'app-server']);
  });

  test('"Install the Codex CLI", "Set up Codex", and an untested CLI that changed a feature is not available', async () => {
    expect(await codexStatus(home(), cli(undefined, 0).spawn)).toMatchObject({ connected: false, reason: 'Install the Codex CLI', source: 'registry' });
    expect(await codexStatus(home(), cli('0.163.0', 1).spawn)).toMatchObject({ connected: false, reason: 'Set up Codex', source: 'discovered' });
    const untested = cli('0.170.0', 0, fixture('codex-0.163.0-features.txt').replace(/^multi_agent .*$/m, ''));
    expect(await codexStatus(home(), untested.spawn)).toMatchObject({ connected: false, reason: 'Not available: Codex 0.170.0 changed a feature the app turns off', version: '0.170.0' });
    const features = untested.spawned.find((c) => c.args[0] === 'features')!;
    for (const f of CODEX_FEATURES_OFF) expect(features.args).toContain(`features.${f}=false`); // listed under the run flags
    expect(await codexStatus(home(), cli('0.170.0', 0).spawn)).toMatchObject({ connected: true });
  });

  test('ultra is refused with its reason', () => {
    expect(CODEX_ULTRA).toBe("Ultra runs Codex's own sub-agents, which the app turns off so its run limits hold.");
  });
});
