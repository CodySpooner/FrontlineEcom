import { NICHES, PLATFORMS, type Store, type StoreInput, type StoreUpdate } from '@frontline/shared';
import { tx, type Db } from './db';
import { seedDemoStore } from './demo';

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

/** Validates a create/update body at the API boundary; returns an error message or the clean fields. */
export function parseStoreInput(body: unknown, partial: boolean): string | StoreUpdate {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const b = body as Record<string, unknown>;
  const out: StoreUpdate = {};
  const str = (k: keyof StoreInput, max: number) => {
    const v = b[k];
    if (v === undefined) return true;
    if (typeof v !== 'string' || !v.trim() || v.trim().length > max) return false;
    (out as Record<string, string>)[k] = v.trim();
    return true;
  };
  if (!partial && (b.name === undefined || b.platform === undefined || b.niche === undefined)) return 'name, platform and niche are required';
  if (!str('name', 80)) return 'name must be 1-80 characters';
  if (b.platform !== undefined && !PLATFORMS.includes(b.platform as Store['platform'])) return `platform must be one of ${PLATFORMS.join(', ')}`;
  if (b.niche !== undefined && !NICHES.includes(b.niche as Store['niche'])) return `niche must be one of ${NICHES.join(', ')}`;
  if (b.platform !== undefined) out.platform = b.platform as Store['platform'];
  if (b.niche !== undefined) out.niche = b.niche as Store['niche'];
  if (!str('nicheDetail', 120)) return 'nicheDetail must be 1-120 characters';
  if (!str('currency', 3) || (out.currency && !/^[A-Z]{3}$/.test(out.currency))) return 'currency must be a 3-letter ISO code';
  if (!str('timezone', 64)) return 'timezone must be an IANA name';
  if (out.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: out.timezone });
    } catch {
      return 'timezone must be an IANA name';
    }
  }
  if (!str('color', 7) || (out.color && !/^#[0-9a-fA-F]{6}$/.test(out.color))) return 'color must be #rrggbb';
  for (const [k, max, msg] of [['feePercent', 50, '% of revenue'], ['feePerOrder', 100, 'per order, in the store currency']] as const) {
    const v = b[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return `${k} must be a number from 0 to ${max} (${msg})`;
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
    for (let n = 2; getStore(db, id); n++) id = `${base}-${n}`;
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
    return store;
  });
}

export function updateStore(db: Db, id: string, u: StoreUpdate): Store | undefined {
  const cols: Record<keyof StoreInput, string> = {
    name: 'name', platform: 'platform', niche: 'niche', nicheDetail: 'niche_detail', currency: 'currency', timezone: 'timezone', color: 'color',
    feePercent: 'fee_percent', feePerOrder: 'fee_per_order',
  };
  const keys = Object.keys(u) as (keyof StoreInput)[];
  if (keys.length) db.prepare(`UPDATE stores SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => u[k]!), id);
  return getStore(db, id);
}

export const deleteStore = (db: Db, id: string) => db.prepare('DELETE FROM stores WHERE id = ?').run(id).changes > 0;
