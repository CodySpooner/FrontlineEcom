import type { PrCard, PrComparison, PrHistoryRow, PrProductDetail } from '@frontline/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';

// Decision 14's persistence line: what the owner decided survives the app closing, not only a re-render. The task,
// its instructions and report across a restart, and Interrupted · Retry, are in reports.test.ts and tasks.test.ts.
test("a restart on the same database file keeps the stage, its History, the watch, the comparison and the owner's notes", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-persist-'));
  const file = join(dir, 'frontline.db');
  let db = openDb(file);
  try {
    seedDemo(db);
    const [p, q] = ['Dog travel water bowl', 'Collapsible silicone bowl'].map((title, i) => upsertListing(db, { source: 'cj', sourceRef: String(i), title, category: 'Pet Supplies > Travel', origin: 'ingest' }).productId) as [string, string];
    for (const id of [p, q]) refreshProduct(db, id);
    let app = createApp(db);
    const send = (method: string, path: string, body: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const get = async <T>(path: string) => (await (await app.request(path)).json()) as T;
    expect((await send('POST', `/api/pr/products/${p}/stage?store=pawsome`, { stage: 'shortlisted', reason: 'Fits the travel line' })).status).toBe(200);
    expect((await send('PUT', `/api/pr/products/${p}/watch?store=pawsome`, { on: true })).status).toBe(200);
    expect((await send('PUT', `/api/pr/products/${p}/store-notes?store=pawsome`, { notes: 'Ask for a sample price' })).status).toBe(200);
    expect((await send('POST', '/api/pr/comparisons?store=pawsome', { name: 'Bowls', productIds: [p, q] })).status).toBe(201);
    const kept = async () => {
      const card = (await get<{ items: PrCard[] }>('/api/pr/products?store=pawsome&limit=48')).items.find((c) => c.id === p)!;
      return {
        card: { stage: card.stage, watched: card.watched },
        notes: (await get<PrProductDetail>(`/api/pr/products/${p}?store=pawsome`)).notes,
        history: await get<PrHistoryRow[]>(`/api/pr/products/${p}/history?store=pawsome`),
        comparisons: (await get<PrComparison[]>('/api/pr/comparisons?store=pawsome')).map((c) => ({ id: c.id, name: c.name, productIds: c.productIds })),
      };
    };
    const before = await kept();
    expect(before).toMatchObject({ card: { stage: 'shortlisted', watched: true }, notes: 'Ask for a sample price', comparisons: [{ name: 'Bowls', productIds: [p, q] }] });
    expect(before.history.some((h) => h.kind === 'stage' && h.to === 'shortlisted' && h.reason === 'Fits the travel line')).toBe(true);

    db.close(); // the app closes; a new process opens the same file
    db = openDb(file);
    app = createApp(db);
    expect(await kept()).toEqual(before);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); // ponytail: Windows may hold the closed file briefly
  }
});
