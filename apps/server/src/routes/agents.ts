import {
  budgetAddedToday,
  claudeAccount,
  claudeEngine,
  defaultEngine,
  engineInfo,
  isAccountError,
  costToday,
  creditsToday,
  XP,
  ADS_JOB,
  IDLE_CAMPAIGN_STATUSES,
  MISSION_TEMPLATES,
  advanceMissions,
  advanceResearch,
  createResearchTask,
  getResearchTask,
  promoteToGeneral,
  createMission,
  getMission,
  cancelMission,
  listMissions,
  parseMission,
  createDefaultJobs,
  DEFAULT_JOBS,
  createRunManager,
  customNichePack,
  draftNichePackTask,
  enableDefaultJobs,
  once,
  deleteMemory,
  deleteNicheLearning,
  ensureSquads,
  seedDemoXp,
  getAgent,
  getPageDraft,
  kbGoLive,
  knowledgeDoc,
  knowledgeIndex,
  resetKnowledge,
  saveKnowledge,
  listAgents,
  listMemory,
  listNicheLearnings,
  listXpEvents,
  addNicheLearning,
  nicheKey,
  nicheSlug,
  listRuns,
  getRun,
  runGist,
  unsafeHtml,
  updateAgent,
  updateMemory,
  writeMemory,
  type RunManager,
  type RunManagerOptions,
  type ToolEnv,
} from '@frontline/agents';
import { AGENT_ROLES, AUTONOMY_LEVELS, KB_RESEARCH_DEPTHS, type AdSnapshotData, type KbResearchBrief, type AgentRole, type AgentUpdate, type ClaudeAccount, type MemoryInput, type MemoryKind, type Page, type Platform, type ResearchProduct, type SquadMission, type StartRunInput, type Store, type StoreUsage } from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { currentWindow, summarize } from '../analytics';
import { convertRate, fxFor } from '../fx';
import { approvalsHook, decide } from '../approvals';
import { listCompetitors, priceChanges, publicFetch, watchCompetitorPrices } from '../competitors';
import { localDate } from '../dates';
import { DEMO_STORES } from '../demo';
import { dataDir, type Db } from '../db';
import { log } from '../log';
import { askKnowledge } from '../kb/ask';
import { createFetcher } from '../kb/fetcher';
import { researchRoutes } from '../research';
import { addProducts, applyAdChange, applyPriceChange, discardThemeCopy, draftThemeCopy, EXPIRED_DEMO, onApproved, onDecision, publishDraft, publishThemeChange, rememberDenial, type PushPage, type SetPrice, type WriteAd } from './agents-actions';
import { pageRoutes } from './agents-pages';
import { flowRoutes } from './agents-flows';
import { issueRoutes } from './agents-issues';
import { award, gamificationRoutes } from './agents-gamification';
import { creativeRoutes, higgsfieldGenerate } from './agents-creatives';
import { pauseCampaign, setCampaignBudget } from '../connectors/ads';
import { demoSupplierProducts, searchCj } from '../connectors/cj';
import { createProducts, deleteTheme, duplicateTheme, listThemes, publishPage, publishProductPage, publishTheme, readThemeFiles, setProductPrice, upsertThemeFiles } from '../connectors/shopify';
import { createWooProducts, publishWooPage, publishWooProductPage, setWooProductPrice } from '../connectors/woocommerce';
import { publishEtsyProductPage, setEtsyListingPrice } from '../connectors/etsy';
import { setAmazonListingPrice } from '../connectors/amazon';
import { setTikTokProductPrice } from '../connectors/tiktok';
import { getCredentials } from '../integrations';
import { loadKey } from '../secrets';
import { getCaps, notify } from '../settings';
import { getStore, listStores } from '../stores';
import { publish } from '../live';

/** Approved ad changes → the store's ad account (core's Meta / Google / TikTok writers). */
const writeAd =
  (db: Db): WriteAd =>
  (storeId, network, campaignId, change) =>
    change === 'pause'
      ? pauseCampaign(db, loadKey(dataDir()), storeId, network, campaignId)
      : setCampaignBudget(db, loadKey(dataDir()), storeId, network, campaignId, change.dailyBudget);

/** Core's store writers by platform (shared PRODUCT_WRITE_PLATFORMS / PRICE_WRITE_PLATFORMS). Others get a readable error, and the owner applies it by hand. */
const onStore = <T,>(db: Db, storeId: string, writers: Partial<Record<Platform, () => Promise<T>>>) => {
  const platform = getStore(db, storeId)?.platform;
  const write = platform && writers[platform];
  return write ? write() : Promise.reject(new Error(`The app doesn't change ${platform} stores automatically yet`));
};

/** Theme writers are Shopify-only. */
const onShopify = <T,>(db: Db, storeId: string, write: () => Promise<T>) =>
  getStore(db, storeId)?.platform === 'shopify' ? write() : Promise.reject(new Error('Only Shopify stores are updated automatically so far'));

/** Theme work reads and writes the real store only: demo stores have no theme to edit. */
const onLiveShopify = <T,>(db: Db, storeId: string, fn: () => Promise<T>) =>
  getStore(db, storeId)?.connected ? onShopify(db, storeId, fn) : Promise.reject(new Error('Theme editing needs a connected Shopify store; this one runs on demo data.'));

/** Store Builder drafts → Shopify or WooCommerce: product pages update the product (Etsy too), other pages are created. */
const pushPage =
  (db: Db): PushPage =>
  (d) => {
    const bad = unsafeHtml(d.html);
    if (bad) return Promise.reject(new Error(`The draft has HTML a storefront must not run (${bad}); ask the Store Developer for a clean draft`));
    const seo = { ...(d.seoTitle ? { seoTitle: d.seoTitle } : {}), ...(d.seoDescription ? { seoDescription: d.seoDescription } : {}) };
    const product = d.kind === 'product' && d.productId;
    return onStore<unknown>(db, d.storeId, {
      shopify: () =>
        product
          ? publishProductPage(db, loadKey(dataDir()), d.storeId, product, { title: d.title, descriptionHtml: d.html, ...seo })
          : publishPage(db, loadKey(dataDir()), d.storeId, { title: d.title, bodyHtml: d.html }),
      // No SEO fields on Woo; other pages need the WordPress login fields, and core's error says so.
      woocommerce: () =>
        product
          ? publishWooProductPage(db, loadKey(dataDir()), d.storeId, product, { title: d.title, descriptionHtml: d.html })
          : publishWooPage(db, loadKey(dataDir()), d.storeId, { title: d.title, bodyHtml: d.html }),
      // Etsy has listings, not pages; core sends the description as plain text.
      ...(product ? { etsy: () => publishEtsyProductPage(db, loadKey(dataDir()), d.storeId, product, { title: d.title, descriptionHtml: d.html }) } : {}),
    });
  };

