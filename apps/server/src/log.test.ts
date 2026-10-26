import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { initLog, log } from './log';

test('log writes JSON lines to <data dir>/logs/api.log and keeps one rotated copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-log-'));
  initLog(dir);
  log('warn', 'sync', { id: 'shopify:glow', status: 'error' });
  const file = join(dir, 'logs', 'api.log');
  expect(JSON.parse(readFileSync(file, 'utf8').trim())).toEqual({ at: expect.any(String), level: 'warn', msg: 'sync', id: 'shopify:glow', status: 'error' });

  writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 + 1));
  log('info', 'started');
  expect(existsSync(`${file}.1`)).toBe(true);
  expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
});
