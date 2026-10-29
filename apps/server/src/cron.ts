// 5-field cron (minute hour day-of-month month day-of-week) on the workspace timezone's wall clock (settings decision 8),
// or the machine's when none is given.
// Supports *, n, a-b, lists (a,b), steps (*/n, a-b/n); day-of-week 0-7 (0 and 7 = Sunday).
// Like classic cron, when both day fields are restricted a day matches if EITHER matches.

const RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

export interface Cron {
  sets: Set<number>[];
  domAny: boolean;
  dowAny: boolean;
}

/** Parses a cron expression; throws with a readable message when invalid. */
export function parseCron(expr: string): Cron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('cron needs 5 fields: minute hour day month weekday');
  const sets = fields.map((f, i) => {
    const [lo, hi] = RANGES[i]!;
    const set = new Set<number>();
    for (const part of f.split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
      if (!m) throw new Error(`invalid cron field "${f}"`);
      const from = m[1] === '*' ? lo : Number(m[2]);
      const to = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : m[4] ? hi : from;
      const step = m[4] ? Number(m[4]) : 1;
      if (from < lo || to > hi || from > to || step < 1) throw new Error(`cron field "${f}" is out of range ${lo}-${hi}`);
      for (let v = from; v <= to; v += step) set.add(i === 4 && v === 7 ? 0 : v);
    }
    return set;
  });
  return { sets, domAny: fields[2] === '*', dowAny: fields[4] === '*' };
}

/** Minutes a zone is ahead of UTC at an instant. */
type Clock = (t: number) => number;
const MACHINE: Clock = (t) => -new Date(t).getTimezoneOffset();

/** The machine's clock, or an IANA zone's. ponytail: cached per UTC quarter hour, when every zone in use moves its offset. */
function clockOf(zone?: string): Clock {
  if (!zone) return MACHINE;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  const seen = new Map<number, number>();
  return (t) => {
    const q = Math.floor(t / 900_000) * 900_000;
    let off = seen.get(q);
    if (off === undefined) {
      const p = Object.fromEntries(f.formatToParts(q).map((x) => [x.type, Number(x.value)]));
      seen.set(q, (off = (Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - q) / 60_000));
    }
    return off;
  };
}

/** The wall-clock time at `t` on `k`, read with the UTC getters. */
const wall = (k: Clock, t: number) => new Date(t + k(t) * 60_000);

/** Whether `d` matches, on the wall clock of `zone` (the workspace timezone; the machine's when absent). */
export function cronMatches(c: Cron, d: Date, zone?: string) {
  const w = wall(clockOf(zone), d.getTime());
  return wallMatches(c, w, w.getUTCHours(), w.getUTCMinutes());
}

/** Wall day `w` at the wall-clock time h:m. */
function wallMatches(c: Cron, w: Date, h: number, m: number) {
  const [min, hour, dom, month, dow] = c.sets as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (!min.has(m) || !hour.has(h) || !month.has(w.getUTCMonth() + 1)) return false;
  const domOk = dom.has(w.getUTCDate());
  const dowOk = dow.has(w.getUTCDay());
  return c.domAny || c.dowAny ? domOk && dowOk : domOk || dowOk;
}

/** True when `t` is the first minute after clocks sprang forward and a wall-clock minute they skipped matches. */
function skippedMatch(c: Cron, k: Clock, t: number) {
  const gap = k(t) - k(t - 60_000); // minutes skipped
  const w = wall(k, t);
  const now = w.getUTCHours() * 60 + w.getUTCMinutes();
  // ponytail: a jump across midnight (a few zones change at 00:00) isn't looked back over.
  for (let back = 1; back <= gap && now - back >= 0; back++) {
    if (wallMatches(c, w, Math.floor((now - back) / 60), (now - back) % 60)) return true;
  }
  return false;
}

/**
 * True for a minute of the hour clocks fall back through, the second time round (its wall-clock time already happened
 * before the clocks went back).
 */
function repeated(k: Clock, t: number) {
  const back = k(t - 3 * 3_600_000) - k(t); // minutes
  if (back <= 0) return false;
  const [first, now] = [wall(k, t - back * 60_000), wall(k, t)];
  return first.getUTCHours() === now.getUTCHours() && first.getUTCMinutes() === now.getUTCMinutes();
}

/**
 * First matching minute strictly after `from`, looking ahead at most `days`, on the wall clock of `zone` (the machine's
 * when absent). Steps in real minutes: a local time in the hour clocks fall back through is ambiguous. Like classic
 * cron, a rule with fixed hours runs only the first time round, and one whose time clocks skip in spring (02:30) runs
 * once, late, as they jump (03:00).
 */
export function nextCronTime(c: Cron, from: Date, days = 8, zone?: string): Date | undefined {
  const k = clockOf(zone);
  let t = Math.floor(from.getTime() / 60_000) * 60_000;
  const anyHour = c.sets[1]!.size === 24;
  for (let i = 0; i < days * 1440; i++) {
    t += 60_000;
    const w = wall(k, t);
    if (wallMatches(c, w, w.getUTCHours(), w.getUTCMinutes()) ? anyHour || !repeated(k, t) : !anyHour && skippedMatch(c, k, t)) return new Date(t);
  }
}

/** True if any minute in (after, upTo] matches, on the wall clock of `zone`. */
export function cronDueBetween(c: Cron, after: Date, upTo: Date, zone?: string) {
  const next = nextCronTime(c, after, Math.ceil((upTo.getTime() - after.getTime()) / 86400000) + 1, zone);
  return !!next && next <= upTo;
}
