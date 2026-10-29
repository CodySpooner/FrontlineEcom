// The config writer (ST-07, decision 6). One transaction per save: for every document it checks the version read,
// validates against the registry, checks the scope, applies `set` and `unset` (an unset deletes the override key, back
// to inheriting) and writes a change row per setting that moved. A refusal throws ConfigError, so nothing is written.
import { randomUUID } from 'node:crypto';
import { SETTINGS, validateSetting, type ConfigDoc, type ConfigWrite, type SettingScope } from '@frontline/shared';
import { tx, type Db } from '../db';
import { getStore } from '../stores';
import { docOf, getPath, pathIn, readDoc } from './effective';

export class ConfigError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly body: { error: string; field?: string; code?: 'stale' | 'exists'; current?: unknown },
  ) {
    super(body.error);
  }
}

export type DocWrite = Omit<ConfigWrite['documents'][number], 'version'> & { version?: number };
export interface WriteOptions {
  actor?: string;
  requestId?: string;
  /** The in-process owners (`updateSettings`, `updateCaps`) validated already, legacy keys included. */
  trusted?: boolean;
  /** A 409's `current`: the document as the caller's route shows it. */
  current: (w: DocWrite) => unknown;
}

const SCOPES: Record<ConfigDoc, SettingScope[]> = { app: ['personal', 'workspace'], personal: ['personal'], workspace: ['workspace'], store_caps: ['store'] };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function check(doc: ConfigDoc, id: string, value?: unknown) {
  const def = SETTINGS.find((d) => d.id === id);
  if (!def) throw new ConfigError(400, { error: `There's no setting ${id}`, field: id });
  if (def.locked) throw new ConfigError(400, { error: `${def.label} is a workspace policy: nothing can change it`, field: id });
  if (!SCOPES[doc].some((s) => docOf(def, s) === doc)) throw new ConfigError(400, { error: `${def.label} can't be set here (it's a ${def.scopes.join(' or ')} setting)`, field: id });
  if (value === undefined) return;
  const bad = validateSetting(def, value);
  // An autopilot rule's two fields have their own types (the map check covers its keys only).
  const rule = id.startsWith('autopilot.') && value !== null && (!isObj(value) || typeof value.enabled !== 'boolean' || typeof value.maxUsdPerDay !== 'number' || value.maxUsdPerDay < 0 || value.maxUsdPerDay > 1e6);
  if (bad || rule) throw new ConfigError(400, { error: bad ?? `${def.label} must be { enabled, maxUsdPerDay from 0 to 1000000 }`, field: id });
}

function setPath(o: Record<string, unknown>, path: string[], value: unknown) {
  const last = path.at(-1)!;
  const parent = path.slice(0, -1).reduce<Record<string, unknown>>((p, k) => (isObj(p[k]) ? p[k] : (p[k] = {})) as Record<string, unknown>, o);
  if (value === undefined) delete parent[last];
  else parent[last] = value;
}

function writeDoc(db: Db, w: DocWrite, o: WriteOptions) {
  const store = w.doc === 'store_caps' ? getStore(db, w.storeId ?? '') : undefined;
  if (w.doc === 'store_caps' && !store) throw new ConfigError(404, { error: 'store not found' });
  const cur = readDoc(db, w.doc, w.storeId);
  // A missing row reads as version 0; 0 creates it. A row deleted elsewhere is never recreated silently.
  if (w.version !== undefined && w.version !== cur.version) {
    const code = w.version === 0 ? 'exists' : 'stale';
    throw new ConfigError(409, { error: 'This was saved somewhere else while you were editing.', code, current: cur.exists ? o.current(w) : null });
  }
  const json = structuredClone(cur.json);
  const moved: [string, unknown, unknown][] = [];
  const apply = (id: string, value: unknown) => {
    const path = pathIn(w.doc, id);
    const before = getPath(json, path);
    if (same(before, value)) return;
    setPath(json, path, value);
    moved.push([id, before, value]);
  };
  for (const [id, value] of Object.entries(w.set ?? {})) {
    if (!o.trusted) check(w.doc, id, value);
    apply(id, value);
  }
  for (const id of w.unset ?? []) {
    if (!o.trusted) check(w.doc, id);
    apply(id, undefined);
  }
  if (!moved.length) return; // nothing the owner edits changed: the version stays
  const at = new Date().toISOString();
  const value = JSON.stringify(json);
  const ok = cur.exists
    ? (w.doc === 'store_caps'
        ? db.prepare('UPDATE store_caps SET value_json = ?, version = version + 1, updated_at = ? WHERE store_id = ? AND version = ?').run(value, at, w.storeId!, cur.version)
        : db.prepare('UPDATE settings SET value_json = ?, version = version + 1, updated_at = ? WHERE key = ? AND version = ?').run(value, at, w.doc, cur.version)
      ).changes === 1
    : (w.doc === 'store_caps'
        ? db.prepare('INSERT INTO store_caps (store_id, value_json, version, updated_at) VALUES (?, ?, 1, ?)').run(w.storeId!, value, at)
        : db.prepare('INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, ?, 1, ?)').run(w.doc, value, at)
      ).changes === 1;
  if (!ok) throw new ConfigError(409, { error: 'This was saved somewhere else while you were editing.', code: 'stale', current: o.current(w) });
  const change = db.prepare('INSERT INTO settings_changes (id, at, request_id, actor, scope, store_id, store_name, setting, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const [id, before, after] of moved) {
    const scope = w.doc === 'store_caps' ? 'store' : w.doc === 'app' ? (SETTINGS.find((d) => d.id === id)?.scopes[0] ?? 'personal') : w.doc;
    change.run(randomUUID(), at, o.requestId ?? null, o.actor ?? 'owner', scope, store?.id ?? null, store?.name ?? null, id, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after));
  }
}

/** Writes every document or none. */
export const writeConfig = (db: Db, documents: DocWrite[], o: WriteOptions) => tx(db, () => documents.forEach((w) => writeDoc(db, w, o)));
