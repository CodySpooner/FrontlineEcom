import { createHash, randomUUID } from 'node:crypto';
import type { PrGranularity, PrSignalSet, PrSignalScope, PrSignalOrigin, PrTrendsImport } from '@frontline/shared';
import { tx, type Db } from '../db';
import { parseCsv } from './csv';
import { demandOf, rankDemand } from './facts';
import { visible } from './scope';

export interface TrendsSeries {
  term: string;
  region: string | null;
  points: { at: string; value: number; belowOne: boolean }[];
}
export interface TrendsFile {
  category: string | null;
  granularity: PrGranularity;
  series: TrendsSeries[];
}

const DATE = /^\d{4}-\d{2}(-\d{2})?$/;
const NAMED: Record<string, PrGranularity> = { day: 'day', week: 'week', month: 'month' };
const LABEL: Record<PrGranularity, string> = { day: 'daily', week: 'weekly', month: 'monthly' };
const NOT_TRENDS = `This isn't a Google Trends "Interest over time" export: it has no rows of dates. On trends.google.com, use the Download (CSV) button on the "Interest over time" chart.`;
const time = (d: string) => Date.parse(d.length === 7 ? `${d}-01` : d);

function spacing(dates: string[]): PrGranularity | null {
  const gaps = dates.slice(1).map((d, i) => (time(d) - time(dates[i]!)) / 86_400_000);
  if (!gaps.length) return dates[0]?.length === 7 ? 'month' : null;
  if (gaps.every((g) => g === 1)) return 'day';
  if (gaps.every((g) => g === 7)) return 'week';
  return gaps.every((g) => g >= 28 && g <= 31) ? 'month' : null;
}

/**
 * A Google Trends "Interest over time" CSV. Google doesn't document the layout (sources doc), so this finds the header
 * row (the one above the first date) instead of assuming a line, reads `<term>: (<region>)` headers, takes the
 * granularity from the dates' spacing and refuses a file whose first header cell names a different one. Values are
 * whole numbers 0–100 or "<1" (stored as 0 with below_one).
 */
export function parseTrendsCsv(text: string): TrendsFile | { error: string } {
  const rows = parseCsv(text).map((r) => r.map((c) => c.trim()));
  if (rows.some((r) => /^\d{4}-\d{2}-\d{2}T\d{2}/.test(r[0] ?? ''))) return { error: 'This export is hourly (a range of 7 days or less). Export 30 days or more for daily, weekly or monthly points.' };
  const first = rows.findIndex((r, i) => i > 0 && DATE.test(r[0] ?? ''));
  const header = rows[first - 1];
  if (first < 1 || !header || header.length < 2) return { error: NOT_TRENDS };
  const body: string[][] = [];
  for (let i = first; i < rows.length && DATE.test(rows[i]![0] ?? ''); i++) body.push(rows[i]!);
  const g = spacing(body.map((r) => r[0]!));
  if (!g) return { error: "The dates aren't evenly spaced by a day, a week or a month, so this isn't a whole Trends export." };
  const named = NAMED[header[0]!.toLowerCase()];
  if (named && named !== g) return { error: `The file says ${LABEL[named]} ("${header[0]}") but its dates are ${LABEL[g]}: it was edited or mislabelled. Download it again from trends.google.com.` };
  const series: TrendsSeries[] = header.slice(1).map((h) => {
    const m = /^(.*): \((.*)\)$/.exec(h);
    return { term: (m?.[1] ?? h).trim(), region: m?.[2]?.trim() || null, points: [] };
  });
  if (series.some((s) => !s.term)) return { error: 'A column has no search term in its header.' };
  for (const [i, r] of body.entries()) {
    const line = first + i + 1;
    if (r.length !== header.length) return { error: `Line ${line} has ${r.length} columns; the header has ${header.length}.` };
    for (const [j, s] of series.entries()) {
      const c = r[j + 1]!;
      if (c !== '<1' && !(/^\d{1,3}$/.test(c) && Number(c) <= 100)) return { error: `Line ${line}: "${c}" isn't a Trends value (a whole number 0–100, or <1).` };
      s.points.push({ at: r[0]!, value: c === '<1' ? 0 : Number(c), belowOne: c === '<1' });
    }
  }
  return { category: /^Category:\s*(.+)$/i.exec(rows[0]?.[0] ?? '')?.[1]?.trim() ?? null, granularity: g, series };
}

