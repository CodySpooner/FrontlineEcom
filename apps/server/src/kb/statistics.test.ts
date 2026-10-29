import { expect, test } from 'vitest';
import { createCard, ensureCategoryPath, lift } from '@frontline/agents';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { addDays } from '../dates';
import { learnFromPerformance } from './performance';
import { evaluateExperiments, planExperiment, significanceCutoff } from './experiments';

const FROM = '2026-08-10';
const TO = '2026-09-06';
const NOW = new Date('2026-10-27T12:00:00Z');
// Independent Poisson(100) purchases, equal spend and $1 orders: both sides have the same true ROAS.
function nullPairs() {
  let state = 42;
  const uniform = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) + 0.5) / 4294967296;
  const poisson = () => { let n = 0, product = 1; do { n++; product *= uniform(); } while (product > Math.exp(-100)); return n - 1; };
  return Array.from({ length: 200 }, () => [poisson(), poisson()] as const);
}
function setup() {
  const db = openDb();
  seedDemo(db, '2026-10-27');
  db.prepare("UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'").run();
  for (const t of ['daily_metrics', 'campaigns', 'orders', 'products']) db.prepare(`DELETE FROM ${t} WHERE store_id = 'peak'`).run();
  db.prepare("INSERT INTO integrations (id, kind, store_id, status, encrypted_credentials, updated_at, synced_at) VALUES ('meta_ads:peak', 'meta_ads', 'peak', 'connected', 'fixture', ?1, ?1)").run(NOW.toISOString());
  return db;
}

test('null simulation: performance readings passed through learn do not create a stream of measured lessons', () => {
  const db = setup();
  try {
    const camp = db.prepare("INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', ?, 'peak', ?, 'active', 10)");
    const ad = db.prepare("INSERT INTO ads (network, id, campaign_id, group_id, name, status) VALUES ('meta', ?, ?, 'same-audience', ?, 'active')");
    const day = db.prepare("INSERT INTO ad_daily (network, ad_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', ?, ?, ?, ?, ?, ?, ?)");
    nullPairs().forEach((pair, i) => {
      const campaign = `null-${i}`;
      camp.run(campaign, campaign);
      pair.forEach((purchases, side) => {
        const id = `${campaign}-${side}`;
        ad.run(id, campaign, id);
        const share = (n: number, d: number) => Math.floor(n * (d + 1) / 28) - Math.floor(n * d / 28);
        for (let d = 0; d < 28; d++) day.run(id, addDays(FROM, d), 100 / 28, purchases / 28, share(purchases, d), share(1000, d), share(50000, d));
      });
    });
    learnFromPerformance(db, '2026-10-27');
    const measured = Number(db.prepare("SELECT count(*) AS n FROM kb_evidence WHERE kind = 'measured'").get()!.n);
    const readings = Number(db.prepare("SELECT count(*) AS n FROM kb_observations WHERE metric = 'roas'").get()!.n);
    console.info(`Null performance: ${measured}/${readings} false measured readings`);
    expect(readings).toBe(400);
    expect(measured).toBeLessThanOrEqual(2);
  } finally { db.close(); }
});

test('null simulation: experiment reader rarely calls an equal-effect variant measured', () => {
  const db = setup();
  try {
    const card = createCard(db, 'peak', { categoryId: ensureCategoryPath(db, 'peak', ['Simulation']), title: 'Null simulation', summary: 'Synthetic test only', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
    const camp = db.prepare("INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', ?, 'peak', ?, 'active', 10)");
    const day = db.prepare("INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', ?, ?, 100, ?, ?, 1000, 50000)");
    nullPairs().forEach((pair, i) => {
      const ids = pair.map((purchases, side) => {
        const id = `null-${i}-${side}`;
        camp.run(id, id); day.run(id, FROM, purchases, purchases);
        return `meta:${id}`;
      });
      planExperiment(db, card.id, 'peak', { metric: 'roas', from: FROM, to: TO, minSample: 30, variants: [{ label: 'A', campaigns: [ids[0]!], creatives: [] }, { label: 'B', campaigns: [ids[1]!], creatives: [] }] }, NOW);
    });
    evaluateExperiments(db, NOW);
    const measured = Number(db.prepare("SELECT count(*) AS n FROM kb_evidence WHERE kind = 'measured'").get()!.n);
    console.info(`Null experiments: ${measured}/200 false measured results`);
    expect(db.prepare("SELECT count(*) AS n FROM kb_experiments WHERE status = 'planned'").get()!.n).toBe(0);
    expect(measured).toBeLessThanOrEqual(1);
  } finally { db.close(); }
});


test('normal two-sided p-values agree with reference quantiles and fail closed for invalid readings', () => {
  for (const [z, p] of [[0, 1], [1.96, 0.0499957903], [3.29, 0.0010018738], [4, 0.0000633425]] as const) {
    expect(Math.abs(lift(Math.exp(z * Math.sqrt(2 / 100)), 100, 1, 100).p - p)).toBeLessThan(1.5e-7);
    expect(Math.abs(lift(Math.exp(-z * Math.sqrt(2 / 100)), 100, 1, 100).p - p)).toBeLessThan(1.5e-7);
  }
  expect(lift(0, 0, 0, 0).p).toBe(1);
  expect(lift(Infinity, 100, 1, 100).p).toBe(1);
});

test('BH uses the largest passing rank even when an earlier rank fails, without changing its input', () => {
  const values = [1, 0.012, 1, 1, 0.011, 1, 1, 1, 1, 1];
  expect(significanceCutoff(values)).toBe(0.012);
  expect(values[0]).toBe(1);
  expect(significanceCutoff([0.2, 0.3, 1])).toBe(0);
  expect(significanceCutoff([])).toBe(0);
});
