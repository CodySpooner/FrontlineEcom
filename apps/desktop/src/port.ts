import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';

/** A free localhost port: `preferred` when it's free, else any. */
// ponytail: the port is free when checked, not reserved; another process could grab it before the API binds.
export function freePort(preferred = 0): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = createServer()
      .once('error', (e) => (preferred ? freePort().then(resolve, reject) : reject(e)))
      .listen(preferred, '127.0.0.1', () => {
        const { port } = s.address() as AddressInfo;
        s.close(() => resolve(port));
      });
  });
}

/**
 * The API port, kept in `file` across launches: the window's origin (http://127.0.0.1:<port>) then stays the same, and
 * so does Chromium's per-origin storage (onboarding done, store filter, notification permission). A new one only when
 * the saved port is taken.
 */
export async function stablePort(file: string) {
  let saved = 0;
  try {
    saved = Number(readFileSync(file, 'utf8'));
  } catch {} // first launch
  const port = await freePort(Number.isInteger(saved) && saved > 1023 && saved < 65536 ? saved : 0);
  if (port !== saved) writeFileSync(file, String(port));
  return port;
}
