// Calendar dates are YYYY-MM-DD strings; math goes through UTC midnight so DST never shifts a day.
const DAY = 86400000;

export const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Today on the owner's machine (local timezone), or in IANA `timeZone`, YYYY-MM-DD. */
export const localDate = (now = new Date(), timeZone?: string) => now.toLocaleDateString('en-CA', { timeZone });

/** Epoch ms when `date` starts on the machine, or in IANA `timeZone`. */
export const midnight = (date: string, timeZone?: string) => {
  if (!timeZone) return new Date(`${date}T00:00:00`).getTime();
  const utc = Date.parse(`${date}T00:00:00Z`);
  const offset = (t: number) => Date.parse(`${new Date(t).toLocaleString('sv-SE', { timeZone }).replace(' ', 'T')}Z`) - t;
  return utc - offset(utc - offset(utc));
};

/** Share of `date` (machine-local, or in `timeZone`) that has passed at `now`: 0 before it starts, 1 once it's over (DST days are 23 or 25 h). */
export const dayFraction = (date: string, now = Date.now(), timeZone?: string) => {
  const start = midnight(date, timeZone);
  return Math.min(1, Math.max(0, (now - start) / (midnight(addDays(date, 1), timeZone) - start)));
};
