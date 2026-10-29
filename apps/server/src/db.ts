import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { log } from './log';

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
  /* 28 (agents lane: generation credits spent, kept when a creative is deleted) */ `
  CREATE TABLE creative_credits (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    credits INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX creative_credits_by_store ON creative_credits (store_id, created_at);
  INSERT INTO creative_credits SELECT store_id, credits, created_at FROM creatives WHERE credits > 0;
  `,
  /* 29 (core: 0 when the platform doesn't track a product's stock, so its inventory 0 isn't "sold out") */ `
  ALTER TABLE products ADD COLUMN inventory_tracked INTEGER NOT NULL DEFAULT 1;
  `,
  /* 30 (core: the owner's fee estimate per store, subtracted from profit) */ `
  ALTER TABLE stores ADD COLUMN fee_percent REAL NOT NULL DEFAULT 0;
  ALTER TABLE stores ADD COLUMN fee_per_order REAL NOT NULL DEFAULT 0;
  `,
  /* 31 (core: Etsy and WooCommerce re-pull once, for listings that sold out or expired and products trashed before 29-30's syncs saw those states) */ `
  UPDATE integrations SET cursor = NULL WHERE kind IN ('etsy', 'woocommerce');
  `,
  /* 32 (core: sales tax / VAT in each order's total, netted from profit; Shopify, WooCommerce and Etsy re-pull once to fill it) */ `
  ALTER TABLE orders ADD COLUMN tax REAL NOT NULL DEFAULT 0;
  UPDATE integrations SET cursor = NULL WHERE kind IN ('shopify', 'woocommerce', 'etsy');
  `,
  /* 33 (core: TikTok Shop re-pulls once, so orders from before it read their tax have it too) */ `
  UPDATE integrations SET cursor = NULL WHERE kind = 'tiktok_shop';
  `,
  /* 34 (core: Amazon listings that count their own, merchant-fulfilled, stock; FBA reads leave those alone) */ `
  ALTER TABLE products ADD COLUMN merchant_stock INTEGER NOT NULL DEFAULT 0;
  `,
  /* 35 (ecosystem: persistent office seats; archiving never deletes an agent or its runs) */ `
  CREATE TABLE ecosystem_seats (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    desk_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    appearance_json TEXT NOT NULL,
    position_json TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ecosystem_active_desk ON ecosystem_seats (desk_id) WHERE archived = 0;
  `,
  /* 36 (agents: squad missions, multi-agent plans over agent runs; statuses are read off the runs) */ `
  CREATE TABLE squad_missions (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX squad_missions_by_store ON squad_missions (store_id, created_at);
  `,
  /* 37 (core: the carrier's tracking page, when the platform gives one) */ `
  ALTER TABLE orders ADD COLUMN tracking_url TEXT;
  `,
  /* 38 (core: Amazon refunds, one row per refunded order line; they count once their order is in the store's orders) */ `
  CREATE TABLE amazon_refunds (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (store_id, id)
  );
  `,
  /* 39 (core: the product of an Amazon refund line, for per-product numbers; NULL on lines read before) */ `
  ALTER TABLE amazon_refunds ADD COLUMN product_id TEXT;
  `,
  /* 40 (core: the tax a refund line gives back, on top of its amount; 0 where the platform doesn't split it out) */ `
  ALTER TABLE amazon_refunds ADD COLUMN tax REAL NOT NULL DEFAULT 0;
  `,
  /* 41 (core: refund lines by order, for rebuildRevenue's per-day join) */ `
  CREATE INDEX amazon_refunds_by_order ON amazon_refunds (store_id, order_id);
  `,
  /* 42 (core: the rate an order in another currency was first converted at, so later syncs don't re-price it; NULL = not locked) */ `
  ALTER TABLE orders ADD COLUMN fx_rate REAL;
  `,
  /* 43 (core: a custom-niche store's find, filed under niche 'other', keeps that niche's slug) */ `
  ALTER TABLE research_products ADD COLUMN niche_detail TEXT;
  `,
  /* 44 (kb: KB-02 the knowledge base. store_id NULL = General; per-workspace keys use coalesce, as NULLs never collide) */ `
  CREATE TABLE kb_categories (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES kb_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX kb_categories_name ON kb_categories (coalesce(store_id, ''), coalesce(parent_id, ''), lower(name));
  INSERT INTO kb_categories (id, name, position, created_at) SELECT column1, column2, column3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM (VALUES
    ('general-advertising', 'Advertising', 1), ('general-marketing', 'Marketing', 2), ('general-creative', 'Creative Strategy', 3),
    ('general-analytics', 'Analytics & Data', 4), ('general-product-research', 'Product Research', 5), ('general-cro', 'Conversion Optimization', 6),
    ('general-psychology', 'Consumer Psychology', 7), ('general-branding', 'Branding', 8), ('general-seo', 'SEO', 9),
    ('general-operations', 'E-Commerce Operations', 10), ('general-finance', 'Financial & Profitability Analysis', 11),
    ('general-retention', 'Customer Retention', 12), ('general-competitors', 'Competitor Research', 13), ('general-pricing', 'Sales & Pricing', 14),
    ('general-strategy', 'Business Strategy', 15), ('general-automation', 'Automation & AI Workflows', 16));
  CREATE TABLE kb_cards (
    seq INTEGER PRIMARY KEY, -- the FTS rowid: an implicit rowid may change in a VACUUM
    id TEXT NOT NULL UNIQUE,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES kb_categories(id),
    type TEXT NOT NULL,
    prev_type TEXT,
    stage TEXT NOT NULL DEFAULT 'hypothesis',
    status TEXT NOT NULL DEFAULT 'proposed',
    merged_into TEXT REFERENCES kb_cards(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    relevance TEXT NOT NULL DEFAULT '',
    application TEXT NOT NULL DEFAULT '',
    applies_to TEXT NOT NULL DEFAULT '',
    limits TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    author_id TEXT NOT NULL,
    origin TEXT NOT NULL, -- owner | research | agent | performance | promotion
    run_id TEXT,
    task_id TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    blocked_roles TEXT NOT NULL DEFAULT '[]', -- ["*"] = every role
    research_marked INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0,
    cited_count INTEGER NOT NULL DEFAULT 0,
    verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX kb_cards_title ON kb_cards (coalesce(store_id, ''), lower(title));
  CREATE INDEX kb_cards_by_store ON kb_cards (store_id, status, updated_at);
  CREATE INDEX kb_cards_by_category ON kb_cards (category_id);
  CREATE VIRTUAL TABLE kb_cards_fts USING fts5(title, summary, body, tags, content='kb_cards', content_rowid='seq', tokenize='porter unicode61');
  CREATE TRIGGER kb_cards_ai AFTER INSERT ON kb_cards BEGIN
    INSERT INTO kb_cards_fts (rowid, title, summary, body, tags) VALUES (new.seq, new.title, new.summary, new.body, new.tags);
  END;
  CREATE TRIGGER kb_cards_ad AFTER DELETE ON kb_cards BEGIN
    INSERT INTO kb_cards_fts (kb_cards_fts, rowid, title, summary, body, tags) VALUES ('delete', old.seq, old.title, old.summary, old.body, old.tags);
  END;
  CREATE TRIGGER kb_cards_au AFTER UPDATE OF title, summary, body, tags ON kb_cards BEGIN
    INSERT INTO kb_cards_fts (kb_cards_fts, rowid, title, summary, body, tags) VALUES ('delete', old.seq, old.title, old.summary, old.body, old.tags);
    INSERT INTO kb_cards_fts (rowid, title, summary, body, tags) VALUES (new.seq, new.title, new.summary, new.body, new.tags);
  END;
  CREATE TABLE kb_revisions (
    id INTEGER PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    reason TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, -- the card after this change; restoring one applies it as a new revision
    created_at TEXT NOT NULL
  );
  CREATE INDEX kb_revisions_by_card ON kb_revisions (card_id, id);
  CREATE TABLE kb_sources (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, -- url | text | document
    url TEXT,
    title TEXT NOT NULL DEFAULT '',
    published_at TEXT,
    fetched_at TEXT,
    status TEXT NOT NULL,
    reliability TEXT NOT NULL DEFAULT 'unknown',
    reliability_by_owner INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT,
    text TEXT, -- the readable text, kept in the DB so backups hold it
    excerpt TEXT NOT NULL DEFAULT '',
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX kb_sources_url ON kb_sources (coalesce(store_id, ''), url) WHERE url IS NOT NULL;
  CREATE INDEX kb_sources_by_hash ON kb_sources (coalesce(store_id, ''), content_hash);
  CREATE TABLE kb_observations (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    ref TEXT NOT NULL UNIQUE, -- what was measured over which window: recorded once
    subject TEXT NOT NULL, -- e.g. campaign:meta:123, store, product:abc
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    baseline REAL,
    window_from TEXT NOT NULL,
    window_to TEXT NOT NULL,
    sample_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE kb_evidence (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    source_id TEXT REFERENCES kb_sources(id) ON DELETE SET NULL,
    observation_id TEXT REFERENCES kb_observations(id) ON DELETE CASCADE,
    metric TEXT,
    value REAL,
    baseline REAL,
    window_from TEXT,
    window_to TEXT,
    sample_size INTEGER,
    test_ref TEXT, -- the test it came from: Validated needs two different ones
    merged_from TEXT, -- the card it came with in a merge, so it can be detached again
    author_id TEXT NOT NULL,
    run_id TEXT,
    task_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX kb_evidence_by_card ON kb_evidence (card_id);
  CREATE TABLE kb_links (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE, -- a store card's link to a General one is the store's
    from_id TEXT NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    why TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'suggested',
    score REAL,
    author_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE UNIQUE INDEX kb_links_pair ON kb_links (from_id, to_id, type);
  CREATE INDEX kb_links_to ON kb_links (to_id);
  CREATE TABLE kb_conflicts (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
    other_card_id TEXT REFERENCES kb_cards(id) ON DELETE CASCADE,
    evidence_id TEXT REFERENCES kb_evidence(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open', -- open | resolved | kept_both
    task_id TEXT, -- found by this research task: it doesn't start research again
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX kb_conflicts_by_card ON kb_conflicts (card_id);
  CREATE TABLE kb_positions (
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE, -- the workspace whose artboard it is
    card_id TEXT NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
    x REAL NOT NULL,
    y REAL NOT NULL
  );
  CREATE UNIQUE INDEX kb_positions_card ON kb_positions (coalesce(store_id, ''), card_id);
  CREATE TABLE kb_views (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    state_json TEXT NOT NULL, -- filters, viewport, collapsed frames
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX kb_views_name ON kb_views (coalesce(store_id, ''), lower(name));
  CREATE TABLE kb_tasks (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE, -- where the findings go
    payer_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE, -- whose agent and AI budget run it
    role TEXT NOT NULL,
    kind TEXT NOT NULL, -- source | topic
    origin TEXT NOT NULL, -- owner | agent | autonomous
    objective TEXT NOT NULL,
    brief_json TEXT NOT NULL DEFAULT '{}',
    category_id TEXT REFERENCES kb_categories(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed | cancelled
    stage TEXT NOT NULL DEFAULT 'created',
    attempt INTEGER NOT NULL DEFAULT 0,
    next_try_at TEXT,
    budget_usd REAL NOT NULL,
    spent_usd REAL NOT NULL DEFAULT 0,
    refined_from TEXT REFERENCES kb_tasks(id) ON DELETE SET NULL,
    report_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT
  );
  CREATE INDEX kb_tasks_by_status ON kb_tasks (status, created_at);
  CREATE INDEX kb_tasks_by_store ON kb_tasks (store_id, created_at);
  CREATE TABLE kb_task_steps (
    task_id TEXT NOT NULL REFERENCES kb_tasks(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL, -- running | done | failed
    output_json TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    PRIMARY KEY (task_id, stage, attempt)
  );
  CREATE TABLE kb_task_log (
    id INTEGER PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES kb_tasks(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    level TEXT NOT NULL, -- info | warn | error
    message TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX kb_task_log_by_task ON kb_task_log (task_id, id);
  CREATE TABLE kb_task_sources (
    task_id TEXT NOT NULL REFERENCES kb_tasks(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, source_id)
  );
  CREATE TABLE kb_findings (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES kb_tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    data_json TEXT NOT NULL, -- the proposed card: summary, body, type, category path, source ids
    assessment_json TEXT, -- the evaluation per spec §5 criterion
    status TEXT NOT NULL DEFAULT 'pending', -- pending | stored | merged | rejected | discarded
    card_id TEXT REFERENCES kb_cards(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX kb_findings_by_task ON kb_findings (task_id);
  CREATE TABLE kb_experiments (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    plan_json TEXT NOT NULL, -- variants, window, minimum sample, linked campaigns and creatives
    status TEXT NOT NULL DEFAULT 'planned',
    result_json TEXT,
    created_at TEXT NOT NULL,
    evaluated_at TEXT
  );
  CREATE TABLE kb_retrievals (
    id INTEGER PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE, -- the store whose agent used it
    run_id TEXT,
    agent_id TEXT NOT NULL,
    kind TEXT NOT NULL, -- prompt | search | cited
    at TEXT NOT NULL
  );
  CREATE INDEX kb_retrievals_by_card ON kb_retrievals (card_id, at);
  CREATE TABLE kb_controls (
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX kb_controls_ws ON kb_controls (coalesce(store_id, ''));
  `,
  /* 45 (kb: KB-02 a run's mode; 'research' runs are a research task's stages) */ `
  ALTER TABLE agent_runs ADD COLUMN mode TEXT;
  `,
  /* 46 (kb: KB-04 the owner set this card's stage: the app's ladder leaves it there) */ `
  ALTER TABLE kb_cards ADD COLUMN stage_by_owner INTEGER NOT NULL DEFAULT 0;
  `,
  /* 47 (kb: KB-20 ad-level results beside the campaign totals, never in rebuildAdSpend; what a creative is: format, hook, angle, length, offer) */ `
  CREATE TABLE ads (
    network TEXT NOT NULL,
    id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    group_id TEXT, -- its ad set (Meta) or ad group (Google, TikTok): the people it's shown to
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    copy TEXT, -- the ad's text as the network returns it: how a library creative is found in it
    creative_id TEXT REFERENCES creatives(id) ON DELETE SET NULL,
    PRIMARY KEY (network, id),
    FOREIGN KEY (network, campaign_id) REFERENCES campaigns (network, id) ON DELETE CASCADE
  );
  CREATE INDEX ads_by_campaign ON ads (network, campaign_id);
  CREATE INDEX ads_by_creative ON ads (creative_id);
  CREATE TABLE ad_daily (
    network TEXT NOT NULL,
    ad_id TEXT NOT NULL,
    date TEXT NOT NULL,
    spend REAL NOT NULL DEFAULT 0,
    revenue REAL NOT NULL DEFAULT 0,
    purchases INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (network, ad_id, date),
    FOREIGN KEY (network, ad_id) REFERENCES ads (network, id) ON DELETE CASCADE
  );
  ALTER TABLE creatives ADD COLUMN format TEXT;
  ALTER TABLE creatives ADD COLUMN hook TEXT;
  ALTER TABLE creatives ADD COLUMN angle TEXT;
  ALTER TABLE creatives ADD COLUMN length_s INTEGER;
  ALTER TABLE creatives ADD COLUMN offer TEXT;
  `,
  /* 48 (kb: KB-25 a workspace's links, sources, positions, categories and open conflicts, and a payer's research, by index) */ `
  CREATE INDEX kb_links_by_store ON kb_links (store_id);
  CREATE INDEX kb_sources_by_store ON kb_sources (store_id);
  CREATE INDEX kb_positions_by_store ON kb_positions (store_id);
  CREATE INDEX kb_categories_by_store ON kb_categories (store_id);
  CREATE INDEX kb_conflicts_open ON kb_conflicts (store_id, status);
  CREATE INDEX kb_tasks_by_payer ON kb_tasks (payer_id, created_at);
  `,
  /* 49 (gamification removed: the XP ledger and agent levels; its index drops with the table) */ `
  DROP TABLE IF EXISTS xp_events;
  ALTER TABLE agents DROP COLUMN level;
  ALTER TABLE agents DROP COLUMN xp;
  `,
  /* 50 (ai-agents: AA-02 custom roles, configured agents, presets, conversations, what each run ran with, team sessions) */ `
  CREATE TABLE agent_custom_roles (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE, -- NULL: every store
    base_role TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    tools_json TEXT, -- the narrowed tool list; NULL: the base role's tools
    created_at TEXT NOT NULL,
    archived_at TEXT
  );
  CREATE INDEX agent_custom_roles_by_store ON agent_custom_roles (store_id);
  CREATE TABLE agent_configs (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, -- the store:role seat (autonomy, daily budget)
    custom_role_id TEXT, -- an agent_custom_roles id or a builtin: type, checked by validateConfig
    runtime TEXT NOT NULL,
    model TEXT,
    effort TEXT,
    tools_json TEXT NOT NULL,
    knowledge_json TEXT NOT NULL,
    permissions_json TEXT NOT NULL, -- limits, save-findings mode: names and numbers, never credentials
    created_at TEXT NOT NULL
  );
  CREATE INDEX agent_configs_by_store ON agent_configs (store_id);
  CREATE TABLE agent_presets (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE, -- NULL: every store
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    config_id TEXT NOT NULL REFERENCES agent_configs(id),
    title TEXT NOT NULL,
    context_json TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT,
    client_request_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX conversations_request ON conversations (store_id, client_request_id) WHERE client_request_id IS NOT NULL;
  CREATE INDEX conversations_by_store ON conversations (store_id, archived_at, last_activity_at);
  CREATE VIRTUAL TABLE conversations_fts USING fts5(title, text, store_id UNINDEXED, conversation_id UNINDEXED, tokenize='porter unicode61');
  ALTER TABLE agent_runs ADD COLUMN conversation_id TEXT REFERENCES conversations(id);
  ALTER TABLE agent_runs ADD COLUMN team_id TEXT; -- a kind-'team' squad mission's step run
  ALTER TABLE agent_runs ADD COLUMN config_id TEXT REFERENCES agent_configs(id);
  ALTER TABLE agent_runs ADD COLUMN runtime TEXT;
  ALTER TABLE agent_runs ADD COLUMN model TEXT;
  ALTER TABLE agent_runs ADD COLUMN effort TEXT;
  ALTER TABLE agent_runs ADD COLUMN runtime_version TEXT;
  ALTER TABLE agent_runs ADD COLUMN client_request_id TEXT;
  ALTER TABLE agent_runs ADD COLUMN actual_model TEXT;
  ALTER TABLE agent_runs ADD COLUMN effort_applied TEXT;
  ALTER TABLE agent_runs ADD COLUMN attachments_json TEXT;
  CREATE INDEX agent_runs_by_conversation ON agent_runs (conversation_id, created_at);
  CREATE UNIQUE INDEX agent_runs_request ON agent_runs (conversation_id, client_request_id) WHERE client_request_id IS NOT NULL;
  CREATE UNIQUE INDEX agent_runs_team_request ON agent_runs (team_id, client_request_id) WHERE team_id IS NOT NULL AND client_request_id IS NOT NULL;
  ALTER TABLE squad_missions ADD COLUMN kind TEXT;
  ALTER TABLE squad_missions ADD COLUMN objective TEXT;
  ALTER TABLE squad_missions ADD COLUMN participants_json TEXT;
  ALTER TABLE squad_missions ADD COLUMN budget_usd REAL;
  ALTER TABLE squad_missions ADD COLUMN max_concurrent INTEGER;
  ALTER TABLE squad_missions ADD COLUMN retries INTEGER;
  ALTER TABLE squad_missions ADD COLUMN conversation_id TEXT REFERENCES conversations(id);
  ALTER TABLE squad_missions ADD COLUMN owner_notes_json TEXT;
  `,
  /* 51 (product-research: PR-02 the shared catalog, evidence, sources and jobs; each store's evaluations, tasks, reports and watches) */ `
  CREATE TABLE pr_products (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT,
    image_ref TEXT,
    merged_into TEXT REFERENCES pr_products(id), -- a merge keeps both rows and every listing
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE pr_listings (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE, -- NULL: shared; set: that store's private row (a pasted link, an agent find)
    source TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    url TEXT,
    canonical_url TEXT,
    title TEXT NOT NULL,
    category TEXT,
    image_ref TEXT,
    origin TEXT NOT NULL, -- ingest | import | owner_link | agent_find | legacy_sample | fixture
    currency TEXT,
    region TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    retrieved_at TEXT,
    raw_hash TEXT,
    transform_json TEXT,
    status TEXT NOT NULL DEFAULT 'active' -- active | gone | blocked
  );
  CREATE UNIQUE INDEX pr_listings_ref ON pr_listings (source, source_ref, ifnull(store_id, ''));
  CREATE INDEX pr_listings_by_product ON pr_listings (product_id);
  CREATE INDEX pr_listings_by_canonical ON pr_listings (canonical_url);
  CREATE INDEX pr_listings_by_store ON pr_listings (store_id);
  CREATE TABLE pr_variants (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES pr_listings(id) ON DELETE CASCADE,
    source_ref TEXT NOT NULL,
    sku TEXT,
    gtin TEXT,
    mpn TEXT,
    attributes_json TEXT,
    weight_g REAL,
    dimensions_json TEXT,
    UNIQUE (listing_id, source_ref)
  );
  CREATE INDEX pr_variants_by_sku ON pr_variants (sku);
  CREATE TABLE pr_offers ( -- one observation: a new check inserts a row, the latest per key is current
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES pr_listings(id) ON DELETE CASCADE,
    variant_id TEXT REFERENCES pr_variants(id) ON DELETE CASCADE,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE, -- set: an owner-entered offer, private
    supplier TEXT NOT NULL,
    destination TEXT, -- ISO country the quote is for
    quantity INTEGER NOT NULL DEFAULT 1,
    method TEXT, -- shipping method
    unit_cost_minor INTEGER, -- NULL: unknown, never 0
    shipping_cost_minor INTEGER,
    currency TEXT,
    delivery_days_min INTEGER,
    delivery_days_max INTEGER,
    processing_days INTEGER,
    moq INTEGER,
    ships_from TEXT,
    stock_json TEXT, -- per warehouse
    restrictions TEXT,
    returns_note TEXT,
    provenance TEXT NOT NULL, -- live | import | owner | supplier_claim | fixture
    checked_at TEXT NOT NULL
  );
  CREATE INDEX pr_offers_by_listing ON pr_offers (listing_id, destination, checked_at);
  CREATE TABLE pr_signals ( -- one observation set: a Trends export, an order history, a manual note
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES pr_products(id), -- a product-scope set; query and category sets link through pr_signal_links
    platform TEXT NOT NULL,
    query TEXT,
    region TEXT,
    period_start TEXT,
    period_end TEXT,
    granularity TEXT, -- day | week | month
    metric TEXT NOT NULL,
    scope TEXT NOT NULL, -- product | query | category
    origin TEXT NOT NULL, -- live | import | manual | fixture
    file_ref TEXT,
    note TEXT,
    url TEXT,
    retrieved_at TEXT NOT NULL
  );
  CREATE INDEX pr_signals_by_product ON pr_signals (product_id);
  CREATE TABLE pr_signal_points (
    signal_id TEXT NOT NULL REFERENCES pr_signals(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    value REAL NOT NULL,
    below_one INTEGER NOT NULL DEFAULT 0, -- Trends "<1"
    PRIMARY KEY (signal_id, at)
  );
  CREATE TABLE pr_signal_links (
    signal_id TEXT NOT NULL REFERENCES pr_signals(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    confirmed_at TEXT, -- NULL: suggested by a query match, not confirmed by the owner
    created_at TEXT NOT NULL,
    PRIMARY KEY (signal_id, product_id)
  );
  CREATE INDEX pr_signal_links_by_product ON pr_signal_links (product_id);
  CREATE TABLE pr_matches (
    id TEXT PRIMARY KEY,
    listing_a TEXT NOT NULL REFERENCES pr_listings(id) ON DELETE CASCADE,
    listing_b TEXT NOT NULL REFERENCES pr_listings(id) ON DELETE CASCADE,
    verdict TEXT NOT NULL, -- exact | similar | separate
    matching_json TEXT,
    differing_json TEXT,
    decided_by TEXT NOT NULL, -- rule | owner
    reason TEXT,
    decided_at TEXT NOT NULL,
    UNIQUE (listing_a, listing_b)
  );
  CREATE TABLE pr_product_facts ( -- the Rank step's output: every discovery sort and filter reads it
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    destination TEXT NOT NULL,
    currency TEXT NOT NULL,
    cost_ship_minor INTEGER,
    cost_ship_offer_id TEXT,
    fulfillment_status TEXT,
    fulfillment_checked_at TEXT,
    demand_class TEXT,
    momentum REAL,
    demand_set_id TEXT,
    first_seen_at TEXT,
    evidence_at TEXT,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (product_id, destination, currency)
  );
  CREATE INDEX pr_facts_cost ON pr_product_facts (destination, currency, cost_ship_minor);
  CREATE INDEX pr_facts_momentum ON pr_product_facts (destination, currency, momentum);
  CREATE INDEX pr_facts_seen ON pr_product_facts (destination, currency, first_seen_at);
  CREATE INDEX pr_facts_evidence ON pr_product_facts (destination, currency, evidence_at);
  CREATE INDEX pr_facts_demand ON pr_product_facts (destination, currency, demand_class);
  CREATE INDEX pr_facts_fulfillment ON pr_product_facts (destination, currency, fulfillment_status);
  CREATE TABLE pr_sources (
    id TEXT PRIMARY KEY, -- the adapter id
    status TEXT NOT NULL,
    last_success_at TEXT,
    last_attempt_at TEXT,
    last_error TEXT,
    error_kind TEXT, -- auth | rate_limit | quota | timeout | server | schema
    quota_json TEXT,
    cursor_json TEXT,
    schema_hash TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE pr_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    status TEXT NOT NULL, -- queued | running | done | failed | stopped
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    checkpoint_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX pr_jobs_due ON pr_jobs (status, next_attempt_at);
  CREATE TABLE pr_calls ( -- every call to a metered source: the caps count these
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    purpose TEXT NOT NULL, -- token | ingestion | search | watch | order_sync | owner
    at TEXT NOT NULL,
    ok INTEGER NOT NULL
  );
  CREATE INDEX pr_calls_by_source ON pr_calls (source, at);
  CREATE TABLE pr_store_profiles (
    store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    audience TEXT,
    price_min_minor INTEGER,
    price_max_minor INTEGER,
    price_currency TEXT,
    ship_to TEXT,
    warehouses_json TEXT,
    max_delivery_days INTEGER,
    avoid_categories_json TEXT,
    avoid_terms_json TEXT,
    include_categories_json TEXT,
    keywords_json TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE pr_evaluations (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    stage TEXT NOT NULL DEFAULT 'discovered',
    owner TEXT,
    fit TEXT, -- strong | medium | weak | unknown
    fit_reasons_json TEXT,
    flags_json TEXT,
    flag_dismissals_json TEXT,
    notes TEXT,
    selling_price_minor INTEGER, -- set by the owner
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (store_id, product_id)
  );
  CREATE INDEX pr_evaluations_stage ON pr_evaluations (store_id, stage);
  CREATE INDEX pr_evaluations_fit ON pr_evaluations (store_id, fit);
  CREATE TABLE pr_stage_history (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    kind TEXT NOT NULL DEFAULT 'stage', -- stage | watch | flag | merge | separate | offer | evidence
    from_stage TEXT,
    to_stage TEXT,
    reason TEXT,
    by TEXT NOT NULL, -- owner, or the research task id
    at TEXT NOT NULL
  );
  CREATE INDEX pr_stage_history_by_product ON pr_stage_history (store_id, product_id, at);
  CREATE TABLE pr_tasks (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    listing_id TEXT REFERENCES pr_listings(id),
    url TEXT, -- as pasted
    preview_json TEXT, -- the preview with the owner's corrections, each field tagged with its origin
    instructions TEXT NOT NULL, -- exactly as typed
    template TEXT,
    mode TEXT NOT NULL, -- new | queue | separate
    type TEXT NOT NULL, -- the agent type: product_hunter or a custom role built on it
    conversation_id TEXT,
    run_id TEXT,
    config_id TEXT,
    not_started_reason TEXT,
    client_request_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (store_id, client_request_id)
  );
  CREATE INDEX pr_tasks_by_product ON pr_tasks (store_id, product_id, created_at);
  CREATE INDEX pr_tasks_by_run ON pr_tasks (run_id);
  CREATE TABLE pr_reports ( -- append-only: never edited or deleted
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES pr_tasks(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    run_id TEXT NOT NULL UNIQUE,
    runtime TEXT,
    engine TEXT,
    recommendation TEXT NOT NULL,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX pr_reports_by_product ON pr_reports (store_id, product_id, created_at);
  CREATE TABLE pr_economics (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    inputs_json TEXT NOT NULL, -- base, conservative and optimistic, each input with its provenance
    updated_at TEXT NOT NULL,
    PRIMARY KEY (store_id, product_id)
  );
  CREATE TABLE pr_comparisons (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    product_ids_json TEXT NOT NULL,
    assumptions_json TEXT NOT NULL, -- one destination, currency, date and cost assumptions for every product
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE pr_briefs (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    fields_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX pr_briefs_by_product ON pr_briefs (store_id, product_id);
  CREATE TABLE pr_outcomes (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES pr_products(id),
    kind TEXT NOT NULL, -- product_test | store_product | experiment | kb_card
    ref_id TEXT NOT NULL,
    context_json TEXT, -- offer, audience, creative, spend, inventory, period
    created_at TEXT NOT NULL,
    UNIQUE (store_id, product_id, kind, ref_id)
  );
  CREATE TABLE pr_watches (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE, -- NULL: the owner's all-stores list
    list_name TEXT NOT NULL DEFAULT 'Watchlist',
    target_kind TEXT NOT NULL, -- listing | product | niche | offer
    target_id TEXT NOT NULL,
    prefs_json TEXT,
    last_checked_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX pr_watches_target ON pr_watches (ifnull(store_id, ''), list_name, target_kind, target_id);
  CREATE TABLE pr_alerts (
    id TEXT PRIMARY KEY,
    watch_id TEXT NOT NULL REFERENCES pr_watches(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    dedupe_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (watch_id, dedupe_key)
  );
  `,
  /* 52 (product-research: PR-06 the owner's uploaded files, kept as sent; a seasonal set's peak month) */ `
  CREATE TABLE pr_files ( -- a Google Trends export or a supplier feed the owner uploaded; pr_signals.file_ref points here
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL, -- trends | feed
    name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (kind, sha256)
  );
  ALTER TABLE pr_product_facts ADD COLUMN demand_peak_month INTEGER; -- 1-12 when demand_class is seasonal
  `,
  /* 53 (product-research: PR-09 what discovery filters, sorts and counts on, kept by Rank and Evaluate) */ `
  ALTER TABLE pr_product_facts ADD COLUMN demand_sets INTEGER NOT NULL DEFAULT 0; -- qualifying shared sets (decision 9)
  ALTER TABLE pr_product_facts ADD COLUMN unit_minor INTEGER; -- the cost + ship row's unit cost, converted
  ALTER TABLE pr_product_facts ADD COLUMN ship_minor INTEGER; -- and its shipping cost
  ALTER TABLE pr_product_facts ADD COLUMN delivery_days INTEGER; -- the fastest shippable row's upper bound
  ALTER TABLE pr_product_facts ADD COLUMN rule_flags INTEGER; -- decision 10's flags on the shared title and category
  ALTER TABLE pr_evaluations ADD COLUMN in_scope INTEGER; -- 1 in the included categories (or none set), 0 outside, NULL category unknown
  ALTER TABLE pr_evaluations ADD COLUMN open_flags INTEGER NOT NULL DEFAULT 0; -- flags not dismissed
  CREATE INDEX pr_facts_delivery ON pr_product_facts (destination, currency, delivery_days);
  CREATE INDEX pr_facts_demand_sets ON pr_product_facts (destination, currency, demand_sets);
  CREATE INDEX pr_evaluations_scope ON pr_evaluations (store_id, in_scope);
  CREATE INDEX pr_products_category ON pr_products (category);
  CREATE INDEX pr_watches_by_target ON pr_watches (target_id);
  `,
  /* 54 (product-research: PR-20 a merge moves listings and remembers where from, so Separate can move them back) */ `
  ALTER TABLE pr_listings ADD COLUMN merged_from TEXT REFERENCES pr_products(id); -- the product a merge moved it from
  `,
  /* 55 (product-research: PR-21 a watch keeps its last check's result, which the next check compares with) */ `
  ALTER TABLE pr_watches ADD COLUMN state_json TEXT;
  `,
  /* 56 (store-analytics: SA-07 ledger, catalog, sources). New columns are NULL = unknown (no defaults). Money columns on
     orders are the as-placed amounts; refunds live only in the refunds ledger (decision 9). */ `
  ALTER TABLE orders ADD COLUMN source_kind TEXT;
  ALTER TABLE orders ADD COLUMN source_id TEXT;
  ALTER TABLE orders ADD COLUMN channel TEXT;
  ALTER TABLE orders ADD COLUMN channel_order_id TEXT;
  ALTER TABLE orders ADD COLUMN duplicate_of TEXT;
  ALTER TABLE orders ADD COLUMN customer_ref TEXT;
  ALTER TABLE orders ADD COLUMN customer_state TEXT;
  ALTER TABLE orders ADD COLUMN country TEXT;
  ALTER TABLE orders ADD COLUMN currency TEXT;
  ALTER TABLE orders ADD COLUMN gross_sales REAL;
  ALTER TABLE orders ADD COLUMN discounts REAL;
  ALTER TABLE orders ADD COLUMN shipping REAL;
  ALTER TABLE orders ADD COLUMN paid_at TEXT;
  ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
  ALTER TABLE orders ADD COLUMN fulfilled_at TEXT;
  ALTER TABLE orders ADD COLUMN delivered_at TEXT;
  ALTER TABLE orders ADD COLUMN source_updated_at TEXT;
  ALTER TABLE orders ADD COLUMN breakdown_at TEXT;
  CREATE INDEX orders_by_channel_id ON orders (store_id, channel, channel_order_id) WHERE channel_order_id IS NOT NULL;
  CREATE INDEX orders_by_customer ON orders (store_id, customer_ref) WHERE customer_ref IS NOT NULL;
  ALTER TABLE products ADD COLUMN category TEXT;
  ALTER TABLE products ADD COLUMN handle TEXT;
  ALTER TABLE products ADD COLUMN synced_at TEXT;
  ALTER TABLE daily_metrics ADD COLUMN purchase_sessions INTEGER;
  CREATE TABLE refunds ( -- one row per refund line; no FK to orders: a refund can arrive before its order
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    refund_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    product_id TEXT,
    variant_id TEXT,
    refunded_at TEXT NOT NULL,
    local_date TEXT NOT NULL,
    merchandise REAL,
    shipping REAL,
    tax REAL,
    other REAL,
    quantity INTEGER,
    restocked INTEGER,
    source TEXT NOT NULL,
    PRIMARY KEY (store_id, id)
  );
  CREATE INDEX refunds_by_day ON refunds (store_id, local_date);
  CREATE INDEX refunds_by_order ON refunds (store_id, order_id);
  CREATE INDEX refunds_by_product ON refunds (store_id, product_id);
  CREATE TABLE order_fees (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT,
    local_date TEXT,
    source TEXT NOT NULL,
    PRIMARY KEY (store_id, order_id, kind, source)
  );
  CREATE INDEX order_fees_by_day ON order_fees (store_id, local_date);
  CREATE TABLE order_lines (
    store_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    line_id TEXT NOT NULL,
    product_id TEXT,
    variant_id TEXT,
    sku TEXT,
    quantity INTEGER NOT NULL,
    gross REAL NOT NULL,
    discount REAL,
    cost REAL,
    cost_source TEXT,
    owner_backfill INTEGER,
    PRIMARY KEY (store_id, order_id, line_id),
    FOREIGN KEY (store_id, order_id) REFERENCES orders (store_id, id) ON DELETE CASCADE
  );
  CREATE INDEX order_lines_by_product ON order_lines (store_id, product_id);
  CREATE INDEX order_lines_by_variant ON order_lines (store_id, variant_id);
  CREATE TABLE product_variants (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT,
    sku TEXT,
    price REAL,
    compare_at REAL,
    inventory INTEGER,
    inventory_tracked INTEGER,
    inventory_policy TEXT,
    status TEXT,
    synced_at TEXT,
    PRIMARY KEY (store_id, id)
  );
  CREATE INDEX product_variants_by_product ON product_variants (store_id, product_id);
  CREATE TABLE channel_listings ( -- current state only: no publication history (decision 21)
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    id TEXT NOT NULL,
    product_id TEXT,
    variant_id TEXT,
    status TEXT,
    error TEXT,
    published_at TEXT,
    synced_at TEXT,
    PRIMARY KEY (store_id, channel, id)
  );
  CREATE INDEX channel_listings_by_product ON channel_listings (store_id, product_id);
  CREATE TABLE product_links ( -- a channel's product rolled into the store's (decision 22): a platform id or the owner's mapping
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    channel_product_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('platform_id', 'owner')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (store_id, channel, channel_product_id)
  );
  CREATE TABLE product_collections (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    title TEXT,
    source TEXT,
    synced_at TEXT,
    PRIMARY KEY (store_id, collection_id, product_id)
  );
  CREATE INDEX product_collections_by_product ON product_collections (store_id, product_id);
  CREATE TABLE unit_costs ( -- effective-dated: a new cost never rewrites a past one (decision 15)
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    cost REAL NOT NULL,
    currency TEXT,
    source TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX unit_costs_by_product ON unit_costs (store_id, product_id, effective_from);
  CREATE TABLE inventory_snapshots ( -- point in time: one value per variant and day, never summed across days
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    variant_id TEXT NOT NULL,
    date TEXT NOT NULL,
    quantity INTEGER,
    tracked INTEGER,
    PRIMARY KEY (store_id, variant_id, date)
  );
  CREATE TABLE sync_runs (
    id INTEGER PRIMARY KEY,
    integration_id TEXT NOT NULL,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    error TEXT
  );
  CREATE INDEX sync_runs_by_integration ON sync_runs (integration_id, started_at);
  CREATE INDEX sync_runs_by_store ON sync_runs (store_id, started_at);
  CREATE TABLE source_datasets (
    integration_id TEXT NOT NULL,
    dataset TEXT NOT NULL,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    status TEXT,
    last_try_at TEXT,
    last_success_at TEXT,
    error TEXT,
    covered_from TEXT,
    covered_to TEXT,
    verified_at TEXT,
    verified_account TEXT,
    verified_note TEXT,
    PRIMARY KEY (integration_id, dataset)
  );
  CREATE INDEX source_datasets_by_store ON source_datasets (store_id);
  CREATE TABLE fx_rates ( -- ECB reference rates per day: EUR → currency (decision 19)
    date TEXT NOT NULL,
    currency TEXT NOT NULL,
    rate REAL NOT NULL,
    PRIMARY KEY (date, currency)
  );
  CREATE TABLE traffic_breakdown_daily (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    sessions INTEGER,
    purchase_sessions INTEGER,
    source TEXT,
    PRIMARY KEY (store_id, date, dimension, value)
  );
  `,
];

