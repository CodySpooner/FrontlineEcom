// Calendar dates are YYYY-MM-DD strings; math goes through UTC midnight so DST never shifts a day.
const DAY = 86400000;

export const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Today on the owner's machine (local timezone), YYYY-MM-DD. */
export const localDate = (now = new Date()) => now.toLocaleDateString('en-CA');

/** Share of local `date` that has passed at `now`: 0 before it starts, 1 once it's over (DST days are 23 or 25 h). */
export const dayFraction = (date: string, now = Date.now()) => {
  const start = new Date(`${date}T00:00:00`).getTime();
  return Math.min(1, Math.max(0, (now - start) / (new Date(`${addDays(date, 1)}T00:00:00`).getTime() - start)));
};
