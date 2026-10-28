import { randomUUID } from 'node:crypto';
import type { PrDemandTab, PrFlag, PrHistoryRow, PrOffer, PrProductDetail, PrStage, Store } from '@frontline/shared';
import type { Db } from '../db';
import { listStores } from '../stores';
import { productVisible } from './catalog';
import { discover, privateDemand } from './discovery';
import { evaluate } from './evaluate';
import { offerRows, pointsOf } from './facts';
import { flagsFor } from './flags';
import { current, fulfillmentOf } from './fulfillment';
import { signalSet } from './trends';

// The detail panel (PR-12): the header and Overview in one call, each other tab in its own (progressive loading).

const str = (v: unknown) => (v == null ? null : String(v));

/** The panel's header and Overview, or undefined when the scope can't see the product. */
export function productDetail(db: Db, id: string, store: Store | null, shipTo: string | undefined, now = new Date()): PrProductDetail | { error: string } | undefined {
  const d = discover(db, { store, id, shipTo, view: 'all', sort: 'recent', filters: {}, strict: [], limit: 1 }, now);
  if ('error' in d) return d;
  const card = d.items[0];
  if (!card) return undefined;
  const l = db
    .prepare(`SELECT id, url FROM pr_listings WHERE product_id = ? AND origin != 'legacy_sample' ${store ? 'AND (store_id IS NULL OR store_id = ?)' : ''} ORDER BY store_id IS NOT NULL, first_seen_at LIMIT 1`)
    .get(id, ...(store ? [store.id] : []))!;
  const url = str(l.url);
  const e = store ? db.prepare('SELECT fit, fit_reasons_json, flags_json, flag_dismissals_json FROM pr_evaluations WHERE store_id = ? AND product_id = ?').get(store.id, id) : undefined;
  let flags: PrFlag[] | null = null;
  if (store && e?.flags_json != null) {
    const dismissed = JSON.parse(String(e.flag_dismissals_json ?? '{}')) as Record<string, unknown>;
    flags = (JSON.parse(String(e.flags_json)) as PrFlag[]).filter((f) => !dismissed[f.id]);
  } else if (!store && card.flags) flags = flagsFor({ title: card.title, category: card.category });
  const own = store ? privateDemand(db, store.id).has(id) : false;
  const has = { demand: card.demandSets > 0, offer: card.fulfillment?.status === 'verified', economics: false, report: false }; // economics PR-18, reports PR-17
  const count = Object.values(has).filter(Boolean).length;
  const estimates = db
    .prepare(`SELECT transform_json FROM pr_listings WHERE product_id = ? AND origin = 'agent_find' ${store ? 'AND (store_id IS NULL OR store_id = ?)' : 'AND store_id IS NULL'} ORDER BY first_seen_at LIMIT 1`)
    .get(id, ...(store ? [store.id] : []));
  const stores = store
    ? []
    : db
        .prepare(
          `SELECT s.id, s.name, coalesce(e.stage, 'discovered') AS stage FROM stores s LEFT JOIN pr_evaluations e ON e.store_id = s.id AND e.product_id = ?
           WHERE s.id IN (SELECT store_id FROM pr_stage_history WHERE product_id = ?) ORDER BY s.name`,
        )
        .all(id, id)
        .map((r) => ({ id: String(r.id), name: String(r.name), stage: String(r.stage) as PrStage }));
  return {
    card,
    currency: d.currency,
    shipTo: d.shipTo,
    sku: str(db.prepare('SELECT sku FROM pr_variants WHERE listing_id = ? AND sku IS NOT NULL ORDER BY rowid LIMIT 1').get(String(l.id))?.sku),
    url: url && /^https?:\/\//i.test(url) ? url : null,
    assessment: {
      fit: e?.fit ? { fit: card.fit!.fit, reasons: JSON.parse(String(e.fit_reasons_json ?? '[]')) as string[] } : null,
      demand: { level: own || card.demandSets >= 2 ? 'strong' : card.demandSets === 1 ? 'moderate' : 'none', sets: card.demandSets, ownOrders: own },
      flags,
      confidence: { level: count >= 3 ? 'high' : count === 2 ? 'medium' : 'low', count, has },
    },
    agentEstimates: estimates ? ((JSON.parse(String(estimates.transform_json ?? '{}')) as { estimates?: Record<string, unknown> }).estimates ?? null) : null,
    stores,
  };
}