/** Approved price tests → Shopify (every variant), WooCommerce or Etsy. */
const setPrice =
  (db: Db): SetPrice =>
  (storeId, productId, change) =>
    onStore(db, storeId, {
      shopify: () => setProductPrice(db, loadKey(dataDir()), storeId, productId, change),
      woocommerce: () => setWooProductPrice(db, loadKey(dataDir()), storeId, productId, change),
      etsy: () => setEtsyListingPrice(db, loadKey(dataDir()), storeId, productId, change),
      amazon: () => setAmazonListingPrice(db, loadKey(dataDir()), storeId, productId, change),
      tiktok_shop: () => setTikTokProductPrice(db, loadKey(dataDir()), storeId, productId, change),
    });


/** App data + approvals for agent tools. `key` decrypts integration credentials (default: the data dir's key file). */

export const toolEnv = (db: Db, key: () => Buffer = () => loadKey(dataDir())): ToolEnv => ({
  db,
  kbFetch: (url, opts) => kbFetch(url, opts),
  approvals: approvalsHook(db),
  decide: (id, decision) => decide(db, id, decision),
  caps: (storeId) => getCaps(db, storeId),
  toUsd: async (amount, currency) => {
    const rate = await convertRate(db, currency, 'USD');
    return rate && amount * rate;
  },
  startRun: (agentId, task, parentRunId) => runManager(db).start(agentId, task, undefined, parentRunId),
  generateMedia: async (req, signal) => {
    const creds = db.prepare(`SELECT 1 FROM integrations WHERE kind = 'higgsfield'`).get() && getCredentials(db, key(), 'higgsfield');
    if (!creds?.keyId || !creds.keySecret) return undefined;
    return higgsfieldGenerate({ keyId: creds.keyId, keySecret: creds.keySecret }, req, join(dataDir(), 'creatives'), { signal });
  },
  externalMcp: (storeId) => {
    if (!db.prepare(`SELECT 1 FROM integrations WHERE kind = 'meta_ads' AND store_id = ?`).get(storeId)) return {};
    const meta = getCredentials(db, key(), 'meta_ads', storeId);
    return meta?.accessToken ? { meta_ads: { type: 'http', url: 'https://mcp.facebook.com/ads', headers: { Authorization: `Bearer ${meta.accessToken}` } } } : {};
  },
  competitors: (storeId) => ({
    competitors: listCompetitors(db, [storeId]),
    priceChanges: priceChanges(db, [storeId], 20),
    ads: db
      .prepare(
        `SELECT c.name, s.data_json FROM competitor_snapshots s JOIN competitors c ON c.id = s.competitor_id
         WHERE c.store_id = ? AND s.kind = 'ad' ORDER BY s.captured_at DESC, s.rowid DESC LIMIT 15`,
      )
      .all(storeId)
      .map((r) => ({ competitor: String(r.name), ...(JSON.parse(String(r.data_json)) as AdSnapshotData) })),
  }),
  trackCompetitor: async (storeId, { name, url, notes }) => {
    // A shop is its host, but every Etsy shop is on etsy.com: there it's the shop's path (as core's Etsy reader takes it).
    const site = (u: string) => {
      const x = new URL(u);
      const host = x.hostname.replace(/^www\./, '');
      const shop = /(^|\.)etsy\.com$/.test(host) && /\/shop\/([a-z0-9]+)/i.exec(x.pathname)?.[1];
      return shop ? `etsy.com/shop/${shop.toLowerCase()}` : host;
    };
    const tracked = db.prepare('SELECT url FROM competitors WHERE store_id = ?').all(storeId).map((r) => site(String(r.url)));
    if (tracked.includes(site(url))) return `Already tracked: ${site(url)}.`;
    // ponytail: 10 a store keeps the daily watch light; the owner removes one in Competitor Intel to make room.
    if (tracked.length >= 10) return 'Not added: this store already tracks 10 competitors. Name this one in your answer so the owner can swap it in.';
    const id = randomUUID();
    db.prepare('INSERT INTO competitors (id, store_id, name, url, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, storeId, name.trim(), url, notes, new Date().toISOString());
    // Read now: a site with no readable catalog would sit in the list with no prices, ever.
    const etsy = /(^|\.)etsy\.com$/.test(new URL(url).hostname);
    // publicFetch (CORE-120): a public-looking name whose DNS answer is this computer or its network isn't read either.
    let local = false;
    const added = await watchCompetitorPrices(db, id, url, publicFetch(), new Date(), etsy ? loadKey(dataDir()) : undefined).catch((e: unknown) => {
      local = /points at this computer/.test(String(e));
    });
    if (added === undefined) {
      db.prepare('DELETE FROM competitors WHERE id = ?').run(id);
      if (local) return `Not added: ${site(url)} points at this computer or its network, so the app won't read it. Give the shop's public web address.`;
      const why = etsy
        ? "an Etsy shop is read with a connected Etsy store's app key, and the address must be its shop page (etsy.com/shop/<name>)"
        : 'the app reads Shopify, WooCommerce and Etsy shops';
      return `Not added: no product prices could be read at ${site(url)} (${why}). Name it in your answer instead.`;
    }
    notify(db, { kind: 'info', title: `Now tracking ${name.trim()}`, body: `${notes} Remove it in Competitor Intel if it isn't one.`, storeId, link: '/competitors' });
    return `Tracking ${name.trim()} (${site(url)}): ${added} product price${added === 1 ? '' : 's'} read. list_competitors with q compares them.`;
  },
  recordFind: async (find) => {
    // The daily scan finds the same products again: a repeat refreshes the earlier find instead of piling up copies.
    const prior = db
      .prepare(`SELECT id FROM research_products WHERE niche = ? AND niche_detail IS ? AND id LIKE 'find-%' AND lower(title) = lower(?)`)
      .get(find.niche, find.nicheDetail ?? null, find.title)?.id;
    const id = prior ? String(prior) : `find-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO research_products (id, title, category, niche, niche_detail, image, source, cost, price, compare_at, trend, competition, shipping_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET category = excluded.category, image = coalesce(excluded.image, image), source = excluded.source, cost = excluded.cost, price = excluded.price,
         compare_at = excluded.compare_at, trend = excluded.trend, competition = excluded.competition, shipping_days = excluded.shipping_days`,
    ).run(id, find.title, find.category, find.niche, find.nicheDetail ?? null, find.image ?? null, find.source, find.cost, find.price, find.compareAt, find.trend, find.competition, find.shippingDays);
    return { ...((await (await researchRoutes(db).request(`/api/research/${id}`)).json()) as ResearchProduct), ...(prior ? { repeat: true } : {}) };
  },
  searchSuppliers: async (q, limit) => (await searchCj(db, loadKey(dataDir()), q, limit)) ?? demoSupplierProducts(db, q, limit),
  research: async (q) => {
    const params = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])));
    const res = await researchRoutes(db).request(`/api/research?${params}`);
    return ((await res.json()) as Page<ResearchProduct>).items;
  },
  summary: (storeId, range) => {
    const { to, todayFraction, rows } = currentWindow(db, [storeId], range); // the dashboard's window, so the numbers match it
    return summarize(rows, { range, to, storeIds: [storeId], todayFraction });
  },
  themes: {
    list: (storeId) => onLiveShopify(db, storeId, () => listThemes(db, loadKey(dataDir()), storeId)),
    read: (storeId, filenames, themeId) =>
      onLiveShopify(db, storeId, async () => {
        const id = themeId ?? (await listThemes(db, loadKey(dataDir()), storeId)).find((t) => t.role === 'MAIN')?.id;
        if (!id) throw new Error('Shopify: the store has no live theme');
        return readThemeFiles(db, loadKey(dataDir()), storeId, id, filenames);
      }),
    draft: (storeId, name, files) =>
      onLiveShopify(db, storeId, async () => {
        const copy = await draftThemeCopy(
          {
            list: () => listThemes(db, loadKey(dataDir()), storeId),
            duplicate: (themeId, n) => duplicateTheme(db, loadKey(dataDir()), storeId, themeId, n),
            upsert: (themeId, f) => upsertThemeFiles(db, loadKey(dataDir()), storeId, themeId, f),
            remove: (themeId) => deleteTheme(db, loadKey(dataDir()), storeId, themeId),
          },
          name,
          files,
        );
        once(db, `theme-copy:${storeId}:${copy.id}`); // ours: a denial may delete it (discardThemeCopy)
        return copy;
      }),
    remove: (storeId, themeId) => onLiveShopify(db, storeId, () => deleteTheme(db, loadKey(dataDir()), storeId, themeId)),
  },
  portfolio: (range) => {
    const ids = listStores(db).map((s) => s.id);
    const { to, todayFraction, rows } = currentWindow(db, ids, range);
    const { currency, unconverted } = fxFor(db, ids);
    return { ...summarize(rows, { range, to, storeIds: ids, todayFraction }), currency, ...(unconverted.length ? { unconverted } : {}) };
  },
});

