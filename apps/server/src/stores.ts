import { NICHES, PLATFORMS, type Store, type StoreInput, type StoreUpdate } from '@frontline/shared';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, once, tx, type Db } from './db';
import { seedDemoStore } from './demo';
import { setStoreCurrency, setStoreTimezone } from './connectors/common';
import { ConfigError, storeChanged } from './config/write';

type Row = Record<string, unknown>;

const toStore = (r: Row): Store => ({
  id: String(r.id),
  name: String(r.name),
  platform: r.platform as Store['platform'],
  niche: r.niche as Store['niche'],
  ...(r.niche_detail ? { nicheDetail: String(r.niche_detail) } : {}),
  currency: String(r.currency),
  timezone: String(r.timezone),
  color: String(r.color),
  connected: r.connected === 1,
  ...(Number(r.fee_percent) ? { feePercent: Number(r.fee_percent) } : {}),
  ...(Number(r.fee_per_order) ? { feePerOrder: Number(r.fee_per_order) } : {}),
  version: Number(r.version),
});

export const listStores = (db: Db) => db.prepare('SELECT * FROM stores ORDER BY created_at, rowid').all().map(toStore);

/**
 * The timezone a store's days are dated in: a real store's own (connectors date orders in the shop's zone), undefined
 * (the machine's) for seeded demo data.
 */
export function storeZone(db: Db, storeId: string | undefined) {
  const r = storeId ? db.prepare('SELECT timezone, demo FROM stores WHERE id = ?').get(storeId) : undefined;
  return r && !r.demo ? String(r.timezone) : undefined;
}

export const getStore = (db: Db, id: string) => {
  const r = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
  return r ? toStore(r) : undefined;
};

