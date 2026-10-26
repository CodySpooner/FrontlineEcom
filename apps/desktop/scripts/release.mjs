// Ships a new version to installed apps: bumps the version (patch, or the one given), pushes that to main, builds the
// installer and publishes it with latest.yml as a GitHub release. Installed apps find it within the hour, download it
// in the background and offer it bottom-left. Run in the main checkout: pnpm release [x.y.z]
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..');
const file = join(dir, 'package.json');
const pkg = JSON.parse(readFileSync(file, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const version = process.argv[2] ?? `${major}.${minor}.${patch + 1}`;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a version: ${version}`);
const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'inherit' });
// The installer is built from the working tree: anything uncommitted would ship without being on main.
if (execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }).trim()) throw new Error('Commit or stash your changes before releasing');

pkg.version = version;
writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
run(`git commit -m "desktop: release v${version}" package.json`);
run('git pull --rebase origin main');
run('git push origin HEAD:main');
run('pnpm install');
run('pnpm package');
const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const files = [`FrontlineEcom-Setup-${version}.exe`, `FrontlineEcom-Setup-${version}.exe.blockmap`, 'latest.yml'].map((f) => `"release/${f}"`);
run(`gh release create v${version} ${files.join(' ')} --target ${sha} --title "Frontline Ecom ${version}" --generate-notes`);
