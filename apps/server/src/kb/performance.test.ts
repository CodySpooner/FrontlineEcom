import { createCard, ensureCategoryPath, getCard, learn, lift, listEvidence, updateCard, type Reading } from '@frontline/agents';
import type { KbCard } from '@frontline/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { addDays } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { learnFromPerformance, performanceStatus, settledPeriods } from './performance';

let db: Db;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
});

const today = '2026-10-27';
// The 28-day periods (counted from 2024-01-01) whose attribution has settled by `today` (30 days on), oldest first.
const P = [
  { from: '2026-06-15', to: '2026-07-12' },
  { from: '2026-07-13', to: '2026-08-09' },
  { from: '2026-08-10', to: '2026-09-06' },
] as const;

/** peak as a real store, as its first sync leaves it (demo numbers gone), its ad account last synced at `syncedAt`. */
function real(syncedAt = `${today}T12:00:00Z`) {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  for (const t of ['daily_metrics', 'campaigns', 'orders', 'products']) db.prepare(`DELETE FROM ${t} WHERE store_id = 'peak'`).run();
  db.prepare(`INSERT INTO integrations (id, kind, store_id, status, encrypted_credentials, updated_at, synced_at) VALUES ('meta_ads:peak', 'meta_ads', 'peak', 'connected', 'x', ?1, ?1)`).run(syncedAt);
}

