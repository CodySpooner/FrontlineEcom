import { randomUUID } from 'node:crypto';
import { addEvidence, lift } from '@frontline/agents';
import { KB_TEST_METRICS, type KbCampaign, type KbExperiment, type KbStage, type KbTestMetric, type KbTestVariant, type NewKbExperiment } from '@frontline/shared';
import { addDays } from '../dates';
import { tx, type Db } from '../db';
import { storeDay, synced } from '../routes/agents-outcomes';

// Experiments and the Campaigns library (knowledge-base lane, KB-21). The owner plans a test of a card's claim on a
// store's ad numbers; once the window's attribution settles, the app reads it and writes the result on the card. The
// Campaigns section lists each campaign with what the synced data links to it.

/** Days a window's ad numbers keep changing: the syncs re-pull 28 (Meta) to 30 (Google) days. */
const SETTLE = 30;
const MIN_SAMPLE = 30;
type Totals = { spend: number; revenue: number; purchases: number; clicks: number; impressions: number };
const KEYS = ['spend', 'revenue', 'purchases', 'clicks', 'impressions'] as const;
const pct2 = (v: number) => `${(v * 100).toFixed(2)}%`;
const METRIC: Record<KbTestMetric, { label: string; unit: string; value: (t: Totals) => number; k: (t: Totals) => number; show: (v: number) => string }> = {
  roas: { label: 'ROAS', unit: 'purchases', value: (t) => t.revenue / t.spend, k: (t) => t.purchases, show: (v) => v.toFixed(2) },
  ctr: { label: 'click-through rate', unit: 'clicks', value: (t) => t.clicks / t.impressions, k: (t) => t.clicks, show: pct2 },
  cvr: { label: 'conversion rate', unit: 'purchases', value: (t) => t.purchases / t.clicks, k: (t) => t.purchases, show: pct2 },
};
const pct = (r: number) => `${r >= 1 ? '+' : '-'}${Math.round(Math.abs(r - 1) * 100)}%`;

// kb_experiments (KB-02): plan_json = {variants, from, to, minSample}, result_json = {text}.
const toExperiment = (r: Record<string, unknown>): KbExperiment => {
  const p = JSON.parse(String(r.plan_json)) as Pick<KbExperiment, 'variants' | 'from' | 'to' | 'minSample'>;
  return {
    id: String(r.id), cardId: String(r.card_id), storeId: String(r.store_id), metric: r.metric as KbTestMetric, ...p, status: r.status as KbExperiment['status'],
    ...(r.result_json ? { result: String(JSON.parse(String(r.result_json)).text) } : {}),
    due: addDays(p.to, SETTLE), createdAt: String(r.created_at),
  };
};

/** Newest first. */
export const listExperiments = (db: Db, q: { cardId?: string; storeId?: string; status?: KbExperiment['status'] }) =>
  db
    .prepare(
      `SELECT * FROM kb_experiments WHERE (?1 IS NULL OR card_id = ?1) AND (?2 IS NULL OR store_id = ?2) AND (?3 IS NULL OR status = ?3) ORDER BY created_at DESC, rowid DESC`,
    )
    .all(q.cardId ?? null, q.storeId ?? null, q.status ?? null)
    .map(toExperiment);