/** What the app does with runs: stream them over the live bus, pay XP, notify the owner when one finishes or fails. */
/** Real runs start in their own folder, so their Claude Code sessions stay out of the owner's projects (`claude --resume`). */
const agentSessions = () => {
  const cwd = resolve(dataDir(), 'agent-sessions');
  mkdirSync(cwd, { recursive: true });
  return { cwd };
};

export const runHooks = (db: Db): Pick<RunManagerOptions, 'onRun' | 'onEvent' | 'onError'> => ({
  // To api.log: the desktop app keeps no console.
  onError: (run, e) => log('error', 'run failed to finish', { runId: run.id, agentId: run.agentId, error: e instanceof Error ? e.message : String(e) }),
  onEvent: (run, event) => {
    publish({ type: 'run_event', runId: run.id, agentId: run.agentId, storeId: run.storeId, event });
    if (event.type === 'memory_written') {
      const m = event.memory;
      award(db, { ref: `memory:${m.id}`, amount: XP.memory, reason: `Learned: ${m.text.slice(0, 80)}`, storeId: m.storeId, agentId: run.agentId });
    }
  },
  onRun: (run) => {
    publish({ type: 'run', run });
    const ended = run.status === 'done' || run.status === 'error' || run.status === 'cancelled';
    // A research stage reports as its task (advanceKbResearch): no XP or notification for each stage.
    if (run.mode?.startsWith('research:')) return void (ended && advanceKbResearch(db));
    if (ended) advanceSquadMissions(db);
    if (run.status === 'done') award(db, { ref: `run:${run.id}`, amount: XP.runDone, reason: `Completed: ${run.task.slice(0, 80)}`, storeId: run.storeId, agentId: run.agentId });
    const agent = getAgent(db, run.agentId);
    const name = agent ? AGENT_ROLES[agent.role].name : 'Agent';
    const link = `/agents/${run.agentId}`;
    if (run.status === 'done') notify(db, { kind: 'agent_done', title: `${name} finished`, body: runGist(getRun(db, run.id)?.transcript ?? []) ?? run.task, storeId: run.storeId, link });
    // An account problem fails every queued and scheduled run alike: the owner hears it once a day, not once per run.
    const told = run.status === 'error' && isAccountError(run.error ?? '') && !once(db, `account-error:${localDate()}:${run.error}`);
    if (run.status === 'error' && !told) notify(db, { kind: 'error', title: `${name} hit an error`, body: run.error ?? run.task, storeId: run.storeId, link });
  },
});

