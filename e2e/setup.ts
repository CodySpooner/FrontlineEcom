import { execSync, fork } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function setup() {
  execSync('pnpm --filter @frontline/web build', { windowsHide: true });
  const data = mkdtempSync(join(tmpdir(), 'frontline-e2e-'));
  const require = createRequire(resolve('apps/server/package.json'));
  const child = fork(resolve('e2e/server.ts'), [], {
    execArgv: ['--import', pathToFileURL(require.resolve('tsx')).href], silent: true, windowsHide: true,
    env: { ...process.env, FRONTLINE_DATA_DIR: data, FRONTLINE_AGENT_ENGINE: 'fake', FRONTLINE_CODEX_WORK: join(data, 'codex-work'), FRONTLINE_WEB_DIR: resolve('apps/web/dist'), API_PORT: '0' },
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  try {
    process.env.FRONTLINE_E2E_URL = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('E2E server did not start')), 30_000);
      child.once('message', (message) => { clearTimeout(timer); resolve(String(message)); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`E2E server exited: ${code}`)); });
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  return async () => {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.send('stop'); });
  };
}
