import type { AutomationTrigger, MetricTotals } from '@frontline/shared';
import { money } from './format';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const METRICS: Record<keyof MetricTotals, { label: string; fmt: (v: number) => string }> = {
  revenue: { label: 'revenue', fmt: money },
  profit: { label: 'profit', fmt: money },
  adSpend: { label: 'ad spend', fmt: money },
  roas: { label: 'ROAS', fmt: (v) => `${v}x` },
  orders: { label: 'orders', fmt: String },
  aov: { label: 'AOV', fmt: money },
};

/** What the simple schedule editor can show. `time` is HH:MM, `weekday` 0 = Sunday (used when `every` is 'week'). */
export type Schedule = { every: 'day' | 'weekdays' | 'week'; time: string; weekday: number };

/** Reads "m h * * *", "m h * * 1-5" and "m h * * d"; anything else is a custom cron (null). */
export function parseCron(cron: string): Schedule | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(cron.trim());
  if (!m) return null;
  const [, min = '', hour = '', dow = ''] = m;
  if (+min > 59 || +hour > 23) return null;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dow === '*') return { every: 'day', time, weekday: 1 };
  if (dow === '1-5') return { every: 'weekdays', time, weekday: 1 };
  return { every: 'week', time, weekday: +dow };
}

export function toCron(s: Schedule) {
  const [h, m] = s.time.split(':').map(Number);
  return `${m} ${h} * * ${s.every === 'day' ? '*' : s.every === 'weekdays' ? '1-5' : s.weekday}`;
}

const clock = (time: string) => new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function describeTrigger(t: AutomationTrigger) {
  if (t.type === 'schedule') {
    const s = parseCron(t.cron);
    if (!s) return `Cron ${t.cron}`;
    const at = clock(s.time);
    return s.every === 'day' ? `Every day at ${at}` : s.every === 'weekdays' ? `Weekdays at ${at}` : `Every ${WEEKDAYS[s.weekday]} at ${at}`;
  }
  const m = METRICS[t.metric];
  return `When ${m.label} ${t.op === '<' ? 'drops below' : 'goes above'} ${m.fmt(t.value)} over ${t.windowDays} day${t.windowDays === 1 ? '' : 's'}`;
}

/** "Mon 9:00 AM": when a rule fires next or last. */
export const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** An action log entry's change, readable: { dailyBudget: 40, from: 32 } → "daily budget 40 · from 32". */
export const describeChange = (d: Record<string, unknown>) =>
  Object.entries(d)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()} ${v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