/** Products visible in the scope whose title has every word of the term (from a word's start): link suggestions. */
export function suggestProducts(db: Db, term: string, store: string | null): string[] {
  const words = term.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  if (!words.length) return [];
  const v = visible(store, 'l.store_id');
  const rows = db
    .prepare(
      `SELECT DISTINCT p.id, p.title FROM pr_products p JOIN pr_listings l ON l.product_id = p.id
       WHERE p.merged_into IS NULL AND l.origin != 'legacy_sample' AND ${v.sql} AND ${words.map(() => 'lower(p.title) LIKE ?').join(' AND ')}
       ORDER BY p.created_at DESC LIMIT 200`,
    )
    .all(...v.params, ...words.map((w) => `%${w}%`));
  const starts = words.map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w}`, 'u'));
  return rows.filter((r) => starts.every((re) => re.test(String(r.title).toLowerCase()))).slice(0, 20).map((r) => String(r.id));
}

/** One set as the API shows it, with only the links to products the scope may see. */
export function signalSet(db: Db, id: string, store: string | null): PrSignalSet | undefined {
  const r = db.prepare('SELECT s.*, (SELECT count(*) FROM pr_signal_points WHERE signal_id = s.id) AS n FROM pr_signals s WHERE id = ?').get(id);
  if (!r || (store !== null && r.store_id != null && r.store_id !== store)) return undefined; // another store's order history or note
  const d = demandOf(db, { id, granularity: r.granularity });
  const v = visible(store, 'l.store_id');
  const links = db
    .prepare(
      `SELECT k.product_id, p.title, k.confirmed_at FROM pr_signal_links k JOIN pr_products p ON p.id = k.product_id
       WHERE k.signal_id = ? AND EXISTS (SELECT 1 FROM pr_listings l WHERE l.product_id = p.id AND ${v.sql}) ORDER BY p.title`,
    )
    .all(id, ...v.params);
  const str = (x: unknown) => (x == null ? null : String(x));
  return {
    id,
    platform: String(r.platform),
    query: str(r.query),
    region: str(r.region),
    granularity: str(r.granularity) as PrGranularity | null,
    metric: String(r.metric),
    scope: String(r.scope) as PrSignalScope,
    origin: String(r.origin) as PrSignalOrigin,
    periodStart: str(r.period_start),
    periodEnd: str(r.period_end),
    retrievedAt: String(r.retrieved_at),
    points: Number(r.n),
    demandClass: d?.cls ?? null,
    peakMonth: d?.peakMonth ?? null,
    momentum: d?.momentum ?? null,
    links: links.map((l) => ({ productId: String(l.product_id), title: String(l.title), confirmed: l.confirmed_at != null })),
  };
}

const setsOfFile = (db: Db, fileId: string, store: string | null) =>
  db.prepare('SELECT id FROM pr_signals WHERE file_ref = ? ORDER BY rowid').all(fileId).map((r) => signalSet(db, String(r.id), store)!);

/**
 * Import one export: the file is kept as sent, each term becomes a set (origin `import`, metric `interest_over_time`).
 * From a product (`productId`) the sets are that product's; otherwise they are query-level, with suggested links the
 * owner confirms. The same file twice is one import.
 */
export function importTrends(db: Db, input: { name: string; csv: string; productId: string | null; store: string | null }, now = new Date()): PrTrendsImport | { error: string } {
  const parsed = parseTrendsCsv(input.csv);
  if ('error' in parsed) return parsed;
  const sha = createHash('sha256').update(input.csv).digest('hex');
  const old = db.prepare(`SELECT id FROM pr_files WHERE kind = 'trends' AND sha256 = ?`).get(sha);
  if (old) return { fileId: String(old.id), duplicate: true, category: parsed.category, sets: setsOfFile(db, String(old.id), input.store) };
  const fileId = randomUUID();
  const at = now.toISOString();
  tx(db, () => {
    db.prepare(`INSERT INTO pr_files (id, kind, name, sha256, body, created_at) VALUES (?, 'trends', ?, ?, ?, ?)`).run(fileId, input.name, sha, input.csv, at);
    const point = db.prepare('INSERT INTO pr_signal_points (signal_id, at, value, below_one) VALUES (?, ?, ?, ?)');
    const link = db.prepare('INSERT INTO pr_signal_links (signal_id, product_id, created_at) VALUES (?, ?, ?)');
    for (const s of parsed.series) {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO pr_signals (id, product_id, platform, query, region, period_start, period_end, granularity, metric, scope, origin, file_ref, retrieved_at)
         VALUES (?, ?, 'google_trends', ?, ?, ?, ?, ?, 'interest_over_time', ?, 'import', ?, ?)`,
      ).run(id, input.productId, s.term, s.region, s.points[0]!.at, s.points.at(-1)!.at, parsed.granularity, input.productId ? 'product' : 'query', fileId, at);
      for (const p of s.points) point.run(id, p.at, p.value, p.belowOne ? 1 : 0);
      if (!input.productId) for (const productId of suggestProducts(db, s.term, input.store)) link.run(id, productId, at);
    }
  });
  if (input.productId) rankDemand(db, input.productId, now);
  return { fileId, duplicate: false, category: parsed.category, sets: setsOfFile(db, fileId, input.store) };
}

/** The owner confirms a query-level set for a product (it then counts as demand evidence) or removes the link. */
export function linkSet(db: Db, signalId: string, productId: string, confirm: boolean, now = new Date()): string | null {
  const s = db.prepare('SELECT scope FROM pr_signals WHERE id = ?').get(signalId);
  if (!s) return 'signal set not found';
  if (s.scope !== 'query') return 'Only a query-level set is linked to products; a product-level set already belongs to one.';
  if (confirm)
    db.prepare(`INSERT INTO pr_signal_links (signal_id, product_id, confirmed_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (signal_id, product_id) DO UPDATE SET confirmed_at = excluded.confirmed_at`).run(signalId, productId, now.toISOString(), now.toISOString());
  else db.prepare('DELETE FROM pr_signal_links WHERE signal_id = ? AND product_id = ?').run(signalId, productId);
  rankDemand(db, productId, now);
  return null;
}