/** The Demand tab: the sets that speak for the product, the store's own ones, suggested query-level sets, and notes. */
export function productDemand(db: Db, id: string, store: string | null): PrDemandTab {
  const own = store ? `OR (store_id = ? AND product_id = ? AND platform != 'tiktok_creative_center')` : '';
  const ids = db
    .prepare(
      `SELECT id FROM pr_signals WHERE (store_id IS NULL AND (product_id = ? OR id IN (SELECT signal_id FROM pr_signal_links WHERE product_id = ? AND confirmed_at IS NOT NULL))) ${own}
       ORDER BY retrieved_at DESC, id`,
    )
    .all(id, id, ...(store ? [store, id] : []))
    .map((r) => String(r.id));
  const suggested = db
    .prepare(`SELECT k.signal_id FROM pr_signal_links k JOIN pr_signals s ON s.id = k.signal_id WHERE k.product_id = ? AND k.confirmed_at IS NULL AND (s.store_id IS NULL ${store ? 'OR s.store_id = ?' : ''}) ORDER BY s.retrieved_at DESC`)
    .all(id, ...(store ? [store] : []))
    .map((r) => signalSet(db, String(r.signal_id), store)!);
  const notes = store
    ? db
        .prepare(`SELECT id, platform, note, url, retrieved_at FROM pr_signals WHERE store_id = ? AND product_id = ? AND platform = 'tiktok_creative_center' ORDER BY retrieved_at DESC`)
        .all(store, id)
        .map((r) => ({ id: String(r.id), platform: String(r.platform), note: String(r.note ?? ''), url: String(r.url ?? ''), observedAt: String(r.retrieved_at) }))
    : [];
  return { sets: ids.map((s) => ({ ...signalSet(db, s, store)!, series: pointsOf(db, s) })), suggested, notes };
}

/** The Suppliers tab: every current offer row (newest check per listing, variant, supplier and destination). */
export function productOffers(db: Db, id: string, store: string | null, now = new Date()): PrOffer[] {
  return current(offerRows(db, id, store))
    .sort((a, b) => (a.destination ?? '').localeCompare(b.destination ?? '') || a.supplier.localeCompare(b.supplier) || b.checkedAt.localeCompare(a.checkedAt))
    .map((o) => {
      const v = o.variantId ? db.prepare('SELECT sku, attributes_json FROM pr_variants WHERE id = ?').get(o.variantId) : undefined;
      const row = db.prepare('SELECT delivery_days_min, processing_days FROM pr_offers WHERE id = ?').get(o.id)!;
      // The row's own status: decision 8 on this row alone, for its destination and quantity (no conversion needed).
      const f = o.destination ? fulfillmentOf([o], o.destination, o.quantity, now, (m) => m) : { status: 'insufficient' as const, reasons: ['No destination on this quote'] };
      return {
        id: o.id,
        supplier: o.supplier,
        variant: v ? str((JSON.parse(String(v.attributes_json ?? '{}')) as { name?: string }).name) : null,
        sku: v ? str(v.sku) : null,
        destination: o.destination,
        quantity: o.quantity,
        method: o.method,
        unitCost: o.unitCost,
        shipCost: o.shipCost,
        currency: o.currency,
        deliveryMin: row.delivery_days_min == null ? null : Number(row.delivery_days_min),
        deliveryMax: o.deliveryMax,
        processingDays: row.processing_days == null ? null : Number(row.processing_days),
        moq: o.moq,
        shipsFrom: o.shipsFrom,
        stock: (o.stock ?? []).map((w) => ({ warehouse: w.countryCode ?? null, units: w.totalInventory ?? null })),
        provenance: o.provenance,
        checkedAt: o.checkedAt,
        status: f.status,
        reasons: f.reasons,
      };
    });
}

/** The History tab: the store's rows (store scope) or every store's (All stores), newest first. */
export const productHistory = (db: Db, id: string, store: string | null): PrHistoryRow[] =>
  db
    .prepare(`SELECT * FROM pr_stage_history WHERE product_id = ? ${store ? 'AND store_id = ?' : ''} ORDER BY at DESC, rowid DESC LIMIT 200`)
    .all(id, ...(store ? [store] : []))
    .map((r) => ({ id: String(r.id), storeId: String(r.store_id), kind: String(r.kind), from: str(r.from_stage), to: str(r.to_stage), reason: str(r.reason), by: String(r.by), at: String(r.at) }));

/** Decision 5's "Assign to a store…": the product enters that store's pipeline at Discovered, recorded in History. */
export function assign(db: Db, id: string, storeId: string, now = new Date()): { error: string; status: 404 | 409 } | null {
  const store = listStores(db).find((s) => s.id === storeId);
  if (!store || !productVisible(db, id, store.id)) return { error: 'That store cannot see this product.', status: 404 };
  if (db.prepare('SELECT 1 FROM pr_stage_history WHERE store_id = ? AND product_id = ?').get(store.id, id)) return { error: `It is already in ${store.name}'s pipeline.`, status: 409 };
  evaluate(db, store, id, now);
  db.prepare(`INSERT INTO pr_stage_history (id, store_id, product_id, kind, from_stage, to_stage, reason, by, at) VALUES (?, ?, ?, 'stage', NULL, 'discovered', 'Assigned from All stores', 'owner', ?)`).run(
    randomUUID(),
    store.id,
    id,
    now.toISOString(),
  );
  return null;
}
