import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { openDb } from '../db';
import { saveIntegration, updateSecrets } from '../integrations';
import { CAPS, recordCall, type CallPurpose } from '../product-research/caps';
import { cjProduct } from './cj';

afterEach(() => vi.unstubAllEnvs());

test.each([
  { purpose: 'ingestion', cap: CAPS.cj.ingestionCallsPerDay, web: 'test-web' },
  { purpose: 'watch', cap: CAPS.cj.watchCallsPerDay, web: 'test-web' },
  { purpose: 'owner', cap: CAPS.cj.devTotal, web: '' },
] as const)('concurrent $purpose calls reserve the last slot before waiting or fetching', async ({ purpose, cap, web }) => {
  vi.stubEnv('FRONTLINE_WEB_DIR', web);
  const db = openDb();
  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'cj', values: { apiKey: 'CJ-TEST' } });
  updateSecrets(db, key, 'cj:global', { accessToken: 'cached-test', accessTokenExpiresAt: String(Date.now() / 1000 + 172800) });
  for (let i = 0; i < cap - 1; i++) recordCall(db, 'cj', purpose, true);
  const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ code: 200, data: { pid: 'test' } }));
  try {
    const results = await Promise.allSettled([1, 2, 3].map(() => cjProduct(db, key, 'test', { purpose, gapMs: 0, fetchFn })));
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected', 'rejected']);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ kind: 'quota' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT count(*) AS n FROM pr_calls').get()?.n).toBe(cap);
  } finally { db.close(); }
});

test('a failed fetch retains one reservation, counted while the fetch is in flight', async () => {
  const db = openDb();
  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'cj', values: { apiKey: 'CJ-TEST' } });
  updateSecrets(db, key, 'cj:global', { accessToken: 'cached-test', accessTokenExpiresAt: String(Date.now() / 1000 + 172800) });
  const purpose: CallPurpose = 'watch';
  let inFlight: unknown;
  const fetchFn: typeof fetch = async () => {
    inFlight = db.prepare('SELECT purpose, ok FROM pr_calls').all();
    throw new Error('Offline');
  };
  try {
    await expect(cjProduct(db, key, 'test', { purpose, gapMs: 0, fetchFn })).rejects.toMatchObject({ kind: 'server' });
    expect(inFlight).toEqual([{ purpose, ok: 0 }]);
    expect(db.prepare('SELECT purpose, ok FROM pr_calls').all()).toEqual([{ purpose, ok: 0 }]);
  } finally { db.close(); }
});
