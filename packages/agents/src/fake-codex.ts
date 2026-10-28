// Test support for the Codex runtime: no test spawns codex.exe (decision 9).
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export interface FakeCodexChild extends EventEmitter {
  args: string[];
  options: SpawnOptionsWithoutStdio;
  env: Record<string, string>;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: undefined;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  /** What was written to stdin once it closes (exec's user turn). */
  turn: Promise<string>;
  /** Writes one JSONL line to stdout. */
  write: (line: object | string) => void;
  exit: (code?: number, stderr?: string) => void;
  kill: () => boolean;
}

/**
 * A stand-in for spawning codex: records how each process was started and runs `script` on it, which reads its stdin and
 * writes JSONL like `codex exec --json` would. Killing it ends its streams the way a killed process does.
 */
export function fakeCodex(script: (child: FakeCodexChild) => unknown) {
  const spawned: FakeCodexChild[] = [];
  const spawn = (_command: string, args: string[], options: SpawnOptionsWithoutStdio) => {
    const child = Object.assign(new EventEmitter(), { args, options, env: options.env as Record<string, string>, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null }) as FakeCodexChild;
    // Read only when a script asks, so one that reads stdin itself (the app-server's requests) gets every line.
    let turn: Promise<string> | undefined;
    Object.defineProperty(child, 'turn', { get: () => (turn ??= new Promise((resolve) => {
      let input = '';
      child.stdin.on('data', (d) => (input += d));
      child.stdin.on('end', () => resolve(input));
    })) });
    const close = (code: number | null) => {
      child.stdout.end();
      child.stderr.end();
      setTimeout(() => child.emit('close', code), 5);
    };
    child.write = (line) => void child.stdout.write(`${typeof line === 'string' ? line : JSON.stringify(line)}\n`);
    child.exit = (code = 0, stderr) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (stderr) child.stderr.write(stderr);
      child.exitCode = code;
      close(code);
    };
    child.kill = () => {
      if (child.exitCode === null && child.signalCode === null) (child.signalCode = 'SIGKILL'), close(null);
      return true;
    };
    spawned.push(child);
    setImmediate(() => void script(child));
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  return { spawn, spawned };
}

/**
 * One exec turn at codex-cli 0.163.0. The first four lines are 'recorded' from AA-25b's live turn (2026-10-28), which was
 * stopped while its ask_owner question waited. The rest are 'from source', built from the event types (exec_events.rs,
 * sdk/typescript events.ts and items.ts) and event_processor_with_jsonl_output.rs.
 */
export const CODEX_TURN: { from: 'source' | 'recorded'; line: object }[] = [
  { from: 'recorded', line: { type: 'thread.started', thread_id: '01a18351-07d0-7142-b1b5-fa784025752f' } },
  { from: 'recorded', line: { type: 'turn.started' } },
  { from: 'recorded', line: { type: 'item.started', item: { id: 'item_0', type: 'mcp_tool_call', server: 'frontline', tool: 'store_summary', arguments: { range: 7 }, result: null, error: null, status: 'in_progress' } } },
  { from: 'recorded', line: { type: 'item.completed', item: { id: 'item_0', type: 'mcp_tool_call', server: 'frontline', tool: 'store_summary', arguments: { range: 7 }, result: { content: [{ type: 'text', text: '{"from":"2026-10-22","to":"2026-10-28","currency":"USD","totals":{"revenue":4431.08,"profit":995.06,"adSpend":1558.56,"roas":2.84,"orders":100,"aov":44.31},"previous":{"revenue":4169.57,"profit":905.99,"adSpend":1522.02,"roas":2.74,"orders":87,"aov":47.93},"deltasPct":{"revenue":6.27,"profit":9.83,"adSpend":2.4,"roas":3.65,"orders":14.94,"aov":-7.55},"health":{"status":"winning","marginPct":22.5,"bar":0.75}}' }], structured_content: null }, error: null, status: 'completed' } } },
  { from: 'source', line: { type: 'item.completed', item: { id: 'item_1', type: 'reasoning', text: '**Comparing the month**' } } },
  { from: 'source', line: { type: 'item.completed', item: { id: 'item_2', type: 'web_search', query: 'at-home skincare device trends' } } },
  { from: 'source', line: { type: 'item.completed', item: { id: 'item_3', type: 'error', message: 'model rerouted: gpt-6.1-sol -> gpt-6-luna (HighRiskCyberActivity)' } } },
  { from: 'source', line: { type: 'error', message: 'Reconnecting... 1/5 (stream disconnected before completion)' } },
  { from: 'source', line: { type: 'error', message: 'Reconnecting... 2/5 (stream disconnected before completion)' } },
  { from: 'source', line: { type: 'item.completed', item: { id: 'item_4', type: 'todo_list', items: [{ text: 'Read the summary', completed: true }] } } },
  { from: 'source', line: { type: 'item.completed', item: { id: 'item_5', type: 'agent_message', text: 'Revenue is up 12% on last month.' } } },
  { from: 'source', line: { type: 'item.completed', item: { id: 'item_6', type: 'agent_message', text: 'Lead with the LED mask.' } } },
  { from: 'source', line: { type: 'turn.completed', usage: { input_tokens: 24763, cached_input_tokens: 24448, cache_write_input_tokens: 0, output_tokens: 122, reasoning_output_tokens: 64 } } },
];
