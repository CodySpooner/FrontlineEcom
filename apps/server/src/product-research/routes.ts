import { Hono } from 'hono';
import { PR_MATCH_ACTIONS, type PrMatchAction } from '@frontline/shared';
import type { Db } from '../db';
import { publish, subscribe } from '../live';
import { log } from '../log';
import { runManager } from '../routes/agents';
import { runtimes } from '../routes/agents-runtimes';
import { productVisible } from './catalog';
import { deleteComparison, listComparisons, parseComparison, saveComparison } from './comparisons';
import { assign, productDemand, productDetail, productHistory, productOffers } from './detail';
import { discover, parseDiscovery } from './discovery';
import { parseOverrides, productEconomics, saveEconomics } from './economics';
import { changeStage, dismissFlag, saveNotes, watchProduct } from './edits';
import { evaluateStore, refreshProduct } from './evaluate';
import { addNote, linkStoreProduct, NOTE_PLATFORMS } from './evidence';
import { importFeed } from './feed';
import { decideMatch, productMatches, searchCjAlternatives } from './matching';
import { addWatch, checkWatch, listWatches, ownWatch, parsePrefs } from './alerts';
import { runDue, stoppedReason, syncNow } from './jobs';
import { cachedImage, listingImageRef, queueImage } from './images';
import { checkUrl, ownerDetails, preview } from './preview';
import { productOutcomes, saveOutcome } from './outcomes';
import { getBrief, linkExperiment, linkTeam, parseBrief, productLinks, requestDraftProduct, saveBrief, saveDecision, setOwner, specialistTeam } from './pipeline';
import { getProfile, saveProfile } from './profile';
import { productReports } from './reports';
import { setWatch } from './watches';
import { scopeOf, storeOf } from './scope';
import { ADAPTERS, sourceHealth, sourceStates } from './sources';
import { INSTRUCTIONS_MAX, agentRows, getTask, listTasks, retryTask, startTask, type TaskInput } from './tasks';
import { importTrends, linkSet, signalSet } from './trends';

