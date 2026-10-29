import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

/**
 * settings decision 6: `version` moves only when an owner-editable field changes. This sweep reads every SQL write to an
 * owner table and fails on one that neither moves the version nor is listed below.
 * ponytail: it reads string literals that start with the statement; SQL built some other way (a CTE, a `;`-joined batch)
 * isn't seen. Parse it properly if one turns up.
 */
const TEST = 'apps/server/src/config/sweep.test.ts';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TABLES = ['stores', 'automation_rules', 'store_caps', 'kb_controls', 'pr_store_profiles', 'integrations'];

/** Columns written without moving the version: status, cursors, timestamps, sync and test results. */
const BOOKKEEPING: Record<string, string[]> = {
  stores: ['demo', 'connected', 'updated_at'],
  automation_rules: ['last_fired_at', 'checked_at', 'updated_at'],
  // encrypted_credentials: token rotation (updateSecrets); the owner's own secret edits go through putIntegration.
  integrations: ['status', 'error', 'cursor', 'synced_at', 'updated_at', 'encrypted_credentials'],
};
/** `file table`: inserts of a new row (its version starts at the column default). */
const CREATE = [
  'apps/server/src/stores.ts stores',
  'apps/server/src/automations.ts automation_rules',
  'apps/server/src/kb/autonomy.ts kb_controls',
  'apps/server/src/store-analytics/fixture.ts integrations',
  'packages/agents/src/jobs.ts automation_rules',
];
/** `file table`: a row deleted outright (its change rows say what it held). */
const ROW_DELETE = ['apps/server/src/stores.ts stores', 'apps/server/src/automations.ts automation_rules', 'apps/server/src/integrations.ts integrations'];
/** `file table column` ('*': any): store fields whose version `storeChanged` (config/write.ts) moves, in the same transaction. */
const VIA_STORE_CHANGED = ['apps/server/src/stores.ts stores *', 'apps/server/src/connectors/common.ts stores currency', 'apps/server/src/connectors/common.ts stores timezone'];
/** The only writers of the config documents in `settings`. */
const CONFIG_WRITERS = ['apps/server/src/config/write.ts', 'apps/server/src/config/boot.ts'];

const WRITE = /\b(UPDATE|INSERT(?:\s+OR\s+(?:REPLACE|IGNORE))?\s+INTO|DELETE\s+FROM)\s+(\w+)\b/g;
const BUMPS = /\bversion\s*=\s*(?:\w+\.)?version\s*\+/;

/** The rest of the string literal that starts at `i`, or undefined when `i` isn't a literal's start. */
function statementAt(src: string, i: number) {
  let q = i - 1;
  while (q >= 0 && /\s/.test(src[q]!)) q--;
  const quote = src[q];
  if (quote !== "'" && quote !== '"' && quote !== '`') return undefined;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (quote === '`' && ((ch === '$' && src[j + 1] === '{') || (depth && ch === '{'))) {
      depth++;
      if (ch === '$') j++;
    } else if (depth) {
      if (ch === '}') depth--;
    } else if (ch === quote && src[j - 1] !== '\\') return { sql: src.slice(i, j), end: j };
  }
  return undefined;
}

const setColumns = (clause: string) => [...clause.split(/\b(?:WHERE|RETURNING)\b/)[0]!.matchAll(/(?:^|,)\s*(\w+)\s*=/g)].map((m) => m[1]!);

