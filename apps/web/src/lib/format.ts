// Number/date formatting for KPIs, charts and feeds.
// Amounts are in a store's own currency, or Settings.baseCurrency across stores (the API says which); default USD.

const fmt = (currency: string, whole = false) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, ...(whole && { minimumFractionDigits: 0, maximumFractionDigits: 0 }) });

export const money = (n: number, currency = 'USD') => (n < 0 ? '−' : '') + fmt(currency, true).format(Math.round(Math.abs(n)));

export const cents = (n: number, currency = 'USD') => fmt(currency).format(n);

/** Dashboard KPI tiles: the full amount while it fits a 5-across tile ($6,526,927), else compact ($71.2M, MX$68M, ¥150M). */
export const fitMoney = (n: number, currency = 'USD') =>
  money(Math.abs(n), currency).length <= 10
    ? money(n, currency)
    : (n < 0 ? '−' : '') + new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumSignificantDigits: 3 }).format(Math.abs(n));

const symbol = (currency: string) => fmt(currency).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '';

/** Axis labels: $850, $4.5K, $1.2M, −$50 */
export const shortMoney = (v: number, currency = 'USD') => {
  const s = (v < 0 ? '−' : '') + symbol(currency);
  const a = Math.abs(v);
  return a >= 1e6 ? `${s}${+(a / 1e6).toFixed(1)}M` : a >= 1000 ? `${s}${+(a / 1000).toFixed(1)}K` : `${s}${Math.round(a)}`;
};

/** "41.6%" / "−5.3%" (a losing product's margin); anything that rounds to 0.0 reads "0.0%". */
export const pct = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return (r < 0 ? '−' : '') + Math.abs(r).toFixed(1) + '%';
};

/** "+18.4%" / "−8.1%"; anything that rounds to 0.0 reads "+0.0%", never "−0.0%". */
export const signedPct = (d: number) => {
  const r = Math.round(d * 10) / 10;
  return (r < 0 ? '−' : '+') + Math.abs(r).toFixed(1) + '%';
};

/** Nothing in the previous period to compare with (the API sends a 0% change then): show "New", not "+0.0%". */
export const noBaseline = (prev: number, now: number) => prev === 0 && now !== 0;

/** "2 min ago", "3 h ago", "4 d ago" */
export function ago(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
}

/** Parses YYYY-MM-DD as a local date (Date.parse would read it as UTC midnight). */
export const day = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d);
};

export const fmtDay = (ymd: string, long = false) =>
  day(ymd).toLocaleDateString('en-US', long ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });

/** "claude-opus-5-5" → "Opus 5.5" (a dated id drops its date); anything else as given. */
export function modelName(id: string) {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(id);
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : id;
}
