import type { Backup, SetupItem } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { markSource } from '../product-research/jobs';
import { checklist } from './checklist';

const now = new Date('2026-10-29T12:00:00Z');
const open = (items: SetupItem[]) => items.filter((i) => !i.done).map((i) => i.id);
const backup = (hoursAgo: number): Backup[] => [{ name: 'frontline-2026-10-27.db', size: 1, createdAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString() }];
const integration = (db: Db, kind: string, storeId: string | null) =>
  db.prepare("INSERT INTO integrations (id, kind, store_id, encrypted_credentials, updated_at) VALUES (?, ?, ?, 'x', ?)").run(`${kind}:${storeId ?? 'all'}`, kind, storeId, now.toISOString());

test('each item stays open until its real condition holds, and closes when it does', () => {
  const db = openDb();
  seedDemo(db, '2026-10-26'); // three demo stores, synced: none of them is the owner's
  db.prepare("UPDATE integrations SET synced_at = ? WHERE store_id IS NOT NULL").run(now.toISOString());
  const out = { signedIn: false };
  expect(open(checklist(db, out, now, []))).toEqual(['store', 'claude', 'research', 'backup']);

  db.prepare("INSERT INTO stores (id, name, platform, niche) VALUES ('mine', 'Paw Lab', 'shopify', 'pets'), ('wm', 'Mart', 'walmart', 'home')").run();
  const items = checklist(db, out, now, []);
  expect(open(items)).toEqual(['claude', 'platform:mine', 'research', 'backup']); // Walmart has no connector to sync
  expect(items.find((i) => i.id === 'platform:mine')).toMatchObject({ title: 'Sync Paw Lab from Shopify', detail: 'Not connected.', link: '/settings/integrations?store=mine' });

  integration(db, 'meta_ads', 'mine');
  db.prepare("UPDATE integrations SET synced_at = ? WHERE kind = 'meta_ads'").run(now.toISOString()); // the ad account synced, not the platform
  integration(db, 'shopify', 'mine');
  expect(checklist(db, out, now, []).find((i) => i.id === 'platform:mine')).toMatchObject({ done: false, detail: 'Connected, no successful sync yet.' });
  db.prepare("UPDATE integrations SET synced_at = ?, status = 'error' WHERE id = 'shopify:mine'").run(now.toISOString()); // synced once, failing since
  expect(open(checklist(db, out, now, []))).toEqual(['claude', 'research', 'backup']);

  expect(open(checklist(db, { signedIn: true }, now, backup(49)))).toEqual(['research', 'backup']);
  expect(checklist(db, { signedIn: true }, now, backup(49)).at(-1)!.detail).toBe('The newest backup is 49 hours old.');
  expect(open(checklist(db, { signedIn: true }, now, backup(47)))).toEqual(['research']);
  markSource(db, 'cj', { ok: true }, now);
  expect(open(checklist(db, { signedIn: true }, now, backup(47)))).toEqual([]);
});

test('a saved but unsynced CJ key stays open', () => {
  const db = openDb();
  const research = () => checklist(db, { signedIn: true }, now, backup(1)).find((i) => i.id === 'research')!;
  expect(research()).toMatchObject({ done: false, detail: 'Connect CJ Dropshipping and let it sync once.' });
  integration(db, 'cj', null);
  // The token call answered with a quota: the source row exists and says ok, but nothing has synced.
  db.prepare("INSERT INTO pr_sources (id, status, quota_json, updated_at) VALUES ('cj', 'ok', '{}', ?)").run(now.toISOString());
  expect(research()).toMatchObject({ done: false, detail: 'CJ key saved, no successful sync yet.' });
  markSource(db, 'cj', { ok: false, kind: 'auth', error: 'HTTP 401' }, now);
  expect(research().done).toBe(false);
  markSource(db, 'cj', { ok: true }, now);
  expect(research().done).toBe(true);
});

test('GET /api/config/checklist reads the account check: the demo engine never signs in', async () => {
  const db = openDb();
  const items = (await (await createApp(db).request('/api/config/checklist')).json()) as SetupItem[];
  expect(items.find((i) => i.id === 'claude')).toMatchObject({ done: false, link: '/settings/integrations', detail: expect.stringContaining('demo engine') });
  expect(items.map((i) => i.id)).toEqual(['store', 'claude', 'research', 'backup']);
});