type Ad = { spend: number; revenue: number; purchases: number; clicks?: number; impressions?: number; days?: number };
/** A campaign's totals over `period`, spread over its first `days` days (all 28 by default). */
function campaign(id: string, name: string, t: Ad, period: { from: string } = P[2], network = 'meta') {
  db.prepare(`INSERT OR IGNORE INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES (?, ?, 'peak', ?, 'active', 50)`).run(network, id, name);
  const days = t.days ?? 28;
  const share = (n: number, i: number) => Math.floor((n * (i + 1)) / days) - Math.floor((n * i) / days);
  for (let i = 0; i < days; i++)
    db.prepare(`INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      network, id, addDays(period.from, i), t.spend / days, t.revenue / days, share(t.purchases, i), share(t.clicks ?? 1000, i), share(t.impressions ?? 50_000, i),
    );
}
const DOG = { spend: 2800, revenue: 8400, purchases: 60 }; // ROAS 3
const BROAD = { spend: 2800, revenue: 4200, purchases: 60 }; // ROAS 1.5

const lessons = () =>
  db
    .prepare(`SELECT id FROM kb_cards WHERE store_id = 'peak' AND origin = 'performance' ORDER BY title`)
    .all()
    .map((r) => getCard(db, String(r.id))!);
const lesson = (title: string) => lessons().find((c) => c.title === title) as KbCard;
const brief = (c: KbCard) => [c.title, c.stage, listEvidence(db, c.id).map((e) => e.kind).join(' ')];
const observations = () => Number(db.prepare(`SELECT count(*) AS n FROM kb_observations WHERE store_id = 'peak'`).get()?.n);
const DOG_UP = `The "Dog car" campaign (Meta): ROAS above the store's other Meta campaigns`;
const BROAD_DOWN = `The "Broad" campaign (Meta): ROAS below the store's other Meta campaigns`;

describe('performance learning', () => {
  test('lift: a ratio with its 95% range and z, each side as noisy as its count', () => {
    const l = lift(3, 60, 1.5, 60);
    expect(l.ratio).toBe(2);
    expect(l.z).toBeCloseTo(Math.log(2) / Math.sqrt(2 / 60), 6); // 3.80
    expect(l.low).toBeCloseTo(Math.exp(Math.log(2) - 1.96 * Math.sqrt(2 / 60)), 6); // 1.40
    expect(l.high).toBeCloseTo(Math.exp(Math.log(2) + 1.96 * Math.sqrt(2 / 60)), 6); // 2.86
    expect(lift(1.5, 60, 3, 60).z).toBeCloseTo(-l.z, 6);
    expect(lift(2, 10, 1, 1000).z).toBeCloseTo(Math.log(2) / Math.sqrt(1 / 10 + 1 / 1000), 6);
  });

  test('periods: the last three whole 28-day periods that ended 31+ days before today', () => {
    expect(settledPeriods(today)).toEqual(P);
    expect(settledPeriods('2026-10-07').at(-1)).toEqual(P[2]); // ended 31 days before
    expect(settledPeriods('2026-10-06').at(-1)).toEqual(P[1]);
  });

  test('a reading is read once', () => {
    db.prepare(`UPDATE stores SET demo = 0 WHERE id = 'peak'`).run();
    const r: Reading = {
      storeId: 'peak', ref: 'r1', subject: 'store', name: 'The store', metric: 'cvr', label: 'conversion rate', vs: 'its weeks before', value: 0.04, baseline: 0.02,
      k: 400, kBase: 400, n: 400, unit: 'orders', from: P[2].from, to: P[2].to, show: String, confounds: [], path: ['Conversion'],
    };
    expect(learn(db, r)).toBe('lesson');
    expect(learn(db, r)).toBeUndefined();
    expect(learn(db, { ...r, ref: 'r2' })).toBe('evidence');
    expect(learn(db, { ...r, ref: 'r3', value: 0.021 })).toBe('noted');
    expect(listEvidence(db, lessons()[0]!.id)).toHaveLength(2);
  });

  test("a campaign that beats the store's other campaigns on its network, in two settled periods, is a Validated lesson, read once", () => {
    real();
    for (const p of [P[1], P[2]]) {
      campaign('dog', 'Dog car', DOG, p);
      campaign('broad', 'Broad', BROAD, p);
    }
    learnFromPerformance(db, today);
    const up = lesson(DOG_UP);
    expect(up).toMatchObject({ storeId: 'peak', type: 'performance_lesson', stage: 'validated', origin: 'performance', authorId: 'app', path: ['Advertising', 'Campaign results'] });
    // As first read; each reading is evidence.
    expect(up.summary).toBe(`ROAS 3.00 vs 1.50 for the store's other Meta campaigns, ${P[1].from} to ${P[1].to}: +100% (95% range +40% to +186%), on 60 purchases.`);
    expect(listEvidence(db, up.id).map((e) => [e.kind, e.metric, e.value, e.baseline, e.windowFrom, e.windowTo, e.sampleSize, e.testRef, e.text])).toEqual(
      [P[1], P[2]].map((p) => [
        'measured', 'roas', expect.closeTo(3, 9), expect.closeTo(1.5, 9), p.from, p.to, 60, `perf:peak:campaign:meta:dog:roas:${p.from}`,
        `ROAS 3.00 vs 1.50 for the store's other Meta campaigns, ${p.from} to ${p.to}: +100% (95% range +40% to +186%), on 60 purchases.`,
      ]),
    );
    // Each side of the pair is a lesson; same click-through rates are inside the noise: read, nothing to learn.
    expect(lessons().map(brief)).toEqual([
      [BROAD_DOWN, 'validated', 'measured measured'],
      [DOG_UP, 'validated', 'measured measured'],
    ]);
    expect(observations()).toBe(8);

    learnFromPerformance(db, today);
    expect(observations()).toBe(8);
    expect(listEvidence(db, up.id)).toHaveLength(2);
  });

  test('a measured reading the other way is evidence against the lesson: it moves down, a conflict opens, and the other way is a lesson of its own', () => {
    real();
    campaign('dog', 'Dog car', DOG, P[1]);
    campaign('broad', 'Broad', BROAD, P[1]);
    campaign('dog', 'Dog car', BROAD, P[2]);
    campaign('broad', 'Broad', DOG, P[2]);
    learnFromPerformance(db, today);
    expect(lessons().map(brief)).toEqual([
      [`The "Broad" campaign (Meta): ROAS above the store's other Meta campaigns`, 'tested', 'measured'],
      [BROAD_DOWN, 'hypothesis', 'measured conflict'],
      [DOG_UP, 'hypothesis', 'measured conflict'],
      [`The "Dog car" campaign (Meta): ROAS below the store's other Meta campaigns`, 'tested', 'measured'],
    ]);
    expect(db.prepare(`SELECT count(*) AS n FROM kb_conflicts WHERE store_id = 'peak' AND card_id = ? AND status = 'open'`).get(lesson(DOG_UP).id)?.n).toBe(1);
  });

  test("a reading the other way that isn't conclusive leaves the lesson as it was", () => {
    real();
    campaign('dog', 'Dog car', DOG, P[1]);
    campaign('broad', 'Broad', BROAD, P[1]);
    campaign('dog', 'Dog car', { ...BROAD, days: 20 }, P[2]);
    campaign('broad', 'Broad', DOG, P[2]);
    learnFromPerformance(db, today);
    expect(lessons().map(brief).filter(([t]) => t!.includes('Dog car'))).toEqual([
      [DOG_UP, 'tested', 'measured'],
      [`The "Dog car" campaign (Meta): ROAS below the store's other Meta campaigns`, 'hypothesis', 'observed'],
    ]);
  });

  test("a lesson the owner archived takes no more evidence and isn't made again; one they wrote with its title takes it", () => {
    real();
    for (const p of [P[1], P[2]]) {
      campaign('dog', 'Dog car', DOG, p);
      campaign('broad', 'Broad', BROAD, p);
    }
    const owners = createCard(db, 'peak', { categoryId: ensureCategoryPath(db, 'peak', ['Ads']), title: BROAD_DOWN, summary: 'Seen in Ads Manager', type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
    learnFromPerformance(db, '2026-09-29'); // P[1] is the newest settled period then
    updateCard(db, lesson(DOG_UP).id, { status: 'archived' }, 'owner');
    learnFromPerformance(db, today);
    expect(lessons().map(brief)).toEqual([[DOG_UP, 'tested', 'measured']]);
    expect(listEvidence(db, owners.id).map((e) => e.kind)).toEqual(['measured', 'measured']);
  });

  test('a new lesson is offered links to related cards', () => {
    real();
    const related = createCard(db, 'peak', {
      categoryId: ensureCategoryPath(db, 'peak', ['Advertising', 'Campaign results']), title: 'Dog car campaign ROAS on Meta', summary: 'The Dog car campaign on Meta brings the best ROAS',
      type: 'strategy', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner',
    });
    campaign('dog', 'Dog car', DOG);
    campaign('broad', 'Broad', BROAD);
    learnFromPerformance(db, today);
    expect(db.prepare(`SELECT status FROM kb_links WHERE from_id = ? AND to_id = ?`).all(lesson(DOG_UP).id, related.id)).toEqual([{ status: 'suggested' }]);
  });

  const guards: [string, () => void, (string | undefined)[][]][] = [
    ['a demo store: nothing from demo numbers', () => {}, []],
    ['attribution still settling: last synced 30 days after the period', () => real(`2026-10-06T12:00:00Z`), []],
    ['settled: synced 31 days after', () => real(`2026-10-07T12:00:00Z`), [[BROAD_DOWN, 'tested', 'measured'], [DOG_UP, 'tested', 'measured']]],
    ['9 purchases, here or in the baseline', () => (real(), campaign('dog', 'Dog car', { ...DOG, revenue: 16_800, purchases: 9 })), []],
    ['6 days', () => (real(), campaign('dog', 'Dog car', { ...DOG, days: 6 })), []],
    ['too few impressions for click-through rate', () => (real(), campaign('dog', 'Dog car', { ...BROAD, clicks: 30, impressions: 900 })), []],
    // 250 of 5,850 spent: left out, and out of the others' baselines too.
    ['4% of the ad spend', () => (real(), campaign('tiny', 'Tiny', { spend: 250, revenue: 1250, purchases: 12 })), [[BROAD_DOWN, 'tested', 'measured'], [DOG_UP, 'tested', 'measured']]],
    ['inside the noise: ROAS 1.6 vs 1.5', () => (real(), campaign('dog', 'Dog car', { ...DOG, revenue: 4480 })), []],
    ['a campaign that ran 20 of 28 days: a Hypothesis', () => (real(), campaign('dog', 'Dog car', { ...DOG, days: 20 })), [[BROAD_DOWN, 'hypothesis', 'observed'], [DOG_UP, 'hypothesis', 'observed']]],
    ['a campaign changed during the period: a Hypothesis', () => {
      real();
      db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at, decided_at) VALUES ('b1', 'peak', 'peak:ad_strategist', 'Raise Dog car', 'r', ?, 'approved', ?2, ?2)`)
        .run(JSON.stringify({ kind: 'ads.set_budget', payload: { network: 'meta', campaignId: 'dog', from: 50, to: 80 } }), '2026-08-20T15:00:00Z');
    }, [[BROAD_DOWN, 'hypothesis', 'observed'], [DOG_UP, 'hypothesis', 'observed']]],
    // With them in, Dog car's 3.00 would be inside the noise against 2.25.
    ['campaigns on other networks are left out when its own has some', () => (real(), campaign('ugc', 'UGC', DOG, P[2], 'tiktok')), [[BROAD_DOWN, 'tested', 'measured'], [DOG_UP, 'tested', 'measured']]],
    ['no other campaign on its network: compared across networks, a Hypothesis', () => (real(), campaign('broad', 'Broad', BROAD, P[2], 'tiktok')), [
      [`The "Broad" campaign (TikTok): ROAS below the store's campaigns on other networks`, 'hypothesis', 'observed'],
      [`The "Dog car" campaign (Meta): ROAS above the store's campaigns on other networks`, 'hypothesis', 'observed'],
    ]],
  ];
  test.each(guards)('guard: %s', (_, setup, expected) => {
    setup();
    const missing = (id: string) => !db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(id);
    if (missing('dog')) campaign('dog', 'Dog car', DOG);
    if (missing('broad')) campaign('broad', 'Broad', BROAD);
    learnFromPerformance(db, today);
    expect(lessons().map(brief)).toEqual(expected);
  });

  test('confounds are named on the evidence', () => {
    real();
    campaign('dog', 'Dog car', { ...DOG, days: 20 });
    campaign('broad', 'Broad', BROAD, P[2], 'tiktok');
    learnFromPerformance(db, today);
    expect(listEvidence(db, lessons()[1]!.id)[0]!.text).toBe(
      `ROAS 3.00 vs 1.50 for the store's campaigns on other networks, ${P[2].from} to ${P[2].to}: +100% (95% range +40% to +186%), on 60 purchases. ` +
        `Not conclusive: "Dog car" ran 20 of 28 days; networks count purchases their own way.`,
    );
  });

  test("the store's conversion rate, order value and refund rate against its own 12 weeks before are Hypotheses: season and promotions move them too", () => {
    real();
    const order = db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('peak', ?, ?, ?, ?, 'fulfilled', ?)`);
    let n = 0;
    for (let d = addDays(P[2].from, -84), i = 0; d <= P[2].to; d = addDays(d, 1), i++) {
      const now = d >= P[2].from;
      // 1,000 sessions a day; 20 orders a day before, 40 in the period.
      db.prepare(`INSERT INTO daily_metrics (store_id, date, revenue, orders, sessions) VALUES ('peak', ?, 1000, ?, 1000)`).run(d, now ? 40 : 20);
      // Paid orders of 25/35 before (30 on average), 45/55 in the period; refunds 1 a week before, 1 a day in the period.
      for (const total of now ? [45, 55] : [i % 2 ? 35 : 25]) order.run(`#${++n}`, `${d}T12:00:00Z`, total, 'paid', d);
      if (now || i % 7 === 0) order.run(`#${++n}`, `${d}T13:00:00Z`, 30, 'refunded', d);
    }
    learnFromPerformance(db, today);
    expect(lessons().map((c) => [...brief(c), c.path.join(' › ')])).toEqual([
      ['The store: average order value above its 12 weeks before', 'hypothesis', 'observed', 'Conversion › Store results'],
      ['The store: conversion rate above its 12 weeks before', 'hypothesis', 'observed', 'Conversion › Store results'],
      ['The store: refund rate above its 12 weeks before', 'hypothesis', 'observed', 'Operations › Returns'],
    ]);
    expect(lesson('The store: conversion rate above its 12 weeks before').summary).toBe(
      `Conversion rate 4.00% vs 2.00% for its 12 weeks before, ${P[2].from} to ${P[2].to}: +100% (95% range +85% to +116%), on 1,120 orders. ` +
        'Not conclusive: season, promotions and ad changes differ from its weeks before.',
    );
    expect(listEvidence(db, lesson('The store: average order value above its 12 weeks before').id)[0]).toMatchObject({ value: 50, baseline: 30, sampleSize: 56 });
  });

  test('store readings need 30 orders, and 10 refunds, on each side', () => {
    real();
    const order = db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('peak', ?, ?, ?, ?, 'fulfilled', ?)`);
    let n = 0;
    for (let i = 0; i < 28; i++) {
      const d = addDays(P[2].from, i);
      db.prepare(`INSERT INTO daily_metrics (store_id, date, revenue, orders, sessions) VALUES ('peak', ?, 1000, 40, 1000)`).run(d);
      for (const total of [45, 55]) order.run(`#${++n}`, `${d}T12:00:00Z`, total, 'paid', d);
      for (let r = 0; r < 3; r++) order.run(`#${++n}`, `${d}T13:00:00Z`, 30, 'refunded', d);
    }
    // Before: 2 days of 10 orders on 1,000 sessions; 29 paid orders of 25/35 and 9 refunds.
    for (const d of [addDays(P[2].from, -2), addDays(P[2].from, -1)]) db.prepare(`INSERT INTO daily_metrics (store_id, date, revenue, orders, sessions) VALUES ('peak', ?, 300, 10, 1000)`).run(d);
    for (let i = 0; i < 29; i++) order.run(`#${++n}`, `${addDays(P[2].from, -1)}T12:00:00Z`, i % 2 ? 35 : 25, 'paid', addDays(P[2].from, -1));
    for (let i = 0; i < 9; i++) order.run(`#${++n}`, `${addDays(P[2].from, -1)}T13:00:00Z`, 30, 'refunded', addDays(P[2].from, -1));
    learnFromPerformance(db, today);
    expect(lessons()).toEqual([]);
  });

  describe('products', () => {
    /** Paid orders of one unit at 10 each over the period: `units` of the Calming bed, `rest` of each of two other products. */
    function sales(period: { from: string }, units: number, rest = 100) {
      const order = db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('peak', ?, ?, 10, 'paid', 'fulfilled', ?)`);
      const item = db.prepare(`INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('peak', ?, ?, 1, 10, 4)`);
      for (const [id, n] of [['calm', units], ['leash', rest], ['mat', rest]] as const)
        for (let i = 0; i < n; i++) {
          const o = `${id}-${period.from}-${i}`;
          const d = addDays(period.from, i % 28);
          order.run(o, `${d}T12:00:00Z`, d);
          item.run(o, id);
        }
    }
    beforeEach(() => {
      real();
      db.prepare(`INSERT INTO products (store_id, id, title, price) VALUES ('peak', 'calm', 'Calming bed', 10), ('peak', 'leash', 'Leash', 10), ('peak', 'mat', 'Mat', 10)`).run();
    });
    const CALM = `"Calming bed": unit sales above its 4 weeks before, adjusted for the store's trend`;

    test("a product selling more than its weeks before, as the rest of the store moved, is a lesson; 10 units a side", () => {
      sales(P[0], 5);
      sales(P[1], 20);
      sales(P[2], 40);
      learnFromPerformance(db, today);
      expect(lessons().map(brief)).toEqual([[CALM, 'tested', 'measured']]);
      expect(lessons()[0]).toMatchObject({ path: ['Products', 'Sales results'] });
    });

    test('season: the rest of the store doubled too, so it kept pace and there is nothing to learn', () => {
      sales(P[1], 20, 100);
      sales(P[2], 40, 200);
      learnFromPerformance(db, today);
      expect(lessons()).toEqual([]);
    });

    test("with no other sales on a side, the store's trend is unknown: no adjustment", () => {
      sales(P[1], 20);
      sales(P[2], 20, 0);
      learnFromPerformance(db, today);
      expect(lessons()).toEqual([]);
    });

    test('a price change in those weeks makes it a Hypothesis; a product new in them is left out', () => {
      sales(P[1], 20);
      sales(P[2], 40);
      db.prepare(`INSERT INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES ('p1', 'peak', 'calm', 'peak:operations', 't', 12, 10, ?)`).run(addDays(P[2].from, 3));
      learnFromPerformance(db, today);
      expect(lessons().map(brief)).toEqual([[CALM, 'hypothesis', 'observed']]);
      expect(listEvidence(db, lessons()[0]!.id)[0]!.text).toMatch(/Not conclusive: its price changed on 2026-08-13\.$/);

      db.prepare(`DELETE FROM kb_cards`).run();
      db.prepare(`DELETE FROM kb_observations`).run();
      db.prepare(`DELETE FROM done_once WHERE ref GLOB 'kb-perf:*'`).run();
      db.prepare(`INSERT INTO product_tests (store_id, product_id, approval_id, agent_id, title, added_on) VALUES ('peak', 'calm', 'a1', 'peak:product_hunter', 't', ?)`).run(addDays(P[1].from, 5));
      learnFromPerformance(db, today);
      expect(lessons()).toEqual([]);
    });
  });

  test("what each store learns from, and what isn't enabled", () => {
    const off = "Ad and creative results: only campaign totals sync, so no lesson is about one ad, hook or creative yet";
    expect(performanceStatus(db, 'peak')).toEqual({ storeId: 'peak', demo: true, on: [], off: [], lessons: 0 });
    real();
    campaign('dog', 'Dog car', DOG);
    campaign('broad', 'Broad', BROAD);
    learnFromPerformance(db, today);
    expect(performanceStatus(db, 'peak')).toEqual({
      storeId: 'peak',
      demo: false,
      on: ['Campaign results: ROAS and click-through rate'],
      off: ["Conversion rate: no sessions synced yet (GA4, or the platform's analytics)", 'Order value and refunds: no orders synced yet', 'Product sales: no order lines synced yet', off],
      lessons: 2,
    });
  });
});
