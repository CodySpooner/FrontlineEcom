import { afterEach, expect, test, vi } from 'vitest';
import { openDb, type Db } from '../db';
import { CAPS, callsToday, recordCall, refusal } from './caps';
import { upsertListing } from './catalog';
import { enqueue, planToday, requeueRunning, runDue, runJob, startPrJobs } from './jobs';
import { SourceError, type PrAdapter } from './sources/adapter';

const key = Buffer.alloc(32);
type Item = { id: string; title: string; price?: string };
const T0 = new Date('2026-10-28T10:00:00.000Z');

/** A source whose pages come from `pages[query][page-1]`, or throw what `fail(query, page)` returns. */
function fake(pages: Record<string, Item[][]>, fail?: (q: string, page: number) => SourceError | undefined): PrAdapter<Item> & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    id: 'fake',
    name: 'Fake',
    answers: ['discovery'],
    fields: ['title'],
    refreshHours: 24,
    rate: '1/s',
    quota: 'none',
    connect: 'nothing',
    access: () => 'credentials_required',
    ready: () => true,
    required: ['id', 'title'],
    page: async ({ db, query, page, purpose }) => {
      calls.push(`${query}#${page}`);
      const e = fail?.(query, page);
      recordCall(db, 'fake', purpose, !e, T0);
      if (e) throw e;
      const all = pages[query] ?? [];
      return { items: all[page - 1] ?? [], more: page < all.length };
    },
    ingest: (db, item, at) => upsertListing(db, { source: 'fake', sourceRef: item.id, origin: 'ingest', title: item.title, at }).productId,
    plan: () => [{ storeId: 'pawsome', queries: ['dog'] }],
  };
}
const items = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: String(from + i), title: `Item ${from + i}` }));
const job = (db: Db, id: string) => ({ ...db.prepare('SELECT status, attempts, error, next_attempt_at, checkpoint_json FROM pr_jobs WHERE id = ?').get(id) });
const source = (db: Db) => ({ ...db.prepare(`SELECT status, error_kind, last_error, last_success_at FROM pr_sources WHERE id = 'fake'`).get() });
const setup = () => {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche) VALUES ('pawsome', 'Pawsome', 'shopify', 'pet')`);
  return db;
};
const listings = (db: Db) => Number(db.prepare('SELECT count(*) AS n FROM pr_listings').get()?.n);
afterEach(() => vi.unstubAllEnvs());

test('a job pages through each query, storing and checkpointing every page; every call is in the ledger', async () => {
  const db = setup();
  const a = fake({ dog: [items(2), items(2, 2)], cat: [items(1, 10)] });
  const id = enqueue(db, { kind: 'ingest', source: 'fake', storeId: 'pawsome', queries: ['dog', 'cat'] }, T0);
  const stored: string[][] = [];
  expect(await runJob(db, id, a, { key, now: () => T0, onStored: (ids) => stored.push(ids) })).toBe('done');
  expect(a.calls).toEqual(['dog#1', 'dog#2', 'cat#1']);
  expect(listings(db)).toBe(5);
  expect(stored.map((s) => s.length)).toEqual([2, 2, 1]);
  expect(callsToday(db, 'fake', 'ingestion', T0)).toBe(3);
  expect(source(db)).toMatchObject({ status: 'ok', error_kind: null, last_success_at: T0.toISOString() });
  // A repeat finds the same listings: no duplicates.
  await runJob(db, enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0), a, { key, now: () => T0 });
  expect(listings(db)).toBe(5);
});

test('an auth failure stops the source with no retry until the owner saves new credentials', async () => {
  const db = setup();
  let saved: string | undefined;
  const a = { ...fake({ dog: [items(1)] }, () => new SourceError('auth', 'Invalid API key or access token.')), credentialsAt: () => saved };
  const id = enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0);
  expect(await runJob(db, id, a, { key, now: () => T0 })).toBe('stopped');
  expect(source(db)).toMatchObject({ status: 'stopped', error_kind: 'auth', last_error: 'Invalid API key or access token.' });
  expect(job(db, id)).toMatchObject({ status: 'stopped', attempts: 0 });
  const later = new Date(T0.getTime() + 3_600_000);
  const again = enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, later);
  await runDue(db, [a], { key, now: () => later });
  expect(a.calls).toHaveLength(1); // not called again
  expect(job(db, again)).toMatchObject({ status: 'stopped', error: 'The credentials were refused: enter them again in Integrations.' });
  saved = later.toISOString() + 'x'; // the owner saved the key again
  const third = enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, later);
  await runJob(db, third, a, { key, now: () => later });
  expect(a.calls).toHaveLength(2);
});

test('a rate limit waits for Retry-After; timeouts and server errors retry 3 times with backoff, then the job fails', async () => {
  const db = setup();
  const limited = fake({ dog: [items(1)] }, () => new SourceError('rate_limit', 'Too much request', 5_000));
  const id = enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0);
  expect(await runJob(db, id, limited, { key, now: () => T0 })).toBe('waiting');
  expect(job(db, id)).toMatchObject({ status: 'queued', attempts: 1, next_attempt_at: new Date(T0.getTime() + 5_000).toISOString() });
  expect(source(db)).toMatchObject({ status: 'degraded', error_kind: 'rate_limit' });

  const db2 = setup();
  const down = fake({ dog: [items(1)] }, () => new SourceError('timeout', 'Read timed out'));
  const j = enqueue(db2, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0);
  let now = T0;
  const waits: number[] = [];
  for (let i = 0; i < 4; i++) {
    await runDue(db2, [down], { key, now: () => now });
    const next = job(db2, j).next_attempt_at;
    if (next) {
      waits.push(new Date(String(next)).getTime() - now.getTime());
      now = new Date(String(next));
    }
  }
  expect(waits).toEqual([30_000, 120_000, 480_000]);
  expect(job(db2, j)).toMatchObject({ status: 'failed', attempts: 4, error: 'Read timed out' });
  expect(down.calls).toHaveLength(4);
  await runDue(db2, [down], { key, now: () => new Date(now.getTime() + 86_400_000) });
  expect(down.calls).toHaveLength(4); // a failed job is never retried by itself

  const db3 = setup();
  const bug = fake({ dog: [items(1)] }, () => new SourceError('request', 'Param error'));
  const k = enqueue(db3, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0);
  await runJob(db3, k, bug, { key, now: () => T0 });
  expect(job(db3, k)).toMatchObject({ status: 'failed', attempts: 1, error: 'Param error' }); // our bug: never retried
});

test('a used-up quota stops the source until 00:00 UTC', async () => {
  const db = setup();
  let quota = true;
  const a = fake({ dog: [items(1)] }, () => (quota ? new SourceError('quota', 'Insufficient API points') : undefined));
  await runJob(db, enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0), a, { key, now: () => T0 });
  const sameDay = new Date('2026-10-28T23:00:00.000Z');
  const j = enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, sameDay);
  expect(await runJob(db, j, a, { key, now: () => sameDay })).toBe('stopped');
  quota = false;
  const nextDay = new Date('2026-10-29T00:10:00.000Z');
  expect(await runJob(db, enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, nextDay), a, { key, now: () => nextDay })).toBe('done');
});

test('a schema change (a required field missing, or fields gone) stops the source and keeps its last good data', async () => {
  const db = setup();
  const good = fake({ dog: [[{ id: '1', title: 'Cup', price: '3' }]] });
  await runJob(db, enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0), good, { key, now: () => T0 });
  const gone = fake({ dog: [[{ id: '2', title: 'Mat' }]] }); // price no longer sent
  const j = enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0);
  expect(await runJob(db, j, gone, { key, now: () => T0 })).toBe('stopped');
  expect(source(db)).toMatchObject({ status: 'stopped', error_kind: 'schema', last_error: 'Fake stopped sending: price.' });
  expect(listings(db)).toBe(1);

  const db2 = setup();
  const noTitle = fake({ dog: [[{ id: '1' } as Item]] });
  await runJob(db2, enqueue(db2, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0), noTitle, { key, now: () => T0 });
  expect(source(db2)).toMatchObject({ status: 'stopped', error_kind: 'schema', last_error: 'Required field "title" missing from Fake\'s data.' });
  expect(listings(db2)).toBe(0);
});

test('a job resumes from its checkpoint: after a failure on page 2, and after an app restart', async () => {
  const db = setup();
  let fail = true;
  const a = fake({ dog: [items(1), items(1, 1), items(1, 2)] }, (_q, page) => (fail && page === 2 ? new SourceError('server', 'System busy') : undefined));
  const j = enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog'] }, T0);
  await runJob(db, j, a, { key, now: () => T0 });
  fail = false;
  await runDue(db, [a], { key, now: () => new Date(T0.getTime() + 60_000) });
  expect(a.calls).toEqual(['dog#1', 'dog#2', 'dog#2', 'dog#3']);
  expect(listings(db)).toBe(3);

  db.prepare(`UPDATE pr_jobs SET status = 'running', checkpoint_json = json_set(checkpoint_json, '$.q', 0, '$.page', 3) WHERE id = ?`).run(j);
  requeueRunning(db); // what boot does
  await runDue(db, [a], { key, now: () => T0 });
  expect(a.calls.at(-1)).toBe('dog#3');
});

test('caps: 5 pages per query a day, 500 ingestion calls a day, and 200 CJ calls in total in the dev app', async () => {
  const db = setup();
  const a = fake({ dog: Array.from({ length: 8 }, (_, i) => items(1, i)), cat: [items(1, 20)] });
  await runJob(db, enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['dog', 'cat'] }, T0), a, { key, now: () => T0 });
  expect(a.calls).toEqual(['dog#1', 'dog#2', 'dog#3', 'dog#4', 'dog#5', 'cat#1']);

  for (let i = 0; i < CAPS.cj.ingestionCallsPerDay - 6; i++) recordCall(db, 'fake', 'ingestion', true, T0);
  const j = enqueue(db, { kind: 'ingest', source: 'fake', storeId: null, queries: ['bird'] }, T0);
  expect(await runJob(db, j, a, { key, now: () => T0 })).toBe('waiting');
  expect(job(db, j)).toMatchObject({ status: 'queued', next_attempt_at: '2026-10-29T00:05:00.000Z' });
  expect(refusal(db, 'fake', 'owner', T0)).toBeUndefined(); // the owner's own searches have their own limits

  vi.stubEnv('FRONTLINE_WEB_DIR', '');
  for (let i = 0; i < CAPS.cj.devTotal; i++) recordCall(db, 'cj', 'search', true, T0);
  expect(refusal(db, 'cj', 'search', T0)).toMatch(/live-check limit of 200/);
  vi.stubEnv('FRONTLINE_WEB_DIR', 'C:/app/web'); // the desktop app has no total cap
  expect(refusal(db, 'cj', 'search', T0)).toBeUndefined();
});

test("planning runs once a day per ready source; the timer is off in the dev app unless PR_INGEST=1", async () => {
  const db = setup();
  const a = fake({ dog: [items(1)] });
  planToday(db, [a], key, T0);
  planToday(db, [a], key, new Date(T0.getTime() + 3_600_000));
  expect(db.prepare('SELECT count(*) AS n FROM pr_jobs').get()?.n).toBe(1);
  planToday(db, [{ ...a, id: 'off', ready: () => false }], key, T0);
  expect(db.prepare(`SELECT count(*) AS n FROM pr_jobs WHERE source = 'off'`).get()?.n).toBe(0);

  vi.stubEnv('FRONTLINE_WEB_DIR', '');
  vi.stubEnv('PR_INGEST', '');
  const spy = vi.spyOn(globalThis, 'setInterval');
  startPrJobs(db, key, [a]);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
