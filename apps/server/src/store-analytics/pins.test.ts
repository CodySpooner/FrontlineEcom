// SA-09 legacy pins: today's output of the legacy analytics (Dashboard's numbers) for the demo stores and the ledger
// fixture. A root fix that moves them shows up here as an explicit snapshot change, reviewed in the diff.
import { describe, expect, it } from 'vitest';
import { loadRows, platformSplit, summarize, topProducts } from '../analytics';
import { addDays } from '../dates';
import { openDb } from '../db';
import { DEMO_STORES, seedDemo } from '../demo';
import { LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';

const legacy = (db: ReturnType<typeof openDb>, storeId: string, to: string) => {
  const from = addDays(to, -6);
  return {
    summary: summarize(loadRows(db, [storeId], 7, to), { range: 7, to, storeIds: [storeId] }),
    platforms: platformSplit(db, [storeId], from, to),
    top: topProducts(db, [storeId], from, to, 5),
  };
};

describe('legacy pins', () => {
  it.each(DEMO_STORES.map((s) => s.id))('demo store %s', (id) => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    expect(legacy(db, id, '2026-10-25')).toMatchSnapshot();
  });

  it('ledger fixture store', () => {
    const db = openDb();
    seedLedgerStore(db);
    expect(legacy(db, LEDGER_STORE, LEDGER_PERIODS.P1.to)).toMatchSnapshot();
  });
});
