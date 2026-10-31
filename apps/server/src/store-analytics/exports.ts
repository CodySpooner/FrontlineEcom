// SA-85 (decision 35): the one CSV engine. A same-origin GET; RFC 4180 quoting, UTF-8 with a BOM, CRLF lines; a `'`
// before any text cell a spreadsheet would run as a formula; a header block that makes the file readable outside the
// app; at most `EXPORT_CAP` rows, the cap stated.
import { SA_DATASET_STATUSES, SA_DATASETS, SA_FILTERS, SA_METRICS, SA_SOURCES, SA_STOCK_LABELS, saDef, type SaFilters, type SaFilterScope, type SaMetricId, type SaValue } from '@frontline/shared';
import type { Db } from '../db';
import { listings } from './listings';
import type { StorePeriod } from './period';
import type { RefundBasis } from './sales';
import { datasetFreshness } from './sources';

export const EXPORT_CAP = 50_000;

type Cell = string | number | null | undefined;

/** A cell: a number as it is, text defused (a leading = + - @, tab or CR gets a `'`) and quoted when it must be. */
export function cell(v: Cell): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const line = (cells: Cell[]) => cells.map(cell).join(',');

/** The file: the header block's label, value lines, a blank line, then the table. */
export const csv = (head: [string, Cell][], columns: string[], rows: Cell[][]) => `\uFEFF${[...head.map(line), '', line(columns), ...rows.map(line)].join('\r\n')}\r\n`;

/**
 * Decision 35's header block: store, period, zone, comparison, the filters applied and not (with reasons), currency
 * and its FX policy, each definition, each source's freshness, the demo line, when, and how many rows of how many.
 */
export function headBlock(db: Db, storeId: string, sp: StorePeriod, o: { scope: SaFilterScope; filters: SaFilters; also: string[]; metrics: SaMetricId[]; rows: number; total: number; now: Date }): [string, Cell][] {
  const s = db.prepare('SELECT name, currency, demo FROM stores WHERE id = ?').get(storeId)!;
  const { period: p, compare: c } = sp;
  const applied = [...o.scope.applied.map((k) => `${SA_FILTERS[k]}: ${o.filters[k]!.join(', ')}`), ...o.also];
  return [
    ['Store', `${s.name} (${storeId})`],
    ...(s.demo ? [['Demo data', "A demo store's generated numbers, not real sales"] as [string, Cell]] : []),
    ['Period', `${p.from} to ${p.to} (${p.days} days${p.partial ? ', today so far' : ''})`],
    ['Time zone', sp.zoneLabel],
    ['Comparison', !c ? 'None' : 'unavailable' in c ? c.unavailable : `${c.from} to ${c.to}`],
    ['Filters applied', applied.join('; ') || 'None'],
    ['Filters not applied', o.scope.ignored.map((x) => `${SA_FILTERS[x.key]}: ${x.reason}`).join('; ') || 'None'],
    ['Currency', `${s.currency}. ${SA_METRICS.net_sales.currency}`],
    ...o.metrics.map((id): [string, Cell] => [`Definition ${saDef(id)}`, `${SA_METRICS[id].label}: ${SA_METRICS[id].formula}`]),
    // never empty: an unconnected platform's datasets read "Awaiting connection"
    ...datasetFreshness(db, storeId, o.now.getTime()).map((f): [string, Cell] => [
      `Source ${SA_SOURCES[f.source].name} (${SA_DATASETS[f.dataset]})`,
      `${SA_DATASET_STATUSES[f.status]}${f.stale ? ', out of date' : ''}; last synced ${f.lastSuccess ?? 'never'}`,
    ]),
    ['Generated at', o.now.toISOString()],
    ['Rows', `${o.rows} of ${o.total}${o.total > o.rows ? ` (capped at ${EXPORT_CAP.toLocaleString('en-US')} rows)` : ''}`],
  ];
}

const val = (v: SaValue | undefined) => v?.value;
const TAB: Record<string, [label: string, words?: Record<string, string>]> = {
  status: ['Status'],
  q: ['Search'],
  stock: ['Stock', SA_STOCK_LABELS],
  sales: ['Sales', { any: 'Any', with: 'With sales', none: 'No sales' }],
  cost: ['Unit cost', { missing: 'Missing' }],
  sync: ['Sync', { failed: 'Failed' }],
};

/**
 * `GET /api/analytics/export/listings`: the Listings table's query, every matching row (to the cap), or with
 * `products=` only those (each one this store's, else 404).
 */
export function exportListings(db: Db, storeId: string, query: Record<string, string | undefined>, sp: StorePeriod, filters: SaFilters, basis: RefundBasis, now = new Date()): { csv: string; name: string } | { error: string; status: 400 | 404 } {
  const picked = query.products ? [...new Set(query.products.split(',').filter(Boolean))] : undefined;
  if (picked && Number(db.prepare('SELECT count(*) AS n FROM products WHERE store_id = ? AND id IN (SELECT value FROM json_each(?))').get(storeId, JSON.stringify(picked))!.n) !== picked.length)
    return { error: 'A selected product is not in this store', status: 404 };
  const f = picked ? { ...filters, product: picked } : filters;
  const l = listings(db, storeId, { ...query, page: '1' }, sp, f, basis, EXPORT_CAP);
  if (typeof l === 'string') return { error: l, status: 400 };
  const also = Object.entries(TAB).flatMap(([k, [label, words]]) => (query[k] ? [`${label}: ${words?.[query[k]!] ?? query[k]}`] : []));
  const before = !!sp.compare && !('unavailable' in sp.compare);
  const columns = ['Product ID', 'Title', 'Status', 'SKU', 'Variants', 'Variants out', 'Category', 'Collections', 'Channels', 'Price', 'Compare-at price', 'Stock', 'Stock state', 'Cover days', 'Units', 'Net sales', ...(before ? ['Comparison net sales'] : []), 'Refunds', 'Refund rate', 'Contribution before ads', 'Cost coverage', 'Last synced'];
  const rows = l.rows.map((r): Cell[] => [
    r.id, r.title, r.status, r.sku, r.variants, r.variantsOut, r.category, r.collections.join('; '),
    r.channels.map((c) => `${c.channel} (${c.status}${c.error ? `: ${c.error}` : ''})`).join('; '),
    r.price, r.compareAt, r.stock, SA_STOCK_LABELS[r.stockState], r.coverDays,
    val(r.units), val(r.netSales), ...(before ? [val(r.previousNetSales)] : []), val(r.refunds), val(r.refundRate), val(r.contribution), val(r.costCoverage), r.syncedAt,
  ]);
  const head = headBlock(db, storeId, sp, { scope: l.scope, filters: f, also: [...also, ...(picked ? [`Selection: ${picked.length} products`] : [])], metrics: ['units', 'net_sales', 'refunds', 'refund_rate', 'contribution_before_ads', 'cost_coverage'], rows: rows.length, total: l.total, now });
  return { csv: csv(head, columns, rows), name: `listings-${storeId.replace(/[^\w-]/g, '-')}-${sp.period.from}-${sp.period.to}.csv` };
}