const managers = new WeakMap<Db, RunManager>();

/** The app's run manager for this DB. */
export function runManager(db: Db): RunManager {
  let manager = managers.get(db);
  if (!manager) {
    manager = createRunManager({ db, env: toolEnv(db), store: (id) => getStore(db, id), engine: defaultEngine(claudeEngine({ queryOptions: agentSessions })), ...runHooks(db) });
    managers.set(db, manager);
    // Approved actions that can come from outside a run (research screen, automations) are carried out here.
    onDecision(db, 'denied', (db, a) => {
      rememberDenial(db, a);
      if (a.action.kind === 'store.publish_theme' && getStore(db, a.storeId)?.connected) {
        return discardThemeCopy(db, a, (storeId, themeId) => onLiveShopify(db, storeId, () => deleteTheme(db, loadKey(dataDir()), storeId, themeId)));
      }
    });
    onApproved(db, (db, a) => {
      // The store's first real sync landed after this was asked, before the squad noticed (activation): it was asked on
      // demo numbers, so it expires like the other waiting ones instead of acting on the live store.
      if (db.prepare('SELECT 1 FROM stores WHERE id = ? AND connected = 1 AND demo = 0').get(a.storeId) && !db.prepare('SELECT 1 FROM done_once WHERE ref = ?').get(`activate:${a.storeId}`)) {
        activateConnectedStores(db, runManager(db));
        once(db, `not-applied:${a.id}`);
        return notify(db, { kind: 'info', title: `Not applied: "${a.title}"`, body: 'It was asked on the demo data, before the store went live. Ask the squad again for a read on the real numbers.', storeId: a.storeId, link: `/agents/${a.agentId}` });
      }
      if (a.action.kind === 'store.add_products') {
        return addProducts(db, a, (agentId, task) => runManager(db).start(agentId, task), (storeId, products) =>
          onStore(db, storeId, {
            shopify: () => createProducts(db, loadKey(dataDir()), storeId, products),
            woocommerce: () => createWooProducts(db, loadKey(dataDir()), storeId, products),
          }),
        );
      }
      if (a.action.kind === 'ads.set_budget' || a.action.kind === 'ads.pause_campaign') return applyAdChange(db, a, writeAd(db));
      if (a.action.kind === 'store.set_price') return applyPriceChange(db, a, setPrice(db));
      if (a.action.kind === 'store.publish_theme') return publishThemeChange(db, a, (storeId, themeId) => onShopify(db, storeId, () => publishTheme(db, loadKey(dataDir()), storeId, themeId)));
      if (a.action.kind === 'store.publish_page') {
        const d = getPageDraft(db, String((a.action.payload as { draftId?: unknown })?.draftId));
        if (d) return publishDraft(db, d, pushPage(db));
      }
      if (a.action.kind === 'niche.promote_learning') {
        const p = (a.action.payload ?? {}) as { niche?: unknown; text?: unknown; evidence?: unknown };
        if (typeof p.niche === 'string' && typeof p.text === 'string') {
          return addNicheLearning(db, { niche: p.niche, text: p.text, ...(typeof p.evidence === 'string' ? { evidence: p.evidence } : {}), storeId: a.storeId });
        }
      }
      if (a.action.kind === 'kb.promote') {
        const p = (a.action.payload ?? {}) as { cardId?: unknown; title?: unknown; summary?: unknown; body?: unknown };
        if (typeof p.cardId !== 'string' || typeof p.title !== 'string' || typeof p.summary !== 'string') return;
        return promoteToGeneral(db, a.storeId, { cardId: p.cardId, title: p.title, summary: p.summary, ...(typeof p.body === 'string' ? { body: p.body } : {}) }, a.agentId);
      }
      if (a.action.kind === 'kb.research') {
        // An agent's recommend_research, or self-directed research waiting for approval (KB-22): the store that asked pays,
        // and the findings go to it or to General, never elsewhere.
        const p = (a.action.payload ?? {}) as { ws?: unknown; role?: unknown; objective?: unknown; brief?: KbResearchBrief; budgetUsd?: unknown; origin?: unknown };
        if (typeof p.objective !== 'string' || typeof p.role !== 'string' || !Object.hasOwn(AGENT_ROLES, p.role) || typeof p.budgetUsd !== 'number') return;
        const { lookFor, depth, trigger } = p.brief ?? {};
        createResearchTask(db, {
          ws: p.ws === null ? null : a.storeId, payerId: a.storeId, role: p.role as AgentRole, kind: 'topic', origin: p.origin === 'autonomous' ? 'autonomous' : 'agent', objective: p.objective,
          brief: { ...(typeof lookFor === 'string' ? { lookFor } : {}), ...(depth && Object.hasOwn(KB_RESEARCH_DEPTHS, depth) ? { depth } : {}), ...(trigger ? { trigger } : {}) },
          budgetUsd: Math.min(5, Math.max(0.25, p.budgetUsd)),
        });
        return advanceKbResearch(db);
      }
    });
  }
  return manager;
}

const KINDS: MemoryKind[] = ['fact', 'learning', 'preference'];
const isText = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

/** Validates a MemoryInput (all fields optional when partial). Returns an error message or the clean input. */
export function parseMemoryInput(body: unknown, partial: boolean): string | Partial<MemoryInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
  const b = body as Record<string, unknown>;
  const has = (k: string) => b[k] !== undefined;
  if ((has('kind') || !partial) && !KINDS.includes(b.kind as MemoryKind)) return `kind must be one of ${KINDS.join(', ')}`;
  if ((has('text') || !partial) && !isText(b.text, 5, 300)) return 'text must be 5–300 characters';
  if (has('evidence') && !isText(b.evidence, 0, 300)) return 'evidence must be up to 300 characters';
  if (has('confidence') && !(typeof b.confidence === 'number' && b.confidence >= 0 && b.confidence <= 1)) return 'confidence must be 0–1';
  if (has('tags') && !(Array.isArray(b.tags) && b.tags.length <= 10 && b.tags.every((t) => isText(t, 1, 40)))) return 'tags must be up to 10 short strings';
  if (has('pinned') && (!partial || typeof b.pinned !== 'boolean')) return 'pinned must be true or false (PATCH only)';
  const out: Partial<MemoryInput> = {};
  for (const k of ['kind', 'text', 'evidence', 'confidence', 'tags', 'pinned'] as const) if (has(k)) Object.assign(out, { [k]: typeof b[k] === 'string' ? b[k].trim() : b[k] });
  return out;
}

