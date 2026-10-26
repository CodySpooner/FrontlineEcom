// 5-field cron (minute hour day-of-month month day-of-week) in the machine's local time.
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

export function cronMatches(c: Cron, d: Date) {
  const [min, hour, dom, month, dow] = c.sets as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (!min.has(d.getMinutes()) || !hour.has(d.getHours()) || !month.has(d.getMonth() + 1)) return false;
  const domOk = dom.has(d.getDate());
  const dowOk = dow.has(d.getDay());
  return c.domAny || c.dowAny ? domOk && dowOk : domOk || dowOk;
}

/** First matching minute strictly after `from`, looking ahead at most `days`. */
export function nextCronTime(c: Cron, from: Date, days = 8): Date | undefined {
  const d = new Date(from);
  d.setSeconds(0, 0);
  for (let i = 0; i < days * 1440; i++) {
    d.setMinutes(d.getMinutes() + 1);
    if (cronMatches(c, d)) return new Date(d);
  }
}

/** True if any minute in (after, upTo] matches. */
export function cronDueBetween(c: Cron, after: Date, upTo: Date) {
  const next = nextCronTime(c, after, Math.ceil((upTo.getTime() - after.getTime()) / 86400000) + 1);
  return !!next && next <= upTo;
}
