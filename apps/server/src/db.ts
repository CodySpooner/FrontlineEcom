import { mkdirSync } from 'node:fs';
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
];

/** Opens (or creates) the DB and runs pending migrations. Default is in-memory, which is what tests use. */
export function openDb(file = ':memory:'): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
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
