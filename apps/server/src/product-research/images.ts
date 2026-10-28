import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, type Db } from '../db';
import { kbFetch } from '../kb/fetch-instance';
import { sniffImage, type Fetched } from '../kb/fetcher';
import { log } from '../log';

// Decision 12's image cache: the page only ever loads `/api/pr/listings/:id/image`, which serves what this cache holds
// for the listing's stored image_ref. A miss queues one fetch through the app's shared fetcher (image mode: png, jpeg,
// webp or gif by their bytes, 5 MB), at most 30 a minute. The cache keeps 500 MB, least recently served out first.

const MAX_BYTES = 500 * 1_048_576;
const PER_MINUTE = 30;
const dir = () => join(dataDir(), 'pr-images');
const file = (ref: string) => join(dir(), createHash('sha256').update(ref).digest('hex'));

/** The cached image for a listing's image_ref, with its sniffed type, or null on a miss (or a file that isn't one). */
export function cachedImage(ref: string): { bytes: Buffer; type: string } | null {
  try {
    const bytes = readFileSync(file(ref));
    const type = sniffImage(bytes);
    if (!type) return null;
    const now = new Date();
    utimesSync(file(ref), now, now); // served: the newest in the LRU order
    return { bytes, type };
  } catch {
    return null;
  }
}

/** Least recently served out until the cache fits. ponytail: a directory scan per write; an index if it holds 10k+. */
function trim(max = MAX_BYTES) {
  const files = readdirSync(dir()).map((f) => ({ f, ...statSync(join(dir(), f)) }));
  let total = files.reduce((n, x) => n + x.size, 0);
  for (const x of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= max) break;
    rmSync(join(dir(), x.f), { force: true });
    total -= x.size;
  }
}

/** Fetches one image_ref into the cache. Only http(s); a failure is logged and the card keeps its neutral icon. */
export async function fetchImage(ref: string, get: (url: string, o: { image: boolean }) => Promise<Fetched> = kbFetch, max = MAX_BYTES) {
  if (!/^https?:\/\//i.test(ref)) return false;
  const r = await get(ref, { image: true });
  if (r.status !== 'read' || !r.bytes) {
    log('info', 'product research image not cached', { status: r.status, error: r.error });
    return false;
  }
  mkdirSync(dir(), { recursive: true });
  writeFileSync(file(ref), r.bytes);
  trim(max);
  return true;
}

const queue = new Set<string>();
let timer: ReturnType<typeof setInterval> | undefined;
let sent: number[] = [];

/** One fetch every 2 s while the queue has refs (30 a minute), then the timer stops. */
export function queueImage(ref: string, get?: Parameters<typeof fetchImage>[1]) {
  if (!/^https?:\/\//i.test(ref) || queue.size >= 500) return;
  queue.add(ref);
  timer ??= setInterval(() => {
    const now = Date.now();
    sent = sent.filter((t) => now - t < 60_000);
    const next = queue.values().next().value;
    if (next === undefined) return void (clearInterval(timer), (timer = undefined));
    if (sent.length >= PER_MINUTE) return;
    queue.delete(next);
    sent.push(now);
    void fetchImage(next, get).catch((e) => log('error', 'product research image fetch failed', { error: e instanceof Error ? e.message : String(e) }));
  }, 2000);
}

/** The listing's image_ref when the scope may see the listing (`store` null: All stores). */
export function listingImageRef(db: Db, listingId: string, store: string | null): string | null | undefined {
  const r = db.prepare(`SELECT image_ref, store_id, origin FROM pr_listings WHERE id = ?`).get(listingId);
  if (!r || r.origin === 'legacy_sample' || (store !== null && r.store_id != null && r.store_id !== store)) return undefined;
  return r.image_ref == null ? null : String(r.image_ref);
}

export const queuedImages = () => queue.size;
