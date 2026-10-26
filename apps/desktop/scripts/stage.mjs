// Lays out what the installer ships next to the app (process.resourcesPath): server/ (the API bundled into one file, plus
// the Agent SDK's native CLI), web/ (the UI build), playbooks/ + packs/ (agent prompt layers). Run after the web build.
import { cpSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const repo = join(import.meta.dirname, '../../..');
const out = join(import.meta.dirname, '../dist/resources');
rmSync(out, { recursive: true, force: true });

await build({
  entryPoints: [join(repo, 'apps/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: join(out, 'server/server.mjs'),
  // Bundled CommonJS deps (ws, …) call require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});

// The SDK finds its CLI with require.resolve from its own module, which is now server.mjs: put it in server/node_modules.
const cli = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
const sdk = realpathSync(join(repo, 'packages/agents/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'));
cpSync(dirname(createRequire(sdk).resolve(`${cli}/package.json`)), join(out, 'server/node_modules', cli), { recursive: true });

// Agent prompts read playbooks/ and packs/ from one level above their module (server/ → resources/).
for (const d of ['playbooks', 'packs']) cpSync(join(repo, 'packages/agents', d), join(out, d), { recursive: true });

const web = join(repo, 'apps/web/dist');
if (!existsSync(join(web, 'index.html'))) throw new Error('Build the web app first: pnpm --filter @frontline/web build');
cpSync(web, join(out, 'web'), { recursive: true });
