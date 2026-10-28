import type { PrAccess, PrErrorKind } from '@frontline/shared';
import type { Db } from '../../db';
import type { CallPurpose } from '../caps';

/** A failed source call, classified: auth, quota and schema stop the source; rate limits wait; the rest retry a little. */
export class SourceError extends Error {
  constructor(
    readonly kind: PrErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface PageCtx {
  db: Db;
  key: Buffer;
  query: string;
  page: number;
  purpose: CallPurpose;
}

/**
 * One source (decision 4): what it answers, what it gives, how often, its limits, and its access status. Discovery
 * sources page through raw items; the job runner validates, stores and checkpoints them.
 */
export interface PrAdapter<Item extends object = object> {
  id: string;
  name: string;
  answers: readonly ('discovery' | 'demand' | 'fulfillment')[];
  fields: readonly string[];
  /** How often scheduled ingestion refreshes it; absent: never scheduled. */
  refreshHours?: number;
  rate: string;
  quota: string;
  /** What the owner does to connect it (or why it can't be). */
  connect: string;
  /** From what is configured now. `verified` only once a real call with real credentials succeeded and was recorded. */
  access(db: Db, key: Buffer): PrAccess;
  /** Set up to be called (credentials entered, an import made); says nothing about whether a call has worked. */
  ready?(db: Db, key: Buffer): boolean;
  /** Discovery: one page of raw items. Throws SourceError. */
  page?(ctx: PageCtx): Promise<{ items: Item[]; more: boolean }>;
  /** Fields every raw item must carry: a missing one is a schema change and stops the source. */
  required?: readonly string[];
  /** Validate → Normalize → Match/Deduplicate → Store Evidence for one raw item; returns the product id. */
  ingest?(db: Db, item: Item, at: string): string;
  /** When the owner last saved this source's credentials: a source stopped on an auth failure tries again after that. */
  credentialsAt?(db: Db): string | undefined;
  /** Enrich: details, stock and offers for what discovery stored, within the source's caps. */
  enrich?(db: Db, key: Buffer): Promise<void>;
  /** The queries scheduled ingestion runs today (a store's niche categories and saved keywords). */
  plan?(db: Db): { storeId: string | null; queries: string[] }[];
  /** Before planning: refresh what `plan` reads (CJ's category tree). Throws SourceError; the plan then uses what it has. */
  prepare?(db: Db, key: Buffer, now: Date): Promise<void>;
}