/** Every write in `src` (the file at `file`) that breaks the rule, as a failure message. */
export function sweep(file: string, src: string): string[] {
  const found: string[] = [];
  for (const m of src.matchAll(WRITE)) {
    const verb = m[1]!.split(/\s+/)[0]!;
    const table = m[2]!;
    const at = statementAt(src, m.index);
    if (!at) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const where = `${file}:${line}`;
    if (table === 'settings') {
      if (CONFIG_WRITERS.includes(file)) continue;
      const call = src.slice(m.index, src.indexOf('\n', at.end) + 1 || undefined);
      if (/['"`](?:app|workspace|personal)['"`]/.test(call)) found.push(`${where} writes the settings document ${call.match(/['"`](app|workspace|personal)['"`]/)![1]}: write it through writeConfig (config/write.ts).`);
      continue;
    }
    if (!TABLES.includes(table) || BUMPS.test(at.sql)) continue;
    if (verb === 'DELETE') {
      if (!ROW_DELETE.includes(`${file} ${table}`)) found.push(`${where} deletes ${table} rows: if that's a row delete the owner asked for, add '${file} ${table}' to ROW_DELETE in ${TEST}.`);
      continue;
    }
    let columns: string[];
    if (verb === 'UPDATE') columns = setColumns(at.sql.slice(at.sql.search(/\bSET\b/) + 3));
    else if (/\bOR\s+REPLACE\b/.test(m[1]!)) columns = (at.sql.match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map((c) => c.trim()); // replaces every column it lists
    else {
      if (!CREATE.includes(`${file} ${table}`)) found.push(`${where} inserts into ${table}: if that's a new row, add '${file} ${table}' to CREATE in ${TEST}.`);
      const upsert = at.sql.search(/\bDO\s+UPDATE\s+SET\b/);
      columns = upsert < 0 ? [] : setColumns(at.sql.slice(upsert).replace(/^DO\s+UPDATE\s+SET/, ''));
    }
    for (const column of columns.length || verb === 'INSERT' ? columns : ['*']) {
      if (BOOKKEEPING[table]?.includes(column) || (table === 'stores' && (VIA_STORE_CHANGED.includes(`${file} stores ${column}`) || VIA_STORE_CHANGED.includes(`${file} stores *`)))) continue;
      found.push(
        `${where} table ${table} column ${column} is written without moving version. If this column is bookkeeping (status, cursor, timestamps, sync or test results), add it to BOOKKEEPING in ${TEST}. Never bump version for bookkeeping. If the owner edits it, write through the owner helper so version moves. Either edit is a tiny unblocking change any lane may make.`,
      );
    }
  }
  return found;
}

test('every write to an owner table moves its version or is listed as bookkeeping, a create or a row delete', () => {
  const files = ['apps/server/src', 'packages/agents/src'].flatMap((dir) =>
    readdirSync(ROOT + dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => `${dir}/${f.replaceAll('\\', '/')}`)
      .filter((f) => f !== 'apps/server/src/config/write.ts'),
  );
  expect(files.length).toBeGreaterThan(50);
  expect(files.flatMap((f) => sweep(f, readFileSync(ROOT + f, 'utf8')))).toEqual([]);
});

test('the sweep catches an unversioned owner write, a new insert or delete, and a config document written directly', () => {
  const src = [
    "db.prepare('UPDATE automation_rules SET name = ?, checked_at = ? WHERE id = ?').run(n, t, id);",
    "db.prepare('UPDATE automation_rules SET name = ?, version = version + 1 WHERE id = ?').run(n, id);",
    'db.prepare(`UPDATE kb_controls SET ${cols} WHERE store_id = ?`).run(s);',
    "db.prepare('INSERT INTO store_caps (store_id) VALUES (?) ON CONFLICT (store_id) DO UPDATE SET daily_cap = excluded.daily_cap').run(s);",
    "db.prepare('DELETE FROM integrations WHERE id = ?').run(id);",
    "db.prepare(\"INSERT INTO settings (key, value_json) VALUES ('workspace', ?)\").run(v);",
    "db.prepare(\"INSERT INTO settings (key, value_json) VALUES ('fx', ?)\").run(v);",
    "// UPDATE stores SET name = 'x' in a comment",
  ].join('\n');
  const found = sweep('x.ts', src);
  expect(found.map((f) => f.split(' is written')[0]!.split(':').slice(0, 2).join(':'))).toEqual([
    'x.ts:1 table automation_rules column name',
    'x.ts:3 table kb_controls column *',
    'x.ts:4 inserts into store_caps',
    'x.ts:4 table store_caps column daily_cap',
    'x.ts:5 deletes integrations rows',
    'x.ts:6 writes the settings document workspace',
  ]);
  expect(found[0]).toContain(`add it to BOOKKEEPING in ${TEST}. Never bump version for bookkeeping.`);
});
