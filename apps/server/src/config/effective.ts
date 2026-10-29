// Effective configuration (ST-07, decisions 4 and 6): each registry entry stored in the config documents, resolved
// store override → workspace value → registry default, with where it came from and each document's version.
import { SETTINGS, type ConfigDoc, type ConfigView, type SettingDef, type SettingOrigin, type SettingScope } from '@frontline/shared';
import type { Db } from '../db';

type Json = Record<string, unknown>;

/** Entries kept in the config documents (others belong to their owners: stores, KB controls, research profiles). */
export const inConfig = (d: SettingDef) => /^apps\/server\/src\/(settings\.ts|config\/)/.test(d.owner);

/** The document an entry lives in for a scope: `app` keeps its existing keys (personal and workspace alike). */
export function docOf(d: SettingDef, scope: SettingScope): ConfigDoc | undefined {
  if (!inConfig(d) || !d.scopes.includes(scope)) return;
  if (/^(profile|notifications)\.|^baseCurrency$/.test(d.id)) return 'app';
  return scope === 'store' ? 'store_caps' : scope === 'workspace' || scope === 'personal' ? scope : undefined;
}

/** The key path inside a document: `app` nests as before, `store_caps` keeps its old key names, the rest are flat ids. */
export function pathIn(doc: ConfigDoc, id: string): string[] {
  if (doc === 'app') return id.split('.');
  if (doc === 'store_caps') return id.startsWith('caps.') ? [id.slice(5)] : id.startsWith('autopilot.') ? ['autopilot', id.slice(10)] : [id];
  return [id];
}

export const getPath = (o: Json, path: string[]): unknown => path.reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Json)[k] : undefined), o);

/** A document's row: its JSON and version, or `{}` and 0 when there's no row. */
export function readDoc(db: Db, doc: ConfigDoc, storeId?: string): { json: Json; version: number; exists: boolean } {
  const r = doc === 'store_caps' ? db.prepare('SELECT value_json, version FROM store_caps WHERE store_id = ?').get(storeId!) : db.prepare('SELECT value_json, version FROM settings WHERE key = ?').get(doc);
  return r ? { json: JSON.parse(String(r.value_json)) as Json, version: Number(r.version), exists: true } : { json: {}, version: 0, exists: false };
}

export function effective(db: Db, o: { storeId?: string } = {}, defs: SettingDef[] = SETTINGS): ConfigView {
  const docs = { app: readDoc(db, 'app'), personal: readDoc(db, 'personal'), workspace: readDoc(db, 'workspace'), store_caps: o.storeId ? readDoc(db, 'store_caps', o.storeId) : undefined };
  const view: ConfigView = { values: {}, origins: {}, versions: { app: docs.app.version, personal: docs.personal.version, workspace: docs.workspace.version } };
  if (o.storeId) view.versions[`store_caps:${o.storeId}`] = docs.store_caps!.version;
  const put = (id: string, value: unknown, origin: SettingOrigin) => ((view.values[id] = value), (view.origins[id] = origin));
  for (const d of defs.filter((d) => inConfig(d) || d.locked)) {
    if (d.locked) {
      put(d.id, d.default, 'locked');
      continue;
    }
    const at = (scope: SettingScope) => {
      const doc = docOf(d, scope);
      return doc && docs[doc] ? getPath(docs[doc].json, pathIn(doc, d.id)) : undefined;
    };
    const storeScoped = d.scopes.includes('store');
    const shared = d.scopes.find((s) => s === 'workspace' || s === 'personal');
    if (storeScoped && !o.storeId && !shared) continue; // a store-only entry needs a store
    const store = o.storeId && storeScoped ? at('store') : undefined;
    if (store !== undefined) {
      put(d.id, store, 'store');
      continue;
    }
    // The workspace (or personal) value, unless this is a store's view of an entry that doesn't inherit.
    const own = shared && (!o.storeId || !storeScoped || d.inherits === 'workspace') ? at(shared) : undefined;
    put(d.id, own ?? d.default ?? null, own !== undefined ? 'workspace' : 'default');
  }
  return view;
}