/**
 * A store's first real sync connects it (core's switchToReal). Once per store: what the squad left from its demo phase
 * is cleared (startFresh), its default jobs switch on (they run on the owner's Claude login, so the owner is told), and a
 * custom niche without a pack gets the Market Analyst drafting one.
 */
// ponytail: checked at startup, on squad reads, each minute and before an approved request runs; core has no connect event to hook.
/**
 * Core wiped the store's simulated rows; everything the squad made before now came from them (activation runs once,
 * before any real-data job). Its facts and learnings go (the owner's notes, pins and preferences stay), requests asked
 * on demo numbers expire instead of acting on the live store, issues on demo orders close, and page drafts for demo
 * products go.
 */
function startFresh(db: Db, store: Store, runs: RunManager) {
  const memories = db.prepare(`DELETE FROM store_memory WHERE store_id = ? AND agent_id != 'owner' AND kind IN ('fact', 'learning') AND pinned = 0`).run(store.id).changes;
  const pending = db.prepare(`SELECT id FROM approvals WHERE store_id = ? AND status = 'pending'`).all(store.id).map((r) => String(r.id));
  for (const id of pending) {
    db.prepare('UPDATE approvals SET reason = reason || ? WHERE id = ?').run(` ${EXPIRED_DEMO}`, id);
    decide(db, id, 'deny');
  }
  const issues = db
    .prepare(`UPDATE order_issues SET status = 'resolved', resolution = 'Flagged on demo data; closed when the store went live.', resolved_at = ? WHERE store_id = ? AND status = 'open'`)
    .run(new Date().toISOString(), store.id).changes;
  db.prepare(`DELETE FROM page_drafts WHERE store_id = ? AND kind = 'product' AND published_at IS NULL`).run(store.id);
  // Flows written about the demo catalog and sized on its numbers: the monthly check would count them as done.
  const flows = db.prepare('DELETE FROM flow_drafts WHERE store_id = ?').run(store.id).changes;
  // A mission's next steps work from the finished ones' answers, read off demo numbers.
  const missions = db.prepare('SELECT id FROM squad_missions WHERE store_id = ? AND ended_at IS NULL').all(store.id).map((r) => String(r.id));
  for (const id of missions) {
    const mission = cancelMission(db, id, runs.cancel);
    if (mission) publish({ type: 'mission', mission });
  }
  // "Ready to launch" ads and copy for the demo catalog, which the store doesn't sell. Paid Higgsfield renders stay.
  const creatives = db.prepare(`DELETE FROM creatives WHERE store_id = ? AND source != 'higgsfield'`).run(store.id).changes;
  // What it shared with its niche came from the same demo numbers, and every store of the niche reads it (AGT-164).
  const shared = db.prepare('DELETE FROM niche_learnings WHERE store_id = ?').run(store.id).changes;
  const kb = kbGoLive(db, store.id);
  const n = (k: number | bigint, what: string) => k && `${k} ${what}${Number(k) === 1 ? '' : 's'}`;
  const parts = [
    n(memories, 'learning'), n(shared, 'niche learning'), n(kb.cards, 'knowledge card'), n(kb.measurements, 'demo measurement'), n(kb.tasks, 'research task'),
    n(pending.length, 'request'), n(issues, 'order issue'), n(flows, 'flow draft'), n(creatives, 'creative'), n(missions.length, 'running mission'),
  ].filter(Boolean);
  if (parts.length) {
    notify(db, {
      kind: 'info', title: `${store.name}: the squad starts fresh on real numbers`, storeId: store.id, link: '/knowledge',
      body: `Cleared what came from the demo data: ${parts.join(', ')}. Your own notes, pins and preferences stay.`,
    });
  }
}

/** Starts the mission steps that finished runs unblocked; the live feed sees every move, the owner hears when one ends. */
// One fetcher for the app: its per-site gap and robots.txt cache only hold if every task shares it.
const kbFetch = createFetcher();

/** Moves knowledge-base research tasks on (kb-research.ts), streams them, and tells the owner how each one ended. */
export function advanceKbResearch(db: Db) {
  const runs = managers.get(db);
  if (!runs) return; // as advanceSquadMissions: agentRoutes advances once the manager is ready
  advanceResearch(db, { start: runs.start, fetch: kbFetch, engineAvailable: () => engineInfo(true).provider === 'claude' }).then(
    (moved) => {
      for (const t of moved) {
        publish({ type: 'kb_task', task: t });
        const about = { storeId: t.storeId ?? undefined, link: `/knowledge?view=research&task=${t.id}` };
        if (t.status === 'done') notify(db, { kind: 'agent_done', title: `Research done: ${t.objective.slice(0, 80)}`, body: getResearchTask(db, t.id)?.report?.summary, ...about });
        if (t.status === 'failed') notify(db, { kind: 'error', title: `Research failed: ${t.objective.slice(0, 80)}`, body: t.error, ...about });
      }
    },
    (e) => log('error', 'kb research: advance failed', { error: e instanceof Error ? e.message : String(e) }),
  );
}

