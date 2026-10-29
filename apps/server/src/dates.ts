// Calendar dates are YYYY-MM-DD strings; math goes through UTC midnight so DST never shifts a day.
import { midnight } from '@frontline/shared';

const DAY = 86400000;

export const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// The machine's zone, a zone's date and its midnight live in packages/shared (settings decision 8), for the agents too.
export { localDate, machineZone, midnight, startOfDay, utcOffset } from '@frontline/shared';

/** Share of `date` (machine-local, or in `timeZone`) that has passed at `now`: 0 before it starts, 1 once it's over (DST days are 23 or 25 h). */
export const dayFraction = (date: string, now = Date.now(), timeZone?: string) => {
  const start = midnight(date, timeZone);
  return Math.min(1, Math.max(0, (now - start) / (midnight(addDays(date, 1), timeZone) - start)));
};
