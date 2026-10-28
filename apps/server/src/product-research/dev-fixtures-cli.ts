// `pnpm --filter @frontline/server pr:fixtures [count]`: the dev-only fixture loader (decision 14). It writes only into
// this worktree's apps/server/.data, and refuses in the packaged app or when FRONTLINE_DATA_DIR points anywhere else.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, dbFile, openDb } from '../db';
import { loadFixtures } from './dev-fixtures';

/** Why the loader must not run here, or null. */
export function refusal(env: NodeJS.ProcessEnv, dir: string, own: string): string | null {
  if (env.FRONTLINE_WEB_DIR) return 'This is the packaged app: test fixtures only go into a dev worktree.';
  if (resolve(dir) !== resolve(own)) return `FRONTLINE_DATA_DIR points at ${resolve(dir)}, not this worktree's ${resolve(own)}: refusing to write test fixtures there.`;
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const why = refusal(process.env, dataDir(), fileURLToPath(new URL('../../.data', import.meta.url)));
  if (why) {
    console.error(why);
    process.exit(1);
  }
  const scale = Number(process.argv[2] ?? 0) || 0;
  const n = loadFixtures(openDb(dbFile()), { scale, log: console.log });
  console.log(`Wrote ${n} test fixture products (origin "fixture") to ${resolve(dbFile())}.`);
}
