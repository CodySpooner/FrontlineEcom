import { PR_DEMAND_LABEL, type PrCard, type PrSourceState, type PrStoreProfile, type Store } from '@frontline/shared';
import { ago } from '../lib/format';

const digits = (currency: string) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
};

/** Minor units (cents, yen) as money: 752 USD → "$7.52". */
export const minorMoney = (minor: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 10 ** digits(currency));
/** Money typed by the owner ("15", "7.52") in minor units, or null when it isn't an amount. */
export const toMinor = (text: string, currency: string) => (/^\d+(\.\d{1,3})?$/.test(text.trim()) ? Math.round(Number(text) * 10 ** digits(currency)) : null);
export const fromMinor = (minor: number | null, currency: string) => (minor === null ? '' : String(minor / 10 ** digits(currency)));

const COUNTRY = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string) => {
  try {
    return COUNTRY.of(code) ?? code;
  } catch {
    return code;
  }
};
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const short = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const month = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(' ', ' ');

/** The muted line under the fulfillment status: "M / Grey · CJPacket Ordinary · qty 1 · 27 Oct", or its first reason. */
export function conditionsLine(c: PrCard): string | null {
  if (!c.fulfillment) return null;
  const k = c.conditions;
  if (c.fulfillment.status !== 'verified' && c.fulfillment.reasons[0]) return [c.fulfillment.reasons[0], k && short(k.checkedAt)].filter(Boolean).join(' · ');
  return k ? [k.variant, k.method, `qty ${k.quantity}`, short(k.checkedAt)].filter(Boolean).join(' · ') : null;
}

/** The demand class ("Seasonal, December peak") and its muted line ("Trends "dog paw cleaner" · US · Nov 2025–Oct 2026"). */
export function demandLines(c: PrCard): [string, string | null] {
  const d = c.demand;
  if (!d) return ['Not checked yet', null];
  const cls = d.cls === 'seasonal' && d.peakMonth ? `Seasonal, ${MONTH[d.peakMonth - 1]} peak` : PR_DEMAND_LABEL[d.cls];
  const src = d.platform === 'google_trends' ? `Trends${d.query ? ` "${d.query}"` : ''}` : d.platform === 'orders' ? 'Your orders' : d.platform;
  const period = d.periodStart && d.periodEnd ? `${month(d.periodStart)}–${month(d.periodEnd)}` : null;
  return [cls, [src, d.region, period, d.scope === 'query' ? 'query-level' : null].filter(Boolean).join(' · ')];
}

/** "<source> · <category>": a pasted link is "Your link · <host>", an agent find "Agent find · <host>". */
export const sourceLine = (c: PrCard) => [c.source.host ? `${c.source.label} · ${c.source.host}` : c.source.label, c.category ?? 'Category unknown'].join(' · ');

/** "Ranked for <store> · <niche> · <audience> · sells at <band> · prefers <…> · avoids <…>"; unknown parts say so. */
export function profileLine(store: Store, p: PrStoreProfile): string[] {
  const band = p.priceMin !== null || p.priceMax !== null ? `sells at ${[p.priceMin, p.priceMax].map((v) => (v === null ? '…' : minorMoney(v, p.priceCurrency))).join('–')}` : 'price band not set';
  const prefers = [p.warehouses.length ? `${p.warehouses.join(' or ')} warehouse` : null, p.maxDeliveryDays ? `≤ ${p.maxDeliveryDays} days` : null].filter(Boolean).join(' or ');
  const avoids = [...p.avoidCategories, ...p.avoidTerms];
  return [
    store.niche === 'other' ? (store.nicheDetail ?? 'Custom niche') : store.niche.charAt(0).toUpperCase() + store.niche.slice(1),
    p.audience ?? 'audience not set',
    band,
    prefers ? `prefers ${prefers}` : 'no warehouse or delivery preference',
    avoids.length ? `avoids ${avoids.join(', ')}` : 'avoids nothing yet',
  ];
}

type Tone = 'good' | 'warn' | 'bad' | 'muted';
const stateOf = (s: PrSourceState, now: number): [string, Tone] => {
  if (s.fixtures && s.access !== 'verified') return ['test fixtures (not connected)', 'muted'];
  if (s.status === 'stopped' || s.errorKind) return [`${s.status === 'stopped' ? 'stopped' : 'error'}: ${s.lastError ?? 'see Source health'}`, 'bad'];
  if (s.access === 'verified') return [s.lastSuccessAt ? `synced ${ago(s.lastSuccessAt, now)}` : 'connected, not synced yet', 'good'];
  if (s.access === 'authorized_import') return [s.products ? `imports, ${s.products} product${s.products === 1 ? '' : 's'}` : 'import a file to start', s.products ? 'good' : 'muted'];
  if (s.access === 'manual_only') return ['manual notes only', 'muted'];
  if (s.access === 'credentials_required') return ['not connected', 'warn'];
  if (s.access === 'approval_required') return ['access pending approval', 'warn'];
  return ['unsupported', 'muted'];
};
/** One source in the strip: its real state, never a placeholder. Tone: good (synced), warn (needs the owner), muted. */
export function sourceItem(s: PrSourceState, now = Date.now()): { text: string; state: string; tone: Tone } {
  const [state, tone] = stateOf(s, now);
  return { text: `${s.name} · ${state}`, state, tone };
}