function advanceSquadMissions(db: Db) {
  const runs = managers.get(db);
  if (!runs) return; // a restart retry ended while the manager was being built: agentRoutes advances once it's ready
  let moved: SquadMission[];
  try {
    moved = advanceMissions(db, runs.start);
  } catch (e) {
    // A damaged mission row mustn't cost every run end its XP and notification, or the app its start.
    return log('error', 'squad missions: advance failed', { error: e instanceof Error ? e.message : String(e) });
  }
  for (const m of moved) {
    publish({ type: 'mission', mission: m });
    if (m.status === 'running') {
      for (const s of m.steps) {
        if (s.note && once(db, `mission-wait:${m.id}:${s.id}:${s.note}`)) {
          notify(db, { kind: 'info', title: `Mission waiting: ${m.title}`, body: `The ${AGENT_ROLES[s.role].name} can't take its step yet: ${s.note}`, storeId: m.storeId, link: '/ecosystem' });
        }
      }
      continue;
    }
    const stuck = m.steps.find((s) => s.status === 'error' || s.status === 'cancelled');
    notify(db, m.status === 'done'
      ? { kind: 'agent_done', title: `Mission done: ${m.title}`, body: m.steps.at(-1)?.deliverable ?? `${m.steps.length} steps done.`, storeId: m.storeId, link: '/ecosystem' }
      : {
          kind: 'error', title: `Mission stuck: ${m.title}`, storeId: m.storeId, link: '/ecosystem',
          body: `The ${stuck ? AGENT_ROLES[stuck.role].name : 'squad'}'s step ${stuck?.status === 'cancelled' ? 'was cancelled' : 'failed'}, so the steps that need it didn't start.`,
        });
  }
}