export function insertStore(db: Db, s: Store, demo = false) {
  db.prepare(
    'INSERT INTO stores (id, name, platform, niche, niche_detail, currency, timezone, color, connected, demo, fee_percent, fee_per_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(s.id, s.name, s.platform, s.niche, s.nicheDetail ?? null, s.currency, s.timezone, s.color, s.connected ? 1 : 0, demo ? 1 : 0, s.feePercent ?? 0, s.feePerOrder ?? 0);
}

/** `field` is the registry id (`store.<key>`, settings decision 6). */
export type StoreInputError = { error: string; field?: `store.${keyof StoreInput}` };

/** Validates a create/update body at the API boundary; returns the error (with the setting it's about) or the clean fields. */
export function parseStoreInput(body: unknown, partial: boolean): StoreInputError | StoreUpdate {
  const bad = (error: string, field?: keyof StoreInput): StoreInputError => (field ? { error, field: `store.${field}` } : { error });
  if (!body || typeof body !== 'object') return bad('body must be a JSON object');
  const b = body as Record<string, unknown>;
  const out: StoreUpdate = {};
  const str = (k: keyof StoreInput, max: number) => {
    const v = b[k];
    if (v === undefined) return true;
    if (typeof v !== 'string' || !v.trim() || v.trim().length > max) return false;
    (out as Record<string, string>)[k] = v.trim();
    return true;
  };
  if (!partial && (b.name === undefined || b.platform === undefined || b.niche === undefined)) return bad('name, platform and niche are required');
  if (!str('name', 80)) return bad('name must be 1-80 characters', 'name');
  if (b.platform !== undefined && !PLATFORMS.includes(b.platform as Store['platform'])) return bad(`platform must be one of ${PLATFORMS.join(', ')}`, 'platform');
  if (b.niche !== undefined && !NICHES.includes(b.niche as Store['niche'])) return bad(`niche must be one of ${NICHES.join(', ')}`, 'niche');
  if (b.platform !== undefined) out.platform = b.platform as Store['platform'];
  if (b.niche !== undefined) out.niche = b.niche as Store['niche'];
  if (!str('nicheDetail', 120)) return bad('nicheDetail must be 1-120 characters', 'nicheDetail');
  if (!str('currency', 3) || (out.currency && !/^[A-Z]{3}$/.test(out.currency))) return bad('currency must be a 3-letter ISO code', 'currency');
  if (!str('timezone', 64)) return bad('timezone must be an IANA name', 'timezone');
  if (out.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: out.timezone });
    } catch {
      return bad('timezone must be an IANA name', 'timezone');
    }
  }
  if (!str('color', 7) || (out.color && !/^#[0-9a-fA-F]{6}$/.test(out.color))) return bad('color must be #rrggbb', 'color');
  for (const [k, max, msg] of [['feePercent', 50, '% of revenue'], ['feePerOrder', 100, 'per order, in the store currency']] as const) {
    const v = b[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return bad(`${k} must be a number from 0 to ${max} (${msg})`, k);
    out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'store';

/** Creates a store; without credentials it starts in demo mode with generated history. */
export function createStore(db: Db, input: StoreInput): Store {
  return tx(db, () => {
    const base = slug(input.name);
    let id = base;
    // Never a deleted store's id: its sync positions and once-per-store flags (keyed by the id) would carry over.
    // ponytail: only stores deleted since this check are known.
    const deleted = db.prepare('SELECT 1 FROM done_once WHERE ref = ?');
    for (let n = 2; getStore(db, id) || deleted.get(`deleted-store:${id}`); n++) id = `${base}-${n}`;
    const store: Store = {
      id,
      name: input.name,
      platform: input.platform,
      niche: input.niche,
      ...(input.nicheDetail ? { nicheDetail: input.nicheDetail } : {}),
      currency: input.currency ?? 'USD',
      timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      color: input.color ?? '#ff2a3a',
      connected: false,
      ...(input.feePercent ? { feePercent: input.feePercent } : {}),
      ...(input.feePerOrder ? { feePerOrder: input.feePerOrder } : {}),
    };
    insertStore(db, store, true);
    seedDemoStore(db, id);
    return getStore(db, id)!; // with its version
  });
}

/**
 * The owner's edit of a store. `version` (as read) is checked when given: a stale one throws ConfigError (409). One
 * version bump per save, and a change row for each field that moved.
 */
export function updateStore(db: Db, id: string, u: StoreUpdate, version?: number): Store | undefined {
  const cols: Record<keyof StoreInput, string> = {
    name: 'name', platform: 'platform', niche: 'niche', nicheDetail: 'niche_detail', currency: 'currency', timezone: 'timezone', color: 'color',
    feePercent: 'fee_percent', feePerOrder: 'fee_per_order',
  };
  const keys = (Object.keys(u) as (keyof StoreInput)[]).filter((k) => k !== 'timezone' && k !== 'currency');
  return tx(db, () => {
    const before = getStore(db, id);
    if (!before) return undefined;
    if (version !== undefined && version !== before.version) throw new ConfigError(409, { error: 'This store was saved somewhere else while you were editing.', code: 'stale', current: before });
    if (keys.length) db.prepare(`UPDATE stores SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => u[k]!), id);
    if (u.timezone) setStoreTimezone(db, id, u.timezone); // re-dates a real store's orders
    if (u.currency) setStoreCurrency(db, id, u.currency, null); // closes requests priced in the old one
    const after = getStore(db, id)!;
    const moved = (Object.keys(u) as (keyof StoreInput)[]).filter((k) => before[k] !== after[k]);
    storeChanged(db, id, 'owner', moved.map((k) => [`store.${k}`, before[k], after[k]]));
    return getStore(db, id);
  });
}

/** Deletes the store (its rows cascade) and its creatives' rendered files (videos run to tens of MB). */
export function deleteStore(db: Db, id: string, mediaDir = join(dataDir(), 'creatives')) {
  const files = db.prepare('SELECT media_url FROM creatives WHERE store_id = ?').all(id)
    .map((r) => String(r.media_url ?? '').match(/^\/api\/creatives\/media\/([\w-]+\.(?:jpg|png|webp|mp4))$/)?.[1]);
  if (!db.prepare('DELETE FROM stores WHERE id = ?').run(id).changes) return false;
  db.prepare('DELETE FROM conversations_fts WHERE store_id = ?').run(id); // a virtual table: no cascade
  once(db, `deleted-store:${id}`); // see createStore
  for (const f of files) {
    try {
      if (f) rmSync(join(mediaDir, f), { force: true });
    } catch {
      // A file held open elsewhere stays; the store is gone either way.
    }
  }
  return true;
}
