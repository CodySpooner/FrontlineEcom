// Clock helpers the server and the agents share (settings decision 8): the machine's zone, a zone's calendar date, and
// when a day starts there. `apps/server/src/dates.ts` re-exports them.

/** The machine's IANA timezone: the workspace's until one is set (a fresh DB, a test, a backup restored before boot). */
export const machineZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Hours `timeZone` is ahead of UTC at `t`. */
export const utcOffset = (timeZone: string, t = Date.now()) =>
  (Date.parse(`${new Date(t).toLocaleString('sv-SE', { timeZone }).replace(' ', 'T')}Z`) - Math.floor(t / 1000) * 1000) / 3_600_000;

/** Today on the owner's machine (local timezone), or in IANA `timeZone`, YYYY-MM-DD. */
export const localDate = (now = new Date(), timeZone?: string) => now.toLocaleDateString('en-CA', { timeZone });

/** Epoch ms when `date` starts on the machine, or in IANA `timeZone`. */
export const midnight = (date: string, timeZone?: string) => {
  if (!timeZone) return new Date(`${date}T00:00:00`).getTime();
  const utc = Date.parse(`${date}T00:00:00Z`);
  const offset = (t: number) => Date.parse(`${new Date(t).toLocaleString('sv-SE', { timeZone }).replace(' ', 'T')}Z`) - t;
  const t = utc - offset(utc - offset(utc));
  // Where DST starts at midnight (Santiago, Havana) 00:00 doesn't exist: the day starts at the jump, 01:00.
  return localDate(new Date(t), timeZone) === date ? t : utc - offset(utc);
};

/** Epoch ms when the day `now` falls on began in `zone` (the machine's when absent): every "today" counter starts here. */
export const startOfDay = (zone: string | undefined, now = new Date()) => midnight(localDate(now, zone), zone);