function activateConnectedStores(db: Db, runs: RunManager) {
  for (const store of listStores(db).filter((s) => s.connected)) {
    // A campaign that is on or spent in the last 30 days: an old account's archived ones give the review nothing to do.
    const ads = !!db
      .prepare(
        `SELECT 1 FROM campaigns c WHERE c.store_id = ? AND (c.status NOT IN (SELECT value FROM json_each(?))
           OR EXISTS (SELECT 1 FROM campaign_daily d WHERE d.network = c.network AND d.campaign_id = c.id AND d.date >= ? AND d.spend > 0)) LIMIT 1`,
      )
      .get(store.id, JSON.stringify(IDLE_CAMPAIGN_STATUSES), new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
    if (once(db, `activate:${store.id}`)) {
      startFresh(db, store, runs);
      // No running campaigns yet: the campaign review waits for one (marked, so a job the owner turned off is never turned back on).
      if (!ads) once(db, `ads-job-wait:${store.id}`);
      const names = DEFAULT_JOBS.filter((j) => (ads || j.name !== ADS_JOB) && (!j.platforms || j.platforms.includes(store.platform))).map((j) => j.name);
      if (enableDefaultJobs(db, store.id, names)) {
        const later = ads ? '' : ` The ${ADS_JOB.toLowerCase()} starts once an ad account has a running campaign.`;
        notify(db, { kind: 'info', title: `${store.name} is live: the squad's scheduled jobs are on`, body: `${names.join(', ')}.${later} They run on your Claude login; pause or change them in Automation.`, storeId: store.id, link: '/automation' });
      }
      if (store.niche === 'other' && store.nicheDetail && !customNichePack(store.nicheDetail)) runs.start(`${store.id}:market_analyst`, draftNichePackTask(store));
    } else if (ads && db.prepare('DELETE FROM done_once WHERE ref = ?').run(`ads-job-wait:${store.id}`).changes && enableDefaultJobs(db, store.id, [ADS_JOB])) {
      notify(db, { kind: 'info', title: `${store.name}: the ${ADS_JOB.toLowerCase()} is on`, body: 'Its ad account has a running campaign, so the Ad Strategist reviews campaigns every morning on your Claude login. Pause it in Automation.', storeId: store.id, link: '/automation' });
    }
    // Stores live before those rules get them once: a job with nothing to work on there is switched off, unless the owner
    // set it in Automation (then nothing switches it back on, so it stays as they left it).
    // -2: the monthly flow check's gate came later.
    if (once(db, `job-gates-2:${store.id}`)) {
      const why = (j: (typeof DEFAULT_JOBS)[number]) =>
        j.name === ADS_JOB && !ads ? 'no running ad campaigns; it switches back on once an ad account has one'
        : j.platforms && !j.platforms.includes(store.platform) ? (j.elsewhere?.(store.platform) ?? '')
        : '';
      const off = DEFAULT_JOBS.filter((j) => why(j) && db.prepare(`UPDATE automation_rules SET enabled = 0 WHERE store_id = ? AND name = ? AND enabled = 1
        AND NOT EXISTS (SELECT 1 FROM done_once WHERE ref = 'rule-edited:' || automation_rules.id)`).run(store.id, j.name).changes);
      if (off.some((j) => j.name === ADS_JOB)) once(db, `ads-job-wait:${store.id}`);
      if (off.length) notify(db, { kind: 'info', title: `${store.name}: ${new Intl.ListFormat('en').format(off.map((j) => j.name.toLowerCase()))} switched off`, body: `${off.map((j) => `${j.name}: ${why(j)}.`).join(' ')} You can switch jobs back on in Automation.`, storeId: store.id, link: '/automation' });
    }
  }
}

// The Integrations screen's Claude card. ponytail: one answer per process, kept 5 minutes (each check starts the CLI).
let account: { at: number; answer: Promise<ClaudeAccount> } | undefined;

export function agentRoutes(db: Db) {
  ensureSquads(db);
  seedDemoXp(db, DEMO_STORES.map((s) => s.id));
  const runs = runManager(db);
  activateConnectedStores(db, runs);
  advanceSquadMissions(db); // runs that ended while the app was closed
  advanceKbResearch(db);
  // A step turned down for budget can start once the owner raises the store's cap (core's caps route) or the day turns
  // over, neither of which ends a run. ponytail: a minute's poll over open missions; an event from the caps route if that lags.
  // The same poll starts research retries once their wait is over (30 s and 60 s backoffs start up to a minute late).
  setInterval(() => (activateConnectedStores(db, runs), advanceSquadMissions(db), advanceKbResearch(db)), 60_000).unref();
  // Default jobs that shipped after a store was made; a live store's owner hears about them (they use Claude usage).
  for (const store of listStores(db)) {
    // Only what runs: a job added off (its platform can't take the work) waits in Automation, using nothing.
    const added = createDefaultJobs(db, store.id).filter((name) => db.prepare('SELECT enabled FROM automation_rules WHERE store_id = ? AND name = ?').get(store.id, name)?.enabled === 1);
    if (added.length && store.connected) {
      notify(db, { kind: 'info', title: `New scheduled work for ${store.name}`, body: `${added.join(', ')}. It runs on your Claude login; pause or change it in Automation.`, storeId: store.id, link: '/automation' });
    }
  }
  const limit = (v: string | undefined) => Math.min(200, Math.max(1, Math.floor(Number(v)) || 50));
  return new Hono()
    .get('/api/usage', (c) => {
      const ids = c.req.query('stores')?.split(',').filter(Boolean);
      const stores = listStores(db).filter((s) => !ids?.length || ids.includes(s.id));
      return c.json(
        stores.map((s): StoreUsage => ({ storeId: s.id, agentCostUsd: costToday(db, s.id), credits: creditsToday(db, s.id), adBudgetAddedUsd: budgetAddedToday(db, s.id) })),
      );
    })
    .get('/api/agents', (c) => {
      activateConnectedStores(db, runs);
      return c.json(listAgents(db, c.req.query('stores')?.split(',').filter(Boolean)));
    })
    .get('/api/agents/:id', (c) => {
      const agent = getAgent(db, c.req.param('id'));
      return agent ? c.json(agent) : c.json({ error: 'Agent not found' }, 404);
    })
    .get('/api/agents/:id/xp', (c) =>
      getAgent(db, c.req.param('id')) ? c.json(listXpEvents(db, c.req.param('id'), limit(c.req.query('limit')))) : c.json({ error: 'Agent not found' }, 404),
    )
    .patch('/api/agents/:id', async (c) => {
      const body = (await c.req.json().catch(() => null)) as AgentUpdate | null;
      if (
        !body ||
        (body.enabled !== undefined && typeof body.enabled !== 'boolean') ||
        (body.autonomy !== undefined && !AUTONOMY_LEVELS.includes(body.autonomy)) ||
        (body.dailyBudgetUsd != null && !(typeof body.dailyBudgetUsd === 'number' && body.dailyBudgetUsd >= 0 && body.dailyBudgetUsd <= 1000))
      ) {
        return c.json({ error: 'Expected { enabled?: boolean, autonomy?: suggest|ask|autopilot, dailyBudgetUsd?: 0-1000 | null }' }, 400);
      }
      const agent = updateAgent(db, c.req.param('id'), { enabled: body.enabled, autonomy: body.autonomy, dailyBudgetUsd: body.dailyBudgetUsd });
      if (agent && body.enabled === false) runManager(db).cancelAgent(agent.id); // offline means it stops working now
      if (agent) advanceSquadMissions(db); // a mission step this agent turned down (offline, budget spent) may start now
      return agent ? c.json(agent) : c.json({ error: 'Agent not found' }, 404);
    })
    .post('/api/agents/:id/runs', async (c) => {
      if (!getAgent(db, c.req.param('id'))) return c.json({ error: 'Agent not found' }, 404);
      const body = (await c.req.json().catch(() => null)) as StartRunInput | null;
      if (!body || !isText(body.task, 1, 4000) || (body.resumeRunId !== undefined && typeof body.resumeRunId !== 'string')) {
        return c.json({ error: 'Expected { task: string (1–4000 chars), resumeRunId?: string }' }, 400);
      }
      const run = runs.start(c.req.param('id'), body.task.trim(), body.resumeRunId);
      return typeof run === 'string' ? c.json({ error: run }, 409) : c.json(run, 201);
    })
    // Knowledge › Ask the knowledge base (KB-24): with cards matching the question, a Market Analyst answers from them only.
    .post('/api/kb/ask', async (c) => {
      const b = (await c.req.json().catch(() => null)) as { ws?: unknown; question?: unknown; payerId?: unknown } | null;
      const ws = b?.ws === 'all' ? 'all' : b?.ws === 'general' ? null : typeof b?.ws === 'string' && getStore(db, b.ws) ? b.ws : undefined;
      if (ws === undefined) return c.json({ error: 'ws must be general, all or a store id' }, 400);
      if (!isText(b!.question, 3, 500)) return c.json({ error: 'question must be 3-500 characters' }, 400);
      const payer = ws !== null && ws !== 'all' ? ws : b!.payerId;
      if (typeof payer !== 'string' || !getStore(db, payer)) return c.json({ error: 'payerId must be a store: whose Market Analyst answers' }, 400);
      const { answer, task } = askKnowledge(db, ws, (b!.question as string).trim());
      if (!task) return c.json(answer);
      const run = runs.start(`${payer}:market_analyst`, task);
      return typeof run === 'string' ? c.json({ error: run }, 409) : c.json({ ...answer, run });
    })
    // Knowledge › Niche packs: the owner asks a custom niche's Market Analyst for its pack. Going live asks once, so a
    // denied or failed draft was never offered again. Not on the demo engine: its made-up pack would be the niche's for good.
    .post('/api/agents/:id/niche-pack', (c) => {
      const agent = getAgent(db, c.req.param('id'));
      const store = agent?.role === 'market_analyst' ? getStore(db, agent.storeId) : undefined;
      if (!agent || !store) return c.json({ error: 'Market Analyst not found' }, 404);
      if (store.niche !== 'other' || !store.nicheDetail) return c.json({ error: `${store.name}'s niche has a built-in pack; edit it in Knowledge.` }, 409);
      if (customNichePack(store.nicheDetail)) return c.json({ error: `The "${store.nicheDetail}" pack exists; edit it in Knowledge.` }, 409);
      if (agent.engine?.provider !== 'claude') {
        return c.json({ error: "On the demo engine the Market Analyst can't research a niche, and its pack would be made up. Connect the store first." }, 409);
      }
      const pending = db
        // Requests before AGT-238 carry the niche as typed, not slugged.
        .prepare(`SELECT 1 FROM approvals WHERE status = 'pending' AND json_extract(action_json, '$.kind') = 'save_niche_pack' AND json_extract(action_json, '$.payload.slug') IN (?, ?)`)
        .get(nicheSlug(store.nicheDetail), store.nicheDetail);
      if (pending) return c.json({ error: `A draft of the "${store.nicheDetail}" pack is waiting for your approval in Requests.` }, 409);
      const run = runs.start(agent.id, draftNichePackTask(store));
      return typeof run === 'string' ? c.json({ error: run }, 409) : c.json(run, 201);
    })
    .get('/api/claude-account', async (c) => {
      if (engineInfo(true).provider !== 'claude') return c.json({ signedIn: false, checkedAt: new Date().toISOString(), error: 'Agents are set to the demo engine here (FRONTLINE_AGENT_ENGINE), so Claude is never used.' } satisfies ClaudeAccount);
      if (!account || c.req.query('refresh') === '1' || Date.now() - account.at > 5 * 60_000) account = { at: Date.now(), answer: claudeAccount(agentSessions().cwd) };
      return c.json(await account.answer);
    })
    .get('/api/squad-missions/templates', (c) => c.json(MISSION_TEMPLATES))
    .get('/api/squad-missions', (c) => c.json(listMissions(db, c.req.query('stores')?.split(',').filter(Boolean), limit(c.req.query('limit')))))
    .get('/api/squad-missions/:id', (c) => {
      const mission = getMission(db, c.req.param('id'));
      return mission ? c.json(mission) : c.json({ error: 'Mission not found' }, 404);
    })
    .post('/api/squad-missions', async (c) => {
      const input = parseMission(await c.req.json().catch(() => null));
      if (typeof input === 'string') return c.json({ error: input }, 400);
      if (!getStore(db, input.storeId)) return c.json({ error: 'Store not found' }, 404);
      const { id } = createMission(db, input);
      advanceSquadMissions(db); // starts its first steps and puts it on the live feed
      return c.json(getMission(db, id), 201);
    })
    .post('/api/squad-missions/:id/cancel', (c) => {
      if (!getMission(db, c.req.param('id'))) return c.json({ error: 'Mission not found' }, 404);
      const mission = cancelMission(db, c.req.param('id'), runs.cancel);
      if (!mission) return c.json({ error: 'This mission has already ended.' }, 409);
      publish({ type: 'mission', mission });
      return c.json(mission);
    })
    .get('/api/runs', (c) =>
      c.json(listRuns(db, { agentId: c.req.query('agent'), storeIds: c.req.query('stores')?.split(',').filter(Boolean), limit: limit(c.req.query('limit')) })),
    )
    .get('/api/runs/:id', (c) => {
      const run = runs.get(c.req.param('id'));
      return run ? c.json(run) : c.json({ error: 'Run not found' }, 404);
    })
    .post('/api/runs/:id/cancel', (c) => {
      const run = runs.cancel(c.req.param('id'));
      return run ? c.json(run) : c.json({ error: 'Run not found' }, 404);
    })
    .get('/api/stores/:id/memory', (c) => {
      if (!getStore(db, c.req.param('id'))) return c.json({ error: 'Store not found' }, 404);
      const q = c.req.query('q')?.trim().toLowerCase();
      const all = listMemory(db, c.req.param('id'));
      return c.json(q ? all.filter((m) => `${m.text} ${m.evidence ?? ''} ${m.tags.join(' ')}`.toLowerCase().includes(q)) : all);
    })
    .post('/api/stores/:id/memory', async (c) => {
      const storeId = c.req.param('id');
      if (!getStore(db, storeId)) return c.json({ error: 'Store not found' }, 404);
      const input = parseMemoryInput(await c.req.json().catch(() => null), false);
      if (typeof input === 'string') return c.json({ error: input }, 400);
      const { kind, text, ...rest } = input as MemoryInput;
      return c.json(writeMemory(db, { confidence: 0.8, ...rest, kind, text, storeId, agentId: 'owner' }), 201);
    })
    .patch('/api/memory/:id', async (c) => {
      const input = parseMemoryInput(await c.req.json().catch(() => null), true);
      if (typeof input === 'string') return c.json({ error: input }, 400);
      const memory = updateMemory(db, c.req.param('id'), input);
      return memory ? c.json(memory) : c.json({ error: 'Memory not found' }, 404);
    })
    .delete('/api/memory/:id', (c) => (deleteMemory(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Memory not found' }, 404)))
    .get('/api/knowledge', (c) => c.json(knowledgeIndex()))
    .get('/api/knowledge/:kind/:key', (c) => {
      const d = knowledgeDoc(c.req.param('kind'), c.req.param('key'));
      return d ? c.json(d) : c.json({ error: 'Not found' }, 404);
    })
    .put('/api/knowledge/:kind/:key', async (c) => {
      const markdown = ((await c.req.json().catch(() => null)) as { markdown?: unknown } | null)?.markdown;
      if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 50_000) return c.json({ error: 'markdown must be 1–50,000 characters' }, 400);
      const d = saveKnowledge(c.req.param('kind'), c.req.param('key'), markdown);
      return d ? c.json(d) : c.json({ error: 'Not found' }, 404);
    })
    .delete('/api/knowledge/:kind/:key', (c) => {
      const d = resetKnowledge(c.req.param('kind'), c.req.param('key'));
      if (d === 'custom') return c.json({ error: 'A custom niche pack has no shipped version to go back to' }, 400);
      return d ? c.json(d) : c.json({ error: 'Not found' }, 404);
    })
    .get('/api/niche-learnings', (c) => {
      const storeId = c.req.query('store');
      const store = storeId ? getStore(db, storeId) : undefined;
      if (storeId && !store) return c.json([]);
      return c.json(listNicheLearnings(db, store ? nicheKey(store) : c.req.query('niche') || undefined));
    })
    .delete('/api/niche-learnings/:id', (c) => (deleteNicheLearning(db, c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Learning not found' }, 404)))
    .route('/', pageRoutes(db, pushPage(db)))
    .route('/', issueRoutes(db))
    .route('/', flowRoutes(db))
    .route('/', gamificationRoutes(db))
    .route('/', creativeRoutes(db));
}