/** Product Research's API (`/api/pr/*`, behind the KB guard: change and body limits). `?store=` sets the scope. */
export function prRoutes(db: Db, key: () => Buffer) {
  watchTasks(db);
  return new Hono()
    .get('/api/pr/sources', (c) => {
      const s = scopeOf(c, db);
      return s instanceof Response ? s : c.json(sourceStates(db, key(), s.store?.id ?? null));
    })
    .get('/api/pr/source-health', (c) => {
      const s = scopeOf(c, db);
      return s instanceof Response ? s : c.json(sourceHealth(db, key(), s.store?.id ?? null));
    })
    // Sync now: queues today's planned queries and runs them in the background, one job at a time, then enriches.
    .post('/api/pr/sources/:id/sync', async (c) => {
      const a = ADAPTERS.find((x) => x.id === c.req.param('id'));
      if (!a) return c.json({ error: 'unknown source' }, 404);
      const r = await syncNow(db, a, key());
      if ('error' in r) return c.json(r, 409);
      void (async () => {
        const deps = { key: key(), onStored: (ids: string[]) => new Set(ids).forEach((id) => refreshProduct(db, id)) };
        for (let i = 0; i < r.jobs; i++) await runDue(db, [a], deps);
        if (a.enrich && !stoppedReason(db, a)) await a.enrich(db, key());
      })().catch((e) => log('error', 'product research sync failed', { source: a.id, error: e instanceof Error ? e.message : String(e) }));
      return c.json(r, 202);
    })
    // Discovery (decision 14): the scope's full matching set filtered, sorted and counted in SQL, a page at a time.
    .get('/api/pr/products', (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const q = parseDiscovery(c.req.queries(), s.store);
      if ('error' in q) return c.json(q, 400);
      const r = discover(db, { ...q, store: s.store });
      return 'error' in r ? c.json(r, 400) : c.json(r);
    })
    // Decision 12: only the cache for the listing's stored image_ref, never a URL from the client. A miss is a 404 (the
    // card shows its icon) and queues one fetch.
    // The detail panel (PR-12): the header and Overview, then each tab on its own.
    .get('/api/pr/products/:id', (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const ship = c.req.query('shipTo')?.toUpperCase();
      if (ship !== undefined && !/^[A-Z]{2}$/.test(ship)) return c.json({ error: 'shipTo must be a two-letter country code' }, 400);
      const d = productDetail(db, c.req.param('id'), s.store, ship);
      return !d ? c.json({ error: 'product not found' }, 404) : 'error' in d ? c.json(d, 400) : c.json(d);
    })
    .get('/api/pr/products/:id/:tab{demand|offers|history}', (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const id = c.req.param('id');
      const store = s.store?.id ?? null;
      if (!productVisible(db, id, store)) return c.json({ error: 'product not found' }, 404);
      const tab = c.req.param('tab');
      return c.json(tab === 'demand' ? productDemand(db, id, store) : tab === 'offers' ? productOffers(db, id, store) : productHistory(db, id, store));
    })
    .post('/api/pr/products/:id/assign', async (c) => {
      const body = (await c.req.json().catch(() => undefined)) as { storeId?: unknown } | undefined;
      if (typeof body?.storeId !== 'string') return c.json({ error: 'storeId must be one of your stores' }, 400);
      const err = assign(db, c.req.param('id'), body.storeId);
      return err ? c.json({ error: err.error }, err.status) : c.json({ ok: true }, 201);
    })
    .get('/api/pr/listings/:id/image', (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const ref = listingImageRef(db, c.req.param('id'), s.store?.id ?? null);
      if (ref === undefined) return c.json({ error: 'listing not found' }, 404);
      const hit = ref ? cachedImage(ref) : null;
      if (!hit) {
        if (ref) queueImage(ref);
        return c.json({ error: 'no cached image' }, 404);
      }
      return c.body(new Uint8Array(hit.bytes), 200, { 'content-type': hit.type, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", 'cache-control': 'private, max-age=86400' });
    })
    .get('/api/pr/profile', (c) => {
      const store = storeOf(c, db);
      return store instanceof Response ? store : c.json(getProfile(db, store));
    })
    // Saving re-evaluates every product the store may see (re-ranked first when the ship-to moved), so fit is current.
    .put('/api/pr/profile', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      const body = (await c.req.json().catch(() => undefined)) as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'body must be a JSON object of profile fields' }, 400);
      const before = getProfile(db, store).shipTo;
      const p = saveProfile(db, store, body);
      if ('error' in p) return c.json(p, 400);
      evaluateStore(db, store, { rerank: p.shipTo !== before });
      return c.json(p);
    })
    .post('/api/pr/imports/trends', async (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const store = s.store?.id ?? null;
      const body = (await c.req.json().catch(() => undefined)) as { name?: unknown; csv?: unknown; productId?: unknown } | undefined;
      if (typeof body?.csv !== 'string' || !body.csv.trim()) return c.json({ error: "csv must be the export's text" }, 400);
      if (body.csv.length > 2_000_000) return c.json({ error: 'A Trends export is a few kilobytes; this file is over 2 MB.' }, 400);
      const productId = typeof body.productId === 'string' ? body.productId : null;
      if (body.productId !== undefined && !(productId && productVisible(db, productId, store))) return c.json({ error: 'product not found' }, 404);
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'multiTimeline.csv';
      const r = importTrends(db, { name, csv: body.csv, productId, store });
      return 'error' in r ? c.json(r, 400) : c.json(r, r.duplicate ? 200 : 201);
    })
    .post('/api/pr/signals/:id/links', async (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const store = s.store?.id ?? null;
      const body = (await c.req.json().catch(() => undefined)) as { productId?: unknown; confirmed?: unknown } | undefined;
      if (typeof body?.productId !== 'string' || typeof body.confirmed !== 'boolean') return c.json({ error: 'body must be { productId, confirmed: true | false }' }, 400);
      if (!signalSet(db, c.req.param('id'), store)) return c.json({ error: 'signal set not found' }, 404);
      if (!productVisible(db, body.productId, store)) return c.json({ error: 'product not found' }, 404);
      const err = linkSet(db, c.req.param('id'), body.productId, body.confirmed);
      return err ? c.json({ error: err }, 400) : c.json(signalSet(db, c.req.param('id'), store));
    })
    .post('/api/pr/imports/feed', async (c) => {
      const body = (await c.req.json().catch(() => undefined)) as { supplier?: unknown; name?: unknown; csv?: unknown } | undefined;
      if (typeof body?.csv !== 'string' || !body.csv.trim()) return c.json({ error: "csv must be the feed's text" }, 400);
      if (typeof body.supplier !== 'string' || !body.supplier.trim()) return c.json({ error: 'Name the supplier the feed is from.' }, 400);
      if (body.csv.length > 10_000_000) return c.json({ error: 'The feed is over 10 MB: split it into smaller files.' }, 400);
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'feed.csv';
      const r = importFeed(db, { supplier: body.supplier.trim().slice(0, 100), name, csv: body.csv });
      return 'error' in r ? c.json(r, 400) : c.json(r, r.duplicate ? 200 : 201);
    })
    .post('/api/pr/products/:id/notes', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { platform?: unknown; url?: unknown; note?: unknown; observedAt?: unknown } | undefined;
      if (!NOTE_PLATFORMS.includes(body?.platform as (typeof NOTE_PLATFORMS)[number])) return c.json({ error: `platform must be one of ${NOTE_PLATFORMS.join(', ')}` }, 400);
      if (typeof body!.url !== 'string' || !/^https?:\/\/\S+$/i.test(body!.url) || body!.url.length > 2048) return c.json({ error: 'url must be the http(s) link you looked at' }, 400);
      if (typeof body!.note !== 'string' || !body!.note.trim() || body!.note.length > 4000) return c.json({ error: 'note must say what you saw (up to 4,000 characters)' }, 400);
      const observed = body!.observedAt === undefined ? new Date() : new Date(String(body!.observedAt));
      if (!Number.isFinite(observed.getTime()) || observed.getTime() > Date.now() + 86_400_000) return c.json({ error: 'observedAt must be the date you looked' }, 400);
      const id = addNote(db, store.id, c.req.param('id'), { platform: String(body!.platform), url: body!.url, note: body!.note.trim(), observedAt: observed.toISOString() });
      return c.json({ id }, 201);
    })
    // A pasted link's preview (decision 12): read once through the shared safe fetcher, kept as the store's own listing.
    .post('/api/pr/preview', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      const body = (await c.req.json().catch(() => undefined)) as { url?: unknown } | undefined;
      const u = checkUrl(body?.url);
      if ('error' in u) return c.json({ error: u.error }, 400);
      return c.json(await preview(db, store, u));
    })
    // Research tasks (decision 6): the dialog's agent rows, then one request that inserts, composes, starts and links.
    .get('/api/pr/agents', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      return c.json(agentRows(db, store, await runtimes()));
    })
    .post('/api/pr/tasks', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      const input = taskInput(await c.req.json().catch(() => undefined));
      if ('error' in input) return c.json({ error: input.error, ...(input.field ? { field: input.field } : {}) }, 400);
      const r = startTask(db, runManager(db), store, input, await runtimes());
      if ('error' in r) return c.json({ error: r.error, ...(r.field ? { field: r.field } : {}) }, r.status);
      return c.json(r.status === 409 ? { ...r.task, error: `Not started: ${r.task.detail}` } : r.task, r.status); // Not started: the reason, as an error too
    })
    .get('/api/pr/tasks', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      return c.json(listTasks(db, store.id, c.req.query('product')));
    })
    .get('/api/pr/tasks/:id', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      const task = getTask(db, c.req.param('id'), store.id);
      return task ? c.json(task) : c.json({ error: 'Research task not found' }, 404);
    })
    // Unit economics (decision 13): the inputs with their provenance; the owner's figures per scenario.
    .get('/api/pr/products/:id/economics', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      return c.json(productEconomics(db, store, c.req.param('id')));
    })
    .put('/api/pr/products/:id/economics', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const o = parseOverrides(await c.req.json().catch(() => undefined));
      if ('error' in o) return c.json(o, 400);
      saveEconomics(db, store.id, c.req.param('id'), o);
      return c.json(productEconomics(db, store, c.req.param('id')));
    })
    // Supplier matching (PR-20): candidates with the rule's or the owner's verdict, the store's own products, CJ search.
    .get('/api/pr/products/:id/matches', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      return c.json(productMatches(db, key(), store, c.req.param('id')));
    })
    .post('/api/pr/products/:id/matches/search', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const r = await searchCjAlternatives(db, key(), store, c.req.param('id'));
      return 'error' in r && !r.calls ? c.json({ error: r.error }, 409) : c.json(r);
    })
    .post('/api/pr/products/:id/matches/:listing', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const action = ((await c.req.json().catch(() => undefined)) as { action?: unknown } | undefined)?.action as PrMatchAction;
      if (!PR_MATCH_ACTIONS.includes(action)) return c.json({ error: `action must be one of ${PR_MATCH_ACTIONS.join(', ')}` }, 400);
      const err = decideMatch(db, store, c.req.param('id'), c.req.param('listing'), action);
      return err ? c.json({ error: err.error }, err.status) : c.json(productMatches(db, key(), store, c.req.param('id')));
    })
    // The pipeline's owner fields (PR-22), store scope: who handles it, what it led to, the test brief, the draft handoff.
    .put('/api/pr/products/:id/owner', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { owner?: unknown } | undefined;
      if (typeof body?.owner !== 'string' || body.owner.length > 80) return c.json({ error: 'owner must be text (up to 80 characters)' }, 400);
      setOwner(db, store, c.req.param('id'), body.owner.trim());
      return c.json({ owner: body.owner.trim() || null });
    })
    .get('/api/pr/products/:id/links', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      return c.json(productLinks(db, store, c.req.param('id')));
    })
    .post('/api/pr/products/:id/links', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { kind?: unknown; refId?: unknown } | undefined;
      if ((body?.kind !== 'experiment' && body?.kind !== 'team') || typeof body.refId !== 'string') return c.json({ error: 'kind must be experiment or team, with refId' }, 400);
      const err = body.kind === 'team' ? linkTeam(db, store, c.req.param('id'), body.refId) : linkExperiment(db, store, c.req.param('id'), body.refId, true);
      return err ? c.json({ error: err.error }, err.status) : c.json(productLinks(db, store, c.req.param('id')), 201);
    })
    .delete('/api/pr/products/:id/links/:ref', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      const err = linkExperiment(db, store, c.req.param('id'), c.req.param('ref'), false);
      return err ? c.json({ error: err.error }, err.status) : c.json(productLinks(db, store, c.req.param('id')));
    })
    .get('/api/pr/products/:id/brief', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      return c.json(getBrief(db, store, c.req.param('id')));
    })
    .put('/api/pr/products/:id/brief', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const fields = parseBrief(await c.req.json().catch(() => undefined));
      return typeof fields === 'string' ? c.json({ error: fields }, 400) : c.json(saveBrief(db, store, c.req.param('id'), fields));
    })
    // PR-25: what happened after the research, and "Save outcome to Knowledge Base" for a measured period.
    .get('/api/pr/products/:id/outcomes', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      return c.json(productOutcomes(db, store, c.req.param('id')));
    })
    .post('/api/pr/products/:id/outcomes/:ref/knowledge', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const r = saveOutcome(db, store, c.req.param('id'), c.req.param('ref'));
      return 'error' in r ? c.json({ error: r.error }, r.status) : c.json({ cardId: r.cardId }, r.created ? 201 : 200);
    })
    // PR-24: "Ask a specialist": the team to start through POST /api/teams (the client links it back with POST …/links).
    .get('/api/pr/products/:id/specialist', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const ask = c.req.query('ask');
      if (ask !== 'positioning' && ask !== 'measurement') return c.json({ error: 'ask must be positioning or measurement' }, 400);
      return c.json(specialistTeam(db, store, c.req.param('id'), ask));
    })
    // PR-23: an owner's stage decision (a History row) saved as a card in the store's Knowledge Base.
    .post('/api/pr/products/:id/history/:hid/knowledge', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const r = saveDecision(db, store, c.req.param('id'), c.req.param('hid'));
      return 'error' in r ? c.json({ error: r.error }, r.status) : c.json({ cardId: r.cardId }, r.created ? 201 : 200);
    })
    .post('/api/pr/products/:id/draft-product', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const r = requestDraftProduct(db, store, c.req.param('id'));
      return 'error' in r ? c.json({ error: r.error }, r.status) : c.json(r.approval, r.created ? 201 : 200);
    })
    // Watchlists and alerts (PR-21): a store's list and the owner's all-stores list; each scope changes only its own.
    .get('/api/pr/watches', (c) => {
      const s = scopeOf(c, db);
      return s instanceof Response ? s : c.json(listWatches(db, s.store));
    })
    .post('/api/pr/watches', async (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const err = addWatch(db, s.store, await c.req.json().catch(() => undefined));
      return err ? c.json({ error: err }, 400) : c.json(listWatches(db, s.store), 201);
    })
    .put('/api/pr/watches/:id', async (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      if (!ownWatch(db, s.store, c.req.param('id'))) return c.json({ error: 'watch not found' }, 404);
      const prefs = parsePrefs(await c.req.json().catch(() => undefined));
      if (typeof prefs === 'string') return c.json({ error: prefs }, 400);
      db.prepare('UPDATE pr_watches SET prefs_json = ? WHERE id = ?').run(JSON.stringify(prefs), c.req.param('id'));
      return c.json(listWatches(db, s.store));
    })
    .delete('/api/pr/watches/:id', (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      const w = ownWatch(db, s.store, c.req.param('id')) && listWatches(db, s.store).find((x) => x.id === c.req.param('id'));
      if (!w) return c.json({ error: 'watch not found' }, 404);
      // A product (or its legacy listing) stops being watched the way its panel's Watch does it, with a History row.
      if ((w.kind === 'product' || w.kind === 'listing') && w.productId) watchProduct(db, s.store, w.productId, false);
      else setWatch(db, { storeId: s.store?.id ?? null, kind: w.kind, targetId: w.targetId, on: false });
      return c.json(listWatches(db, s.store));
    })
    // Check now: the scheduled check, run once on the owner's click (the same live cap applies).
    .post('/api/pr/watches/:id/check', async (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      if (!ownWatch(db, s.store, c.req.param('id'))) return c.json({ error: 'watch not found' }, 404);
      await checkWatch(db, key(), c.req.param('id'));
      return c.json(listWatches(db, s.store));
    })
    // Saved comparisons (PR-19), per store; the page reads each product's own figures again when one is opened.
    .get('/api/pr/comparisons', (c) => {
      const store = storeOf(c, db);
      return store instanceof Response ? store : c.json(listComparisons(db, store.id));
    })
    .post('/api/pr/comparisons', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      const i = parseComparison(db, store.id, await c.req.json().catch(() => undefined));
      return 'error' in i ? c.json(i, 400) : c.json(saveComparison(db, store, i), 201);
    })
    .put('/api/pr/comparisons/:id', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      const i = parseComparison(db, store.id, await c.req.json().catch(() => undefined));
      if ('error' in i) return c.json(i, 400);
      const saved = saveComparison(db, store, i, c.req.param('id'));
      return saved ? c.json(saved) : c.json({ error: 'comparison not found' }, 404);
    })
    .delete('/api/pr/comparisons/:id', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      return deleteComparison(db, store.id, c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'comparison not found' }, 404);
    })
    // Every report on the product in the store, newest first (decision 7).
    .get('/api/pr/products/:id/reports', (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      return c.json(productReports(db, store.id, c.req.param('id')));
    })
    .post('/api/pr/tasks/:id/retry', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      const r = retryTask(db, runManager(db), store, c.req.param('id'), await runtimes());
      return 'error' in r ? c.json({ error: r.error }, r.status) : c.json(r.status === 409 ? { ...r.task, error: `Not started: ${r.task.detail}` } : r.task, r.status);
    })
    .post('/api/pr/products/:id/stage', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { stage?: unknown; reason?: unknown } | undefined;
      const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
      const err = changeStage(db, store, c.req.param('id'), String(body?.stage ?? ''), reason);
      return err ? c.json({ error: err.error }, err.status) : c.json({ ok: true });
    })
    .put('/api/pr/products/:id/store-notes', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { notes?: unknown } | undefined;
      if (typeof body?.notes !== 'string' || body.notes.length > 4000) return c.json({ error: 'notes must be text (up to 4,000 characters)' }, 400);
      saveNotes(db, store, c.req.param('id'), body.notes.trim());
      return c.json({ ok: true });
    })
    .post('/api/pr/products/:id/flags/:flag/dismiss', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { reason?: unknown } | undefined;
      const err = dismissFlag(db, store, c.req.param('id'), c.req.param('flag'), typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '');
      return err ? c.json({ error: err.error }, err.status) : c.json({ ok: true });
    })
    // The watch toggle: a store's list, or the owner's all-stores list (the only private write in All stores).
    .put('/api/pr/products/:id/watch', async (c) => {
      const s = scopeOf(c, db);
      if (s instanceof Response) return s;
      if (!productVisible(db, c.req.param('id'), s.store?.id ?? null)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { on?: unknown } | undefined;
      if (typeof body?.on !== 'boolean') return c.json({ error: 'body must be { on: true | false }' }, 400);
      watchProduct(db, s.store, c.req.param('id'), body.on);
      return c.json({ watched: body.on });
    })
    .post('/api/pr/products/:id/store-products', async (c) => {
      const store = storeOf(c, db);
      if (store instanceof Response) return store;
      if (!productVisible(db, c.req.param('id'), store.id)) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { storeProductId?: unknown; same?: unknown } | undefined;
      if (typeof body?.storeProductId !== 'string') return c.json({ error: 'storeProductId must be one of the store’s products' }, 400);
      // PR-20: the owner rules out a possible "Already in your store" match; it isn't suggested again.
      if (body.same === false) {
        if (!db.prepare('SELECT 1 FROM products WHERE store_id = ? AND id = ?').get(store.id, body.storeProductId)) return c.json({ error: 'store product not found' }, 404);
        db.prepare(`INSERT OR IGNORE INTO pr_outcomes (id, store_id, product_id, kind, ref_id, created_at) VALUES (?, ?, ?, 'not_store_product', ?, ?)`).run(crypto.randomUUID(), store.id, c.req.param('id'), body.storeProductId, new Date().toISOString());
        return c.json({ ruledOut: true }, 201);
      }
      const err = linkStoreProduct(db, store.id, c.req.param('id'), body.storeProductId);
      if (err) return c.json({ error: err }, 404);
      const set = db.prepare(`SELECT id FROM pr_signals WHERE store_id = ? AND product_id = ? AND platform = 'orders'`).get(store.id, c.req.param('id'));
      return c.json({ ordersSet: set ? signalSet(db, String(set.id), store.id) : null }, 201);
    });
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{8,64}$/.test(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** POST /api/pr/tasks's body, checked. The instructions are kept exactly as typed. */
function taskInput(body: unknown): TaskInput | { error: string; field?: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!isId(b.clientRequestId)) return { error: 'Expected { clientRequestId, productId, type, mode, instructions, … }' };
  if (b.productId !== undefined && typeof b.productId !== 'string') return { error: 'productId must be the product to research', field: 'link' };
  if (b.productId === undefined && b.url === undefined) return { error: 'Paste the product link, or open the product to research.', field: 'link' };
  if (typeof b.type !== 'string') return { error: 'Pick an agent', field: 'agent' };
  if (b.mode !== 'new' && b.mode !== 'queue' && b.mode !== 'separate') return { error: 'mode must be new, queue or separate', field: 'agent' };
  if (b.mode !== 'new' && typeof b.conversationId !== 'string') return { error: 'Name the conversation to queue after or run beside', field: 'agent' };
  if (!isText(b.instructions, INSTRUCTIONS_MAX) || !b.instructions.trim()) return { error: `Say what to research (up to ${INSTRUCTIONS_MAX.toLocaleString('en')} characters)`, field: 'instructions' };
  if (b.url !== undefined && !isText(b.url, 2048)) return { error: 'url must be the link as pasted', field: 'link' };
  if (b.template !== undefined && !isText(b.template, 100)) return { error: 'template must be a template name', field: 'instructions' };
  const p = b.preview as Record<string, unknown> | undefined;
  if (p !== undefined && (typeof p !== 'object' || p === null || (p.title != null && !isText(p.title, 300)) || (p.variants !== undefined && (!Array.isArray(p.variants) || p.variants.some((v) => !isText(v, 200)))))) return { error: 'preview must be the preview the page returned', field: 'link' };
  const price = p?.price as { amount?: unknown; currency?: unknown } | null | undefined;
  if (price != null && (!Number.isInteger(price.amount) || typeof price.currency !== 'string')) return { error: 'preview price must be { amount, currency }', field: 'link' };
  const owner = b.owner === undefined ? { details: undefined } : ownerDetails(b.owner);
  if ('error' in owner) return { error: owner.error, field: 'link' };
  if (b.config !== undefined && (typeof b.config !== 'object' || b.config === null || Array.isArray(b.config))) return { error: 'config must be what Deploy returned', field: 'agent' };
  return {
    clientRequestId: b.clientRequestId,
    ...(typeof b.productId === 'string' ? { productId: b.productId } : {}),
    ...(typeof b.listingId === 'string' ? { listingId: b.listingId } : {}),
    ...(typeof b.url === 'string' ? { url: b.url } : {}),
    ...(p ? { preview: { title: (p.title as string | null) ?? null, price: (price as { amount: number; currency: string } | null) ?? null, variants: (p.variants as string[] | undefined) ?? [] } } : {}),
    ...(owner.details ? { owner: owner.details } : {}),
    instructions: b.instructions,
    ...(typeof b.template === 'string' ? { template: b.template } : {}),
    type: b.type,
    mode: b.mode,
    ...(typeof b.conversationId === 'string' ? { conversationId: b.conversationId } : {}),
    ...(b.config ? { config: b.config as TaskInput['config'] } : {}),
  };
}

const watched = new WeakSet<Db>();
/** A task's run changed: tell the page (T8). One listener per database. */
function watchTasks(db: Db) {
  if (watched.has(db)) return;
  watched.add(db);
  subscribe((m) => {
    if (m.type !== 'run') return;
    try {
      let t = db.prepare('SELECT id, store_id, product_id FROM pr_tasks WHERE run_id = ?').get(m.run.id);
      // The task takes its run at the run's first event, as launch() will: the scripted engine reports before start() returns.
      // AI Agents' Retry or Resume of the task's run (runs.start links `retry:<old>:<new>`): the task follows the new run.
      const linked =
        !t &&
        db
          .prepare(
            `SELECT t.id, t.store_id, t.product_id FROM pr_tasks t WHERE EXISTS (SELECT 1 FROM done_once WHERE ref = 'retry:' || t.run_id || ':' || ?1)
               OR (t.run_id IS NULL AND EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = ?1 AND r.store_id = t.store_id AND r.client_request_id = t.client_request_id))`,
          )
          .get(m.run.id);
      if (linked) db.prepare('UPDATE pr_tasks SET run_id = ? WHERE id = ?').run(m.run.id, String((t = linked).id));
      if (t) publish({ type: 'research_task', storeId: String(t.store_id), taskId: String(t.id), productId: String(t.product_id) });
    } catch {
      /* a closed test database */
    }
  });
}
