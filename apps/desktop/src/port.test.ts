import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { stablePort } from './port';

test('the API port is kept across launches, and replaced only when another program holds it', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fe-port-')), 'api-port');
  const first = await stablePort(file);
  expect(readFileSync(file, 'utf8')).toBe(String(first));
  expect(await stablePort(file)).toBe(first);

  const busy = await new Promise<Server>((resolve) => { const s = createServer().listen(first, '127.0.0.1', () => resolve(s)); });
  try {
    const next = await stablePort(file);
    expect(next).not.toBe(first);
    expect(readFileSync(file, 'utf8')).toBe(String(next));
  } finally {
    busy.close();
  }
  writeFileSync(file, 'garbage');
  expect(await stablePort(file)).toBeGreaterThan(0);
});
