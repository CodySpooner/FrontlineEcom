# Frontline Ecom

A desktop command center for running multiple ecommerce stores with squads of AI agents — one squad per store, each
agent specialized in its job (ads, product research, store dev, creatives, analysis, copy, email/SMS, operations) and
trained on the store's platform and niche. Dark grey + red, gamified.

```
pnpm install
pnpm dev      # web on http://localhost:5173, API on :8787
pnpm check    # typecheck + tests
```

- What we're building: [docs/DESIGN.md](docs/DESIGN.md)
- Build order: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- Per-lane backlogs: [docs/backlog/](docs/backlog/)
- Rules for the AI workers: [CLAUDE.md](CLAUDE.md)

## Using the app

- **Install:** `pnpm package` builds `apps/desktop/release/Frontline Ecom Setup <version>.exe`. The installer isn't
  signed yet, so Windows SmartScreen asks first: More info → Run anyway. Closing the window keeps the app in the tray,
  and the tray menu has Quit and Start with Windows.
- **Demo first:** a fresh install opens on three demo stores with two years of data. Agents on demo stores run on a
  free stand-in engine, so exploring never uses your Claude plan.
- **Going live:** in Integrations, pick a store and connect its platform (Shopify, WooCommerce, Etsy, TikTok Shop,
  Amazon), its ad accounts (Meta, Google, TikTok) and GA4. Each card lists its setup steps. The first sync replaces
  that store's demo data with real data. After that, Shopify and WooCommerce refresh every 2 minutes and the rest
  every 10. Once a day each store's whole catalog is read again, and products deleted on the platform show as
  archived. Agents on connected stores use your local Claude Code login.
- **Safety:** agents ask before they spend, publish or change a live store or ad account. Requests wait on the
  Dashboard unless you turned on autopilot for that action, with a cap.
- **What an approval changes:**
  - Shopify: new products, prices, product and store pages, and themes.
  - WooCommerce: new products, prices and product pages. Store pages also need a WordPress application password.
  - Etsy: prices and listing titles and descriptions. Etsy has no compare-at price. An Etsy shop connected before
    this feature must be connected again once.
  - Meta, Google and TikTok ads: daily budgets and pausing campaigns.
  - Amazon: prices (the consumer offer in the store's marketplace). A listing with a sale price running, or a new
    price outside its min/max in Seller Central, is left for you to change. Needs the Product Listing role.
  - TikTok Shop: agents put the change in their answer and you make it.
- **Your data:** everything stays on this PC in `%APPDATA%\Frontline Ecom\data`. That folder holds the database,
  `logs\api.log`, and `backups\` (daily, newest 7 kept, restorable from Settings). Connector credentials are encrypted
  with your Windows login and never leave the machine except to their own service.

### How the numbers are counted

- **Revenue** is what customers paid for paid orders, including shipping and tax, minus refunds. Pending and on-hold
  payments (cash on delivery, bank transfer), test and sample orders don't count until paid, and a cancelled order
  counts as refunded. TikTok Shop subtracts cancellations only, and Amazon counts sales before refunds.
- **Profit** is revenue minus product costs minus ad spend. Costs come from the platform (Shopify "Cost per item",
  WooCommerce Cost of Goods Sold) or from Store Analytics → Unit costs. Platform and payment fees come off only as
  the estimate you set per store: a % of revenue plus an amount per order. Sales tax and VAT in Shopify, WooCommerce,
  Etsy and TikTok Shop orders come off too (revenue still shows the order totals). Shipping labels aren't subtracted.
- **ROAS** on the dashboard is store revenue ÷ total ad spend. In the campaigns table, it's the purchase value each
  network attributes to that campaign.
- **Days** follow each store's own timezone (the shop's, where the platform reports it). Today's change compares
  against the same hours of earlier days.
- **Currencies:** a store reports in its shop's currency. Ad spend in another currency, and "All stores" totals (in
  the base currency from Settings), are converted at the European Central Bank's daily rates.

## The Orca workers

Three Claude Code agents build this in parallel, each in its own Orca worktree
(`C:\Users\Xody2\orca\workspaces\FrontlineEcom\ui`, `\core`, `\agents`). A Codex agent builds the AI Ecosystem page in
`\ecosystem` (spec: `docs/features/ai-ecosystem.md`) and stops by itself once that backlog is done. A Stop hook (`scripts/agent/keep-going.mjs`,
enabled only in those worktrees' `.claude/settings.local.json`) keeps each one working, and `scripts/agent/watchdog.mjs`
(running in the "Watchdog" terminal of the main FrontlineEcom workspace in Orca) nudges any that go idle and relaunches
any that exit.

**To stop them:** create an empty file `C:\dev\FrontlineEcom\.agent\STOP` (stops all workers and the watchdog), or
`<worktree>\.agent\STOP` for one worker. Then press Esc in the worker's Orca terminal (or close it).
Delete the file to let them run again.
