import { describe, expect, it } from 'vitest';
import { describeTrigger, parseCron, toCron } from './automation';

describe('parseCron / toCron', () => {
  it('reads the crons the simple editor writes', () => {
    expect(parseCron('0 8 * * *')).toEqual({ every: 'day', time: '08:00', weekday: 1 });
    expect(parseCron('30 18 * * 1-5')).toEqual({ every: 'weekdays', time: '18:30', weekday: 1 });
    expect(parseCron('5 9 * * 0')).toEqual({ every: 'week', time: '09:05', weekday: 0 });
  });

  it('leaves anything else to the custom field', () => {
    for (const c of ['*/15 * * * *', '0 8 1 * *', '0 25 * * *', '0 8 * * 1,3', 'nonsense']) expect(parseCron(c)).toBeNull();
  });

  it('round-trips', () => {
    for (const c of ['0 8 * * *', '30 18 * * 1-5', '5 9 * * 6']) expect(toCron(parseCron(c)!)).toBe(c);
  });
});

describe('describeTrigger', () => {
  it('says schedules in words', () => {
    expect(describeTrigger({ type: 'schedule', cron: '30 8 * * *' })).toBe('Every day at 8:30 AM');
    expect(describeTrigger({ type: 'schedule', cron: '0 17 * * 1-5' })).toBe('Weekdays at 5:00 PM');
    expect(describeTrigger({ type: 'schedule', cron: '0 9 * * 1' })).toBe('Every Monday at 9:00 AM');
    expect(describeTrigger({ type: 'schedule', cron: '*/15 * * * *' })).toBe('Cron */15 * * * *');
  });

  it('says metric thresholds in words', () => {
    expect(describeTrigger({ type: 'metric', metric: 'roas', op: '<', value: 2, windowDays: 3 })).toBe('When ROAS drops below 2x over 3 days');
    expect(describeTrigger({ type: 'metric', metric: 'adSpend', op: '>', value: 500, windowDays: 1 })).toBe('When ad spend goes above $500 over 1 day');
  });
});