/** Checks a planned test against the store's synced campaigns and creatives; a string says what's wrong. */
export function parseExperiment(db: Db, storeId: string, b: Record<string, unknown>): string | NewKbExperiment {
  if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo) return "Tests read a store's real ad numbers: this is a demo store. Connect its ad account first.";
  if (typeof b.metric !== 'string' || !(b.metric in KB_TEST_METRICS)) return `metric must be one of ${Object.keys(KB_TEST_METRICS).join(', ')}`;
  const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (!isDate(b.from) || !isDate(b.to) || b.from > b.to) return 'from and to must be dates (YYYY-MM-DD), from first';
  if (b.to < storeDay(db, storeId)) return 'A test is planned before its window ends: pick an end date from today on';
  if (!Number.isInteger(b.minSample) || (b.minSample as number) < MIN_SAMPLE || (b.minSample as number) > 1_000_000) return `minSample must be a whole number from ${MIN_SAMPLE}`;
  if (!Array.isArray(b.variants) || b.variants.length !== 2) return 'variants must be [A, B]';
  const campaigns = new Set(db.prepare(`SELECT network || ':' || id AS k FROM campaigns WHERE store_id = ?`).all(storeId).map((r) => String(r.k)));
  const creatives = new Set(db.prepare('SELECT id FROM creatives WHERE store_id = ?').all(storeId).map((r) => String(r.id)));
  const variants: KbTestVariant[] = [];
  for (const v of b.variants as unknown[]) {
    const o = (v ?? {}) as Record<string, unknown>;
    const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');
    if (typeof o.label !== 'string' || !o.label.trim() || o.label.trim().length > 40) return 'each variant needs a label (up to 40 characters)';
    if (!strings(o.campaigns ?? []) || !strings(o.creatives ?? [])) return 'campaigns and creatives must be lists of ids';
    const [c, k] = [[...new Set(o.campaigns as string[] | undefined)], [...new Set(o.creatives as string[] | undefined)]];
    if (!c.length && !k.length) return `"${o.label.trim()}" needs a campaign or a creative`;
    if (c.some((x) => !campaigns.has(x))) return `campaigns must be this store's, as network:id`;
    if (k.some((x) => !creatives.has(x))) return "creatives must be this store's library creatives";
    variants.push({ label: o.label.trim(), campaigns: c, creatives: k });
  }
  const [a, z] = variants as [KbTestVariant, KbTestVariant];
  if (a.campaigns.some((x) => z.campaigns.includes(x)) || a.creatives.some((x) => z.creatives.includes(x))) return 'A campaign or creative can only be on one side';
  return { metric: b.metric as KbTestMetric, variants: [a, z], from: b.from, to: b.to, minSample: b.minSample as number };
}

