// Number/date formatting for KPIs, charts and feeds.
// ponytail: USD only; switch to Intl currency per store when a non-USD store shows up.

export const money = (n: number) => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');

export const cents = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Axis labels: $850, $4.5K, $1.2M */
export const shortMoney = (v: number) =>
  v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1000 ? `$${+(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`;

/** % change vs the previous period; 0 when there is no previous value to compare with. */
export const pctChange = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : 0);

export const signedPct = (d: number) => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '%';

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
