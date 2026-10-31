import { expect, test } from 'vitest';
import { advanceDemo, createDemo } from './demo';
import { emptyOffice } from './events';
import { hubReadout, orbitPoint } from './hub';

test('hub shows current-day API totals, currency, authoritative tasks and missing-rate caveats', () => {
  const now = new Date(2026, 9, 26, 12).getTime(), office = createDemo(now).state;
  office.analytics!.currency = 'EUR'; office.analytics!.unconverted = ['XYZ'];
  const result = hubReadout(office, 320, now);
  expect(result.revenue).toContain('€'); expect(result.orders).toBe('42'); expect(result.tasks).toBe('320'); expect(result.note).toContain('XYZ');
  expect(hubReadout(office, 0, now + 86400000)).toMatchObject({ revenue: '—', orders: '—', tasks: '0' });
  expect(hubReadout(emptyOffice(), undefined, now)).toMatchObject({ revenue: '—', orders: '—', tasks: '—' });
});
test('evening demo totals use the local calendar day and advance with simulated orders', () => {
  const now = new Date(2026, 9, 26, 23, 30).getTime(), office = createDemo(now).state;
  expect(office.analytics!.to).toBe('2026-10-26');
  expect(hubReadout(office, 0, now).orders).toBe('42');
  expect(hubReadout(advanceDemo(office, 0, now), 0, now).orders).toBe('43');
});
test('orbit stays in its ring and is static with motion disabled', () => {
  for (let t = 0; t < 30000; t += 173) {
    expect(orbitPoint(t, 1, true)).toEqual(orbitPoint(0, 1, true));
    const p = orbitPoint(t, 0, false);
    expect((p.x / 172) ** 2 + ((p.y + 92) / 43) ** 2).toBeCloseTo(1);
  }
});


test('seeded and mixed store metrics are explicitly marked without changing execution totals',()=>{
  const now=Date.now(),office=createDemo(now).state;
  expect(hubReadout(office,2,now)).toMatchObject({provenance:'DEMO METRICS',tasks:'2'});
  office.stores[0]!.connected=true;
  expect(hubReadout(office,2,now).provenance).toBe('INCLUDES DEMO');
  office.stores.forEach(s=>{s.connected=true;});
  expect(hubReadout(office,2,now).provenance).toBe('');
  expect(hubReadout(emptyOffice(),undefined,now).provenance).toBe('');
});