export function planExperiment(db: Db, cardId: string, storeId: string, e: NewKbExperiment, now = new Date()): KbExperiment {
  const id = randomUUID();
  const plan = { variants: e.variants, from: e.from, to: e.to, minSample: e.minSample };
  db.prepare('INSERT INTO kb_experiments (id, card_id, store_id, metric, plan_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, cardId, storeId, e.metric, JSON.stringify(plan), now.toISOString());
  return listExperiments(db, { cardId }).find((x) => x.id === id)!;
}

/** A side's totals over the window: its campaigns, plus its creatives' ads outside them (never counted twice). */
function totals(db: Db, storeId: string, v: KbTestVariant, from: string, to: string): Totals {
  const cols = KEYS.map((k) => `coalesce(sum(d.${k}), 0) AS ${k}`).join(', ');
  const camps = JSON.stringify(v.campaigns);
  const a = db
    .prepare(
      `SELECT ${cols} FROM campaign_daily d JOIN campaigns c ON c.network = d.network AND c.id = d.campaign_id
       WHERE c.store_id = ? AND c.network || ':' || c.id IN (SELECT value FROM json_each(?)) AND d.date BETWEEN ? AND ?`,
    )
    .get(storeId, camps, from, to)!;
  const b = db
    .prepare(
      `SELECT ${cols} FROM ad_daily d JOIN ads a ON a.network = d.network AND a.id = d.ad_id JOIN campaigns c ON c.network = a.network AND c.id = a.campaign_id
       WHERE c.store_id = ? AND a.creative_id IN (SELECT value FROM json_each(?)) AND c.network || ':' || c.id NOT IN (SELECT value FROM json_each(?))
         AND d.date BETWEEN ? AND ?`,
    )
    .get(storeId, JSON.stringify(v.creatives), camps, from, to)!;
  return Object.fromEntries(KEYS.map((k) => [k, Number(a[k]) + Number(b[k])])) as Totals;
}

/** Benjamini-Hochberg at 10% for a complete comparison family; callers also retain their 95% gate. */
export function significanceCutoff(pValues: number[]) {
  const sorted = [...pValues].sort((a, b) => a - b);
  let cutoff = 0;
  for (let i = 0; i < sorted.length; i++) if (sorted[i]! <= 0.1 * (i + 1) / sorted.length) cutoff = sorted[i]!;
  return cutoff;
}

const KIND = { worked: 'measured', failed: 'conflict', inconclusive: 'observed' } as const;

/**
 * Reads each planned test whose window settled (every integration of the store synced 30+ days after it ended): B
 * against A. Each side needs its minimum sample; then a difference outside the noise worked (measured evidence, a test
 * on the ladder) or failed (conflict evidence: the card moves down and a conflict opens), else it's inconclusive
 * (observed). Demo stores wait: nothing is learned from demo numbers.
 */
export function evaluateExperiments(db: Db, now = new Date()) {
  const readings = listExperiments(db, { status: 'planned' })
    .filter((e) => !db.prepare('SELECT demo FROM stores WHERE id = ?').get(e.storeId)?.demo && synced(db, e.storeId, e.due))
    .map((e) => {
      const m = METRIC[e.metric];
      const [a, b] = e.variants.map((v) => totals(db, e.storeId, v, e.from, e.to)) as [Totals, Totals];
      const [va, vb, ka, kb] = [m.value(a), m.value(b), m.k(a), m.k(b)];
      return { e, m, va, vb, ka, kb, l: lift(vb, kb, va, ka), minSample: Math.max(MIN_SAMPLE, e.minSample), family: JSON.stringify([e.storeId, e.from, e.to]) };
    });
  const families = new Map<string, number[]>();
  for (const r of readings) {
    const values = families.get(r.family) ?? [];
    values.push(Math.min(r.ka, r.kb) >= r.minSample ? r.l.p : 1);
    families.set(r.family, values);
  }
  const cutoffs = new Map([...families].map(([family, values]) => [family, significanceCutoff(values)]));
  for (const { e, m, va, vb, ka, kb, l, minSample, family } of readings) {
    const [A, B] = e.variants.map((v) => `"${v.label}"`);
    const head = `Test of ${B} against ${A}, ${e.from} to ${e.to}: ${m.label} ${m.show(vb)} vs ${m.show(va)}`;
    let status: keyof typeof KIND = 'inconclusive';
    let text = `${head}. Inconclusive: each side needed ${minSample} ${m.unit}; ${A} had ${ka}, ${B} ${kb}.`;
    if (Math.min(ka, kb) >= minSample) {
      if (Math.abs(l.z) >= 1.96 && l.p <= cutoffs.get(family)!) status = vb > va ? 'worked' : 'failed'; // NaN (a side with no spend or clicks) stays inconclusive
      text =
        `${head}: ${pct(l.ratio)} (95% range ${pct(l.low)} to ${pct(l.high)}), on ${kb} and ${ka} ${m.unit}. ` +
        { worked: `${B} did better: it worked.`, failed: `${B} did worse: the claim failed here.`, inconclusive: 'Inside the noise or multiple-comparison threshold: inconclusive.' }[status];
    }
    tx(db, () => {
      const value = Number.isFinite(vb) ? vb : undefined;
      const baseline = Number.isFinite(va) ? va : undefined;
      addEvidence(db, e.cardId, { kind: KIND[status], text, metric: e.metric, value, baseline, windowFrom: e.from, windowTo: e.to, sampleSize: kb, testRef: `exp:${e.id}`, authorId: 'app' }, now);
      db.prepare('UPDATE kb_experiments SET status = ?, result_json = ?, evaluated_at = ? WHERE id = ?').run(status, JSON.stringify({ text }), now.toISOString(), e.id);
    });
  }
}

/** Each campaign of the store (or every store), with what the synced data links to it. Most recently run first. */
export function listCampaigns(db: Db, storeId: string | 'all'): KbCampaign[] {
  const all = storeId === 'all' ? null : storeId;
  const rows = db
    .prepare(
      `SELECT c.network, c.id, c.store_id, c.name, c.status, min(CASE WHEN d.spend > 0 THEN d.date END) AS first, max(CASE WHEN d.spend > 0 THEN d.date END) AS last,
         ${KEYS.map((k) => `coalesce(sum(d.${k}), 0) AS ${k}`).join(', ')}
       FROM campaigns c LEFT JOIN campaign_daily d ON d.network = c.network AND d.campaign_id = c.id
       WHERE ?1 IS NULL OR c.store_id = ?1 GROUP BY c.network, c.id ORDER BY last IS NULL, last DESC, c.name`,
    )
    .all(all);
  const key = (network: unknown, id: unknown) => `${network}:${id}`;
  const ads = new Map(
    db
      .prepare(`SELECT a.network, a.campaign_id, count(*) AS n, count(DISTINCT a.group_id) AS groups FROM ads a JOIN campaigns c ON c.network = a.network AND c.id = a.campaign_id WHERE ?1 IS NULL OR c.store_id = ?1 GROUP BY a.network, a.campaign_id`)
      .all(all)
      .map((r) => [key(r.network, r.campaign_id), { n: Number(r.n), groups: Number(r.groups) }]),
  );
  const creatives = new Map<string, KbCampaign['creatives']>();
  for (const r of db
    .prepare(
      `SELECT DISTINCT a.network, a.campaign_id, k.id, k.headline, k.primary_text, k.format, k.hook, k.angle, k.offer FROM ads a JOIN creatives k ON k.id = a.creative_id
       JOIN campaigns c ON c.network = a.network AND c.id = a.campaign_id WHERE ?1 IS NULL OR c.store_id = ?1`,
    )
    .all(all)) {
    const opt = (k: string) => (r[k] == null ? {} : { [k]: String(r[k]) });
    const list = creatives.get(key(r.network, r.campaign_id)) ?? [];
    list.push({ id: String(r.id), headline: String(r.headline), primaryText: String(r.primary_text), ...opt('format'), ...opt('hook'), ...opt('angle'), ...opt('offer') });
    creatives.set(key(r.network, r.campaign_id), list);
  }
  // Lessons read from the campaign or its ads, with the window each was measured over.
  const cards = new Map<string, Map<string, KbCampaign['cards'][number]>>();
  const card = (k: string, c: KbCampaign['cards'][number]) => {
    const m = cards.get(k) ?? new Map();
    if (!m.has(c.id) || m.get(c.id)!.to < c.to) m.set(c.id, c);
    cards.set(k, m);
  };
  for (const r of db
    .prepare(
      `SELECT o.subject, o.window_from, o.window_to, k.id, k.title, k.stage, a.campaign_id FROM kb_observations o JOIN kb_evidence e ON e.observation_id = o.id
       JOIN kb_cards k ON k.id = e.card_id LEFT JOIN ads a ON o.subject = 'ad:' || a.network || ':' || a.id
       WHERE (?1 IS NULL OR o.store_id = ?1) AND k.status IN ('active', 'proposed') AND (o.subject GLOB 'campaign:*' OR o.subject GLOB 'ad:*')`,
    )
    .all(all)) {
    const [kind, network, id] = String(r.subject).split(':');
    card(key(network, kind === 'ad' ? r.campaign_id : id), { id: String(r.id), title: String(r.title), stage: r.stage as KbStage, from: String(r.window_from), to: String(r.window_to) });
  }
  const tests = all ? listExperiments(db, { storeId: all }) : listExperiments(db, {});
  const titles = db.prepare(`SELECT title, stage, status FROM kb_cards WHERE id = ?`);
  return rows.map((r) => {
    const k = key(r.network, r.id);
    const own = creatives.get(k) ?? [];
    const experiments = tests.filter((e) => e.storeId === r.store_id && e.variants.some((v) => v.campaigns.includes(k) || v.creatives.some((c) => own.some((x) => x.id === c))));
    for (const e of experiments) {
      const t = titles.get(e.cardId);
      if (t && (t.status === 'active' || t.status === 'proposed')) card(k, { id: e.cardId, title: String(t.title), stage: t.stage as KbStage, from: e.from, to: e.to });
    }
    return {
      network: String(r.network), id: String(r.id), storeId: String(r.store_id), name: String(r.name), status: String(r.status),
      ...(r.first ? { from: String(r.first), to: String(r.last) } : {}),
      ...(Object.fromEntries(KEYS.map((x) => [x, Math.round(Number(r[x]) * 100) / 100])) as Totals),
      ads: ads.get(k)?.n ?? 0, groups: ads.get(k)?.groups ?? 0, creatives: own,
      experiments: experiments.map((e) => ({ id: e.id, cardId: e.cardId, status: e.status, from: e.from, to: e.to })),
      cards: [...(cards.get(k)?.values() ?? [])],
    };
  });
}
