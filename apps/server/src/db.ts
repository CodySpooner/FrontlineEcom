import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/** Numbered migrations: index + 1 = version, tracked in PRAGMA user_version. Append only, never edit a shipped one. */
export const MIGRATIONS = [
  /* 1 */ `
  CREATE TABLE stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    niche TEXT NOT NULL,
    niche_detail TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    timezone TEXT NOT NULL DEFAULT 'America/Chicago',
    color TEXT NOT NULL DEFAULT '#ff2a3a',
    connected INTEGER NOT NULL DEFAULT 0,
    demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE daily_metrics (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    revenue REAL NOT NULL DEFAULT 0,
    ad_spend REAL NOT NULL DEFAULT 0,
    cogs REAL NOT NULL DEFAULT 0,
    orders INTEGER NOT NULL DEFAULT 0,
    sessions INTEGER NOT NULL DEFAULT 0,
    add_to_carts INTEGER NOT NULL DEFAULT 0,
    checkouts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (store_id, date)
  );
  CREATE TABLE products (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    image TEXT,
    price REAL NOT NULL,
    compare_at REAL,
    cost REAL NOT NULL DEFAULT 0,
    inventory INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    PRIMARY KEY (store_id, id)
  );
  CREATE TABLE orders (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL,
    fulfillment_status TEXT NOT NULL,
    supplier TEXT,
    tracking TEXT,
    PRIMARY KEY (store_id, id)
  );
  CREATE INDEX orders_by_time ON orders (store_id, created_at);
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX events_by_time ON events (at);
  CREATE TABLE campaigns (
    network TEXT NOT NULL,
    id TEXT NOT NULL,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    daily_budget REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (network, id)
  );
  CREATE TABLE campaign_daily (
    network TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    date TEXT NOT NULL,
    spend REAL NOT NULL DEFAULT 0,
    revenue REAL NOT NULL DEFAULT 0,
    purchases INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (network, campaign_id, date),
    FOREIGN KEY (network, campaign_id) REFERENCES campaigns (network, id) ON DELETE CASCADE
  );
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    autonomy TEXT NOT NULL DEFAULT 'ask',
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    settings_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (store_id, role)
  );
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    run_id TEXT,
    title TEXT NOT NULL,
    reason TEXT NOT NULL,
    action_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX approvals_by_status ON approvals (status, created_at);
  `,
  /* 2 */ `
  CREATE TABLE integrations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'connected',
    error TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    encrypted_credentials TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  /* 3 */ `
  CREATE TABLE research_products (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    niche TEXT NOT NULL,
    image TEXT,
    source TEXT NOT NULL,
    cost REAL NOT NULL,
    price REAL NOT NULL,
    compare_at REAL NOT NULL,
    trend REAL NOT NULL,
    competition REAL NOT NULL,
    shipping_days INTEGER NOT NULL
  );
  CREATE TABLE product_lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE product_list_items (
    list_id TEXT NOT NULL REFERENCES product_lists(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES research_products(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (list_id, product_id)
  );
  `,
  /* 4 (agents lane: store memory, AGT-08) */ `
  CREATE TABLE store_memory (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    evidence TEXT,
    confidence REAL NOT NULL DEFAULT 0.5,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE INDEX store_memory_by_store ON store_memory (store_id, created_at);
  CREATE VIRTUAL TABLE store_memory_fts USING fts5(text, tags, content='store_memory', content_rowid='rowid', tokenize='porter unicode61');
  CREATE TRIGGER store_memory_ai AFTER INSERT ON store_memory BEGIN
    INSERT INTO store_memory_fts (rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
  END;
  CREATE TRIGGER store_memory_ad AFTER DELETE ON store_memory BEGIN
    INSERT INTO store_memory_fts (store_memory_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
  END;
  CREATE TRIGGER store_memory_au AFTER UPDATE OF text, tags ON store_memory BEGIN
    INSERT INTO store_memory_fts (store_memory_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
    INSERT INTO store_memory_fts (rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
  END;
  `,
  /* 5 */ `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  CREATE TABLE store_caps (
    store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    value_json TEXT NOT NULL
  );
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    link TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX notifications_by_time ON notifications (created_at);
  `,
  /* 6 */ `
  ALTER TABLE orders ADD COLUMN cogs REAL;
  ALTER TABLE orders ADD COLUMN local_date TEXT;
  ALTER TABLE integrations ADD COLUMN synced_at TEXT;
  ALTER TABLE integrations ADD COLUMN cursor TEXT;
  `,
  /* 7 (agents lane: agent runs, AGT-11) */ `
  CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    resume TEXT,
    session_id TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    error TEXT,
    transcript_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT
  );
  CREATE INDEX agent_runs_by_agent ON agent_runs (agent_id, created_at);
  CREATE INDEX agent_runs_by_status ON agent_runs (status, created_at);
  `,
  /* 8 */ `
  CREATE TABLE competitors (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE competitor_snapshots (
    id TEXT PRIMARY KEY,
    competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    data_json TEXT NOT NULL
  );
  CREATE INDEX competitor_snapshots_by_time ON competitor_snapshots (competitor_id, kind, captured_at);
  `,
  /* 9 */ `
  CREATE TABLE automation_rules (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    trigger_json TEXT NOT NULL,
    action_json TEXT NOT NULL,
    approval TEXT NOT NULL DEFAULT 'ask',
    max_runs_per_day INTEGER NOT NULL DEFAULT 3,
    cooldown_hours INTEGER NOT NULL DEFAULT 24,
    created_at TEXT NOT NULL,
    last_fired_at TEXT,
    checked_at TEXT
  );
  CREATE TABLE automation_runs (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    store_id TEXT NOT NULL,
    fired_at TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    run_id TEXT,
    approval_id TEXT
  );
  CREATE INDEX automation_runs_by_time ON automation_runs (store_id, fired_at);
  `,
  /* 10 (agents lane: XP ledger, AGT-13) */ `
  CREATE TABLE xp_events (
    id TEXT PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    agent_id TEXT,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX xp_events_by_agent ON xp_events (agent_id, created_at);
  `,
  /* 11 (agents lane: creatives library, AGT-15) */ `
  CREATE TABLE creatives (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    run_id TEXT,
    kind TEXT NOT NULL,
    aspect TEXT,
    prompt TEXT,
    headline TEXT NOT NULL,
    primary_text TEXT NOT NULL,
    cta TEXT,
    media_url TEXT,
    credits INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX creatives_by_store ON creatives (store_id, created_at);
  `,
  /* 12 (agents lane: squad delegation, AGT-22) */ `
  ALTER TABLE agent_runs ADD COLUMN parent_run_id TEXT;
  `,
  /* 13 */ `
  CREATE TABLE channel_daily (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    date TEXT NOT NULL,
    revenue REAL NOT NULL DEFAULT 0,
    orders INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (store_id, channel, date)
  );
  `,
  /* 14 (agents lane: niche learnings, AGT-24) */ `
  CREATE TABLE niche_learnings (
    id TEXT PRIMARY KEY,
    niche TEXT NOT NULL,
    text TEXT NOT NULL,
    evidence TEXT,
    store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX niche_learnings_text ON niche_learnings (niche, lower(text));
  `,
  /* 15 (agents lane: Store Builder drafts, AGT-26) */ `
  CREATE TABLE page_drafts (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    run_id TEXT,
    kind TEXT NOT NULL,
    product_id TEXT,
    title TEXT NOT NULL,
    html TEXT NOT NULL,
    seo_title TEXT,
    seo_description TEXT,
    notes TEXT NOT NULL,
    published_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX page_drafts_by_store ON page_drafts (store_id, created_at);
  `,
  /* 16 */ `
  CREATE TABLE order_items (
    store_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    revenue REAL NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (store_id, order_id, product_id),
    FOREIGN KEY (store_id, order_id) REFERENCES orders (store_id, id) ON DELETE CASCADE
  );
  `,
  /* 17 (agents lane: order issue queue, AGT-27) */ `
  CREATE TABLE order_issues (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    note TEXT NOT NULL,
    suggested_action TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    resolution TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE UNIQUE INDEX order_issues_open ON order_issues (store_id, order_id, kind) WHERE status = 'open';
  CREATE INDEX order_issues_by_store ON order_issues (store_id, status, created_at);
  `,
  /* 18 (agents lane: product tests, AGT-29) */ `
  CREATE TABLE product_tests (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    approval_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    added_on TEXT NOT NULL,
    judged_at TEXT,
    PRIMARY KEY (store_id, product_id)
  );
  `,
  /* 19 (agents lane: pinned memories, AGT-31) */ `
  ALTER TABLE store_memory ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
  `,
  /* 20 (agents lane: outcomes move the confidence of the run's learnings, AGT-32) */ `
  ALTER TABLE store_memory ADD COLUMN run_id TEXT;
  CREATE INDEX store_memory_by_run ON store_memory (run_id) WHERE run_id IS NOT NULL;
  CREATE TABLE memory_feedback (ref TEXT PRIMARY KEY, at TEXT NOT NULL);
  `,
  /* 21 (agents lane: one generic "done once" ledger, AGT-37) */ `
  ALTER TABLE memory_feedback RENAME TO done_once;
  `,
  /* 22 (agents lane: Email & SMS flow drafts, AGT-40) */ `
  CREATE TABLE flow_drafts (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    run_id TEXT,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    notes TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX flow_drafts_by_store ON flow_drafts (store_id, created_at);
  `,
  /* 23 (agents lane: price tests, AGT-42) */ `
  CREATE TABLE price_tests (
    approval_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL,
    from_price REAL NOT NULL,
    to_price REAL NOT NULL,
    changed_on TEXT NOT NULL,
    judged_at TEXT
  );
  `,
  /* 24 (core: action log, CORE-28) — no FK: the record outlives a deleted store */ `
  CREATE TABLE action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    error TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX action_log_by_store ON action_log (store_id, id);
  `,
  /* 25 (core: per-day order lookups; a 2-year first sync rebuilt revenue in 8 s, blocking the API, without it) */ `
  CREATE INDEX orders_by_day ON orders (store_id, local_date);
  `,
  /* 26 (core: a store's campaigns; per-day ad spend scanned all of campaign_daily, 4 s for a 2-year sync, without it) */ `
  CREATE INDEX campaigns_by_store ON campaigns (store_id);
  `,
  /* 27 (core: the owner's optional reason for a denial) */ `
  ALTER TABLE approvals ADD COLUMN decision_note TEXT;
  `,
];

/** Opens (or creates) the DB and runs pending migrations. Default is in-memory, which is what tests use. */
export function openDb(file = ':memory:'): Db {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
    // A restore staged by POST /api/backups/:name/restore replaces the database before it opens.
    if (existsSync(`${file}.restore`)) {
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
      renameSync(`${file}.restore`, file);
    }
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  MIGRATIONS.slice(version).forEach((sql, i) =>
    tx(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + i + 1}`);
    }),
  );
  return db;
}

export const dataDir = () => process.env.FRONTLINE_DATA_DIR ?? './.data';
export const dbFile = () => join(dataDir(), 'frontline.db');

/** True the first time it's called for `ref` in this data dir, false ever after (the `done_once` ledger). */
export const once = (db: Db, ref: string) => db.prepare('INSERT OR IGNORE INTO done_once (ref, at) VALUES (?, ?)').run(ref, new Date().toISOString()).changes > 0;

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
