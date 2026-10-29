// Boot fills for the Settings documents (ST-05, decision 7). Each runs once per data dir and only adds keys that are
// absent, so nothing the owner set is overwritten and no schedule moves at upgrade. `store_caps` is never touched.
import { randomUUID } from 'node:crypto';
import { once, tx, type Db } from '../db';
import { DEFAULT_CAPS } from '../settings';

export function bootConfig(db: Db, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  // The workspace clock starts as this machine's zone at the first boot, and the cap defaults as today's built-in ones.
  tx(db, () =>
    once(db, 'settings:fill-workspace') &&
    fill(db, 'workspace', {
      timezone: zone,
      'caps.adSpendChangePerDay': DEFAULT_CAPS.adSpendChangePerDay,
      'caps.higgsfieldCreditsPerDay': DEFAULT_CAPS.higgsfieldCreditsPerDay,
      'caps.agentCostPerDay': DEFAULT_CAPS.agentCostPerDay,
    }),
  );
  tx(db, () => once(db, 'settings:fill-personal') && fill(db, 'personal', {}));
}

/** Creates the `settings` row or adds its absent keys (present ones stay as they are); each added key is a migration change. */
function fill(db: Db, doc: string, values: Record<string, unknown>) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(doc);
  const cur = row ? (JSON.parse(String(row.value_json)) as Record<string, unknown>) : {};
  const added = Object.entries(values).filter(([k]) => !(k in cur));
  if (row && !added.length) return;
  const at = new Date().toISOString();
  db.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at').run(
    doc,
    JSON.stringify({ ...cur, ...Object.fromEntries(added) }),
    at,
  );
  const change = db.prepare("INSERT INTO settings_changes (id, at, actor, scope, setting, after_json) VALUES (?, ?, 'migration', ?, ?, ?)");
  for (const [k, v] of added) change.run(randomUUID(), at, doc, k, JSON.stringify(v));
}
