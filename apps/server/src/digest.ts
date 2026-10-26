import { currentWindow, totalsOf } from './analytics';
import { addDays, localDate } from './dates';
import type { Db } from './db';
import { fxFor } from './fx';
import { getSettings, notify } from './settings';

/** Local hour the digest goes out (or the first check after it, if the app was off then). */
const HOUR = 8;

/**
 * One notification: yesterday across every store vs the day before (each store's own, in its day zone), and how many
 * approvals are waiting. Once a store is real, only real stores: demo stores' sample numbers would pass for real ones.
 */
export function sendDigest(db: Db, now = new Date()) {
  const real = db.prepare('SELECT id FROM stores WHERE demo = 0').all().map((r) => String(r.id));
  const ids = real.length ? real : db.prepare('SELECT id FROM stores').all().map((r) => String(r.id));
  if (!ids.length) return;
  const { to, rows } = currentWindow(db, ids, 7, now.getTime());
  const yesterday = addDays(to, -1);
  const day = (date: string) => totalsOf(rows.filter((r) => r.date === date));
  const [y, before] = [day(yesterday), day(addDays(yesterday, -1))];
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: fxFor(db, ids).currency, maximumFractionDigits: 0 }).format;
  const change = before.revenue ? ` (revenue ${y.revenue >= before.revenue ? '+' : ''}${Math.round((y.revenue / before.revenue - 1) * 100)}% vs the day before)` : '';
  const waiting = Number(db.prepare(`SELECT count(*) AS n FROM approvals WHERE status = 'pending' AND store_id IN (${ids.map(() => '?').join(',')})`).get(...ids)!.n);
  return notify(db, {
    kind: 'info',
    title: `Yesterday: ${money(y.revenue)} revenue, ${money(y.profit)} profit`,
    body: `${y.orders} orders${change}. ${waiting ? `${waiting} approval${waiting === 1 ? '' : 's'} waiting.` : 'No approvals waiting.'}`,
    link: '/',
  });
}

/** Sends the digest once a day from 8:00 local while Settings → Notifications → digest is on. Returns stop(). */
export function startDigestLoop(db: Db, everyMs = 10 * 60_000) {
  const check = () => {
    const now = new Date();
    const today = localDate(now);
    if (now.getHours() < HOUR || !getSettings(db).notifications.digest) return;
    const sent = db.prepare("SELECT value_json FROM settings WHERE key = 'digest_sent'").get();
    if (sent && JSON.parse(String(sent.value_json)) === today) return;
    db.prepare("INSERT INTO settings (key, value_json) VALUES ('digest_sent', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(today));
    sendDigest(db, now);
  };
  check();
  const timer = setInterval(check, everyMs);
  return () => clearInterval(timer);
}
