import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { cell, EXPORT_CAP, exportListings, headBlock } from './exports';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { storePeriod, type StorePeriod } from './period';

const { P1 } = LEDGER_PERIODS;
const NOW = new Date(LEDGER_NOW);
const p1 = (db: Db, compare = 'none') => storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: P1.from, to: P1.to, compare })[k], LEDGER_NOW) as StorePeriod;
/** The file's lines, the header block's as label → value, and the table from its column line on. */
function read(file: string) {
  expect(file.startsWith('﻿')).toBe(true);
  expect(file.endsWith('\r\n')).toBe(true);
  const lines = file.slice(1, -2).split('\r\n');
  const blank = lines.indexOf('');
  const unquote = (v: string) => (v.startsWith('"') ? v.slice(1, -1).replaceAll('""', '"') : v);
  return { head: new Map(lines.slice(0, blank).map((l) => [l.slice(0, l.indexOf(',')), unquote(l.slice(l.indexOf(',') + 1))])), table: lines.slice(blank + 1) };
}
const file = (out: ReturnType<typeof exportListings>) => {
  if ('error' in out) throw new Error(out.error);
  return read(out.csv);
};

afterEach(() => vi.useRealTimers());

describe('CSV engine (SA-85, decision 35)', () => {
  it('quotes per RFC 4180 and defuses a text cell a spreadsheet would run', () => {
    expect([cell('=SUM(A1)'), cell('+1'), cell('-x'), cell('@me'), cell('\tx'), cell('\rx')]).toEqual(["'=SUM(A1)", "'+1", "'-x", "'@me", "'\tx", "\"'\rx\""]);
    expect([cell('a,b'), cell('say "hi"'), cell('two\nlines'), cell('=a,b'), cell('plain')]).toEqual(['"a,b"', '"say ""hi"""', '"two\nlines"', '"\'=a,b"', 'plain']);
    expect([cell(-5), cell(0), cell(12.5), cell(null), cell(undefined)]).toEqual(['-5', '0', '12.5', '', '']); // numbers stay numbers; missing is empty, never 0
  });

  it('states the cap when there are more rows than it', () => {
    const db = openDb();
    seedLedgerStore(db);
    const head = new Map(headBlock(db, LEDGER_STORE, p1(db), { scope: { applied: [], ignored: [] }, filters: {}, also: [], metrics: [], rows: EXPORT_CAP, total: EXPORT_CAP + 1, now: NOW }));
    expect(head.get('Rows')).toBe('50000 of 50001 (capped at 50,000 rows)');
  });
});

describe('Listings export (SA-85)', () => {
  it("every matching row with its header block; a title starting with = is prefixed; the filters say what's applied", () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("UPDATE products SET title = '=HYPERLINK(\"http://x\")' WHERE store_id = ? AND id = '8002'").run(LEDGER_STORE);
    const { head, table } = file(exportListings(db, LEDGER_STORE, { status: 'all', sort: 'title' }, p1(db), { channel: ['site'], market: ['US'] }, 'refund_day', NOW));
    expect(head.get('Store')).toBe('Ledger Test Store (ledger)');
    expect(head.has('Demo data')).toBe(false);
    expect([head.get('Period'), head.get('Comparison'), head.get('Time zone')]).toEqual([`${P1.from} to ${P1.to} (7 days)`, 'None', p1(db).zoneLabel]);
    expect(head.get('Filters applied')).toBe('Channel: site; Status: all');
    expect(head.get('Filters not applied')).toBe('Market: Not applied to listings yet');
    expect(head.get('Currency')).toMatch(/^USD\. The store's currency\. Orders in another currency convert/);
    expect(head.get('Definition net_sales@1')).toMatch(/^Net sales: Gross merchandise sales/);
    expect([...head.keys()].filter((k) => k.startsWith('Source ')).length).toBeGreaterThan(0); // each source's freshness
    expect([head.get('Generated at'), head.get('Rows')]).toEqual([NOW.toISOString(), '4 of 4']);
    expect(table[0]).toBe('Product ID,Title,Status,SKU,Variants,Variants out,Category,Collections,Channels,Price,Compare-at price,Stock,Stock state,Cover days,Units,Net sales,Refunds,Refund rate,Contribution before ads,Cost coverage,Last synced');
    expect(table.slice(1).map((l) => l.split(',')[0])).toEqual(['8002', '8003', 'tt-9001', '8001']); // sorted by title: the = title first
    expect(table[1]).toContain(`,"'=HYPERLINK(""http://x"")",`);
    expect(table[2]).toContain(',Overnight Lip Mask,active,,3,1,,Best sellers; Lip care,site (active),18,,57,In stock,,');
  });

  it("a comparison adds its column; a selection exports only those products, each the store's; bad input is 400", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LEDGER_NOW);
    const db = openDb();
    seedLedgerStore(db);
    const { head, table } = file(exportListings(db, LEDGER_STORE, { products: '8003,8001,8003' }, p1(db, 'previous'), {}, 'refund_day', NOW));
    expect(table[0]).toContain(',Net sales,Comparison net sales,Refunds,');
    expect(table.slice(1).map((l) => l.split(',')[0]).sort()).toEqual(['8001', '8003']);
    expect([head.get('Filters applied'), head.get('Rows')]).toEqual(['Product: 8003, 8001; Selection: 2 products', '2 of 2']);
    const add = db.prepare("INSERT INTO products (store_id, id, title, price, status) VALUES (?, ?, ?, 5, 'active')");
    for (let i = 0; i < 30; i++) add.run(LEDGER_STORE, `x${i}`, `Extra ${i}`);
    const every = file(exportListings(db, LEDGER_STORE, {}, p1(db), {}, 'refund_day', NOW));
    expect([every.head.get('Rows'), every.table.length]).toEqual(['34 of 34', 35]); // past the table's 25-row page

    seedDemo(db, '2026-10-26');
    const app = createApp(db);
    const get = (q: string) => app.request(`/api/analytics/export/listings?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}${q}`);
    const ok = await get('&stock=low');
    expect([ok.status, ok.headers.get('content-type'), ok.headers.get('content-disposition')]).toEqual([200, 'text/csv; charset=utf-8', `attachment; filename="listings-ledger-${P1.from}-${P1.to}.csv"`]);
    expect(read(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await ok.arrayBuffer())).head.get('Filters applied')).toBe('Stock: Low cover'); // text() would drop the BOM
    expect((await get('&products=8001,glow-p1')).status).toBe(404); // another store's product
    for (const q of ['&stock=wet', '&sort=color', '&refunds=whenever']) expect((await get(q)).status).toBe(400);
  });

  it("a demo store's file has the demo line", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const sp = storePeriod(db, 'glow', () => undefined, Date.parse('2026-10-26T15:00:00Z')) as StorePeriod;
    const { head, table } = file(exportListings(db, 'glow', {}, sp, {}, 'refund_day', NOW));
    expect(head.get('Demo data')).toBe("A demo store's generated numbers, not real sales");
    expect([...head.keys()].filter((k) => k.startsWith('Source ')).length).toBeGreaterThan(0); // each source's freshness
    expect(table.length).toBeGreaterThan(1);
  });
});
