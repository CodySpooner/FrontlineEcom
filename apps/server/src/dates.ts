// Calendar dates are YYYY-MM-DD strings; math goes through UTC midnight so DST never shifts a day.
const DAY = 86400000;

export const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Today on the owner's machine (local timezone), YYYY-MM-DD. */
export const localDate = (now = new Date()) => now.toLocaleDateString('en-CA');