/** Opens (or creates) the DB and runs pending migrations. Default is in-memory, which is what tests use. */
export function openDb(file = ':memory:'): Db {
  let restored = false;
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
    // A restore staged by POST /api/backups/:name/restore replaces the database before it opens.
    if (existsSync(`${file}.restore`)) {
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
      renameSync(`${file}.restore`, file);
      restored = true;
    }
    rmSync(`${file}.restore.part`, { force: true }); // a restore the app quit during: never staged
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  // An update's migrations change the owner's data: a copy from just before goes with the backups (Settings can restore it).
  if (file !== ':memory:' && version > 0 && version < MIGRATIONS.length) {
    const copy = join(dirname(file), 'backups', `frontline-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}-before-update.db`);
    try {
      mkdirSync(dirname(copy), { recursive: true });
      db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    } catch (e) {
      log('error', 'backup before update failed', { error: e instanceof Error ? e.message : String(e) }); // the daily backups remain
    }
  }
  MIGRATIONS.slice(version).forEach((sql, i) =>
    tx(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + i + 1}`);
    }),
  );
  // A real store's requests pending in the backup may have been carried out since (a page published, products added):
  // asked again, not run twice. `[Expired: …]` isn't the owner's no. They're announced once the server's handlers listen
  // (announceRestoreClosed), so a closed theme draft's copy is deleted like any denied one's.
  if (restored) {
    const ids = JSON.stringify(db.prepare(`SELECT id FROM approvals WHERE status = 'pending' AND store_id IN (SELECT id FROM stores WHERE demo = 0)`).all().map((r) => String(r.id)));
    db.prepare(
      `UPDATE approvals SET status = 'denied', decided_at = ?, reason = reason || ' [Expired: the data was restored from a backup.]'
       WHERE id IN (SELECT value FROM json_each(?))`,
    ).run(new Date().toISOString(), ids);
    db.prepare("INSERT INTO settings (key, value_json) VALUES ('restore_closed', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(ids);
  }
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
