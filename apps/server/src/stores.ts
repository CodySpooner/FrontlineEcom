import type { Store } from '@frontline/shared';
import type { Db } from './db';

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
});

export const listStores = (db: Db) => db.prepare('SELECT * FROM stores ORDER BY created_at, rowid').all().map(toStore);

export function insertStore(db: Db, s: Store, demo = false) {
  db.prepare(
    'INSERT INTO stores (id, name, platform, niche, niche_detail, currency, timezone, color, connected, demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(s.id, s.name, s.platform, s.niche, s.nicheDetail ?? null, s.currency, s.timezone, s.color, s.connected ? 1 : 0, demo ? 1 : 0);
}
