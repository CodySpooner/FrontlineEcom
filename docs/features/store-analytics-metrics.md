# Store Analytics — metric definitions

Generated from `SA_METRICS` in `packages/shared/src/store-analytics.ts` (SA-05); edit that, then regenerate with
`UPDATE_METRICS_DOC=1 pnpm exec vitest run packages/shared/src/store-analytics.test.ts`. An `id@version` formula is
frozen: changing one means a new version. Cards, charts, drilldowns, exports, reports, alerts and agent tools all
compute these in `apps/server/src/store-analytics/`.

## Net sales (`net_sales@1`)

Gross merchandise sales − seller discounts of orders placed in the period − merchandise refunds dated in the period. Tax and shipping are left out.

- **Tile line:** Excl. tax and shipping, after refunds
- **Unit:** money (daily values add up); better when up
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Sales on the order placement day; refunds on the refund day (or on their order's day with refunds=order_day, labelled).
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. With a product or collection filter, only the matching lines count.
- **Refunds and cancellations:** A refund lowers the period it is made in, so past periods stay put. Refunded shipping and tax are not merchandise and are left out.
- **Datasets:** Orders, Order lines by variant, Refunds

## Gross sales (`gross_sales@1`)

Σ merchandise price × quantity of orders placed in the period, before discounts, excluding tax and shipping.

- **Tile line:** Merchandise before discounts and refunds
- **Unit:** money (daily values add up); better when up
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Order placement day.
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. With a product or collection filter, only the matching lines count.
- **Refunds and cancellations:** Not affected by refunds or cancellations (the as-placed amount).
- **Datasets:** Orders, Order lines by variant

## Discounts (`discounts@1`)

Σ seller discounts on orders placed in the period. A platform-funded discount (TikTok Shop's platform discount) is not a seller discount and is left out.

- **Tile line:** Seller-funded discounts
- **Unit:** money (daily values add up); better when down
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Order placement day.
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. With a product or collection filter, only the matching lines count.
- **Refunds and cancellations:** Not affected by refunds.
- **Datasets:** Orders, Order lines by variant

## Refunds (`refunds@1`)

Σ merchandise refunded on refund lines dated in the period (shipping, tax and other adjustments are shown apart).

- **Tile line:** Merchandise refunded, by refund day
- **Unit:** money (daily values add up); better when down
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Refund day (or the original order day with refunds=order_day, labelled).
- **Exclusions:** Refunds on test orders and duplicate channel copies are left out. With a product or collection filter, only the matching lines count.
- **Refunds and cancellations:** A partial refund counts its amount; a cancellation after payment is a refund on the cancel day.
- **Datasets:** Refunds

## Orders (`orders@1`)

Count of distinct canonical paid orders placed in the period.

- **Tile line:** Paid, deduped across channels
- **Unit:** count (daily values add up); better when up
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Order placement day.
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. With a product or collection filter, orders holding a matching line.
- **Refunds and cancellations:** Later refunds never remove an order. An order cancelled after payment still counts on its placement day (its money back is a refund on the cancel day).
- **Datasets:** Orders

## Avg. order value (`aov@1`)

Σ (gross merchandise − seller discounts) of orders placed in the period ÷ those orders. Tax and shipping are left out.

- **Tile line:** Order value ÷ orders, before refunds
- **Unit:** money; better when up
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Order placement day (one cohort for both sides).
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. With a product or collection filter, only the matching lines count.
- **Refunds and cancellations:** Unaffected by later refunds: refund-day net sales and placement-day orders are different cohorts (decision 11).
- **Datasets:** Orders, Order lines by variant

## Units (`units@1`)

Σ quantity on the lines of orders placed in the period.

- **Tile line:** Units ordered
- **Unit:** count (daily values add up); better when up
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Order placement day.
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. With a product or collection filter, only the matching lines count.
- **Refunds and cancellations:** Units ordered: refunded units are counted in the refund rate, not taken off here.
- **Datasets:** Order lines by variant

## Cancelled orders (`cancelled_orders@1`)

Count of canonical paid orders whose cancellation is dated in the period.

- **Tile line:** Paid orders cancelled, by cancel day
- **Unit:** count (daily values add up); better when down
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Cancel day.
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out.
- **Refunds and cancellations:** The order still counts in orders on its placement day; its money back is a refund.
- **Datasets:** Orders

## Refund rate (`refund_rate@1`)

Σ units on refund lines dated in the period ÷ Σ units ordered in the period, from summed counts.

- **Tile line:** Units refunded ÷ units ordered
- **Unit:** ratio; better when down
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Refunded units by refund day, units by order day.
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. Refunds with no units (amount-only adjustments) don't count. With a product or collection filter, only the matching lines count.
- **Refunds and cancellations:** This is the refund measure; changes are in percentage points.
- **Datasets:** Order lines by variant, Refunds

## Sessions (`sessions@1`)

Σ the store site's sessions on the days its traffic source reported them. TikTok Shop visitors and Amazon sessions are other channels' traffic and are never added.

- **Tile line:** Site sessions (Shopify or GA4)
- **Unit:** count (daily values add up); better when up
- **Grain:** day
- **Filters applied:** Market
- **Currency:** None (a count).
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** The traffic source's report day.
- **Exclusions:** Days with no report are left out and counted in coverage, never read as 0.
- **Refunds and cancellations:** Not applicable.
- **Datasets:** Sessions and funnel

## Site conversion (`site_conversion@1`)

Σ purchasing sessions ÷ Σ sessions, over the days where both are reported. Orders are never divided by sessions.

- **Tile line:** Shopify site sessions only
- **Unit:** ratio; better when up
- **Grain:** day
- **Filters applied:** Market
- **Currency:** None (a ratio).
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** The traffic source's report day.
- **Exclusions:** Days missing either side are left out and counted in coverage. GA4 sends event counts, not purchasing sessions, so a GA4 store has no conversion.
- **Refunds and cancellations:** Not applicable; changes are in percentage points.
- **Datasets:** Sessions and funnel, Purchasing sessions

## Ad spend (`ad_spend@1`)

Σ spend of the store's campaigns on every connected ad network, each day converted at that day's rate.

- **Tile line:** Connected ad networks
- **Unit:** money (daily values add up); better when neither (context)
- **Grain:** day
- **Filters applied:** none (any active filter is named in the scope note)
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** Each ad account's own report day.
- **Date basis:** Spend day as the network reports it.
- **Exclusions:** Never allocated to products, collections, channels or markets: a filter leaves it as the store total, said in the scope note.
- **Refunds and cancellations:** Not applicable.
- **Datasets:** Ad spend

## Platform ROAS (`platform_roas@1`)

Per network: the network's own attributed purchase value ÷ its spend over the same days. Never combined across networks: their attributed sales overlap and aren't store revenue.

- **Tile line:** Each network's own attribution
- **Unit:** multiple; better when up
- **Grain:** day
- **Filters applied:** none (any active filter is named in the scope note)
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** Each ad account's own report day.
- **Date basis:** The network's attribution day (late conversions are re-read for its window).
- **Exclusions:** Spend with no attributed value counts in the denominator.
- **Refunds and cancellations:** The network's own figure; store refunds don't touch it.
- **Datasets:** Ad spend, Platform-attributed results

## Contribution before ads (`contribution_before_ads@1`)

Net sales of lines with a known unit cost − their product cost − fees (recorded where read, else the store's estimate). Lines with no cost are left out and shown as coverage.

- **Tile line:** Costed sales − product cost − fees
- **Unit:** money (daily values add up); better when up
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** As net sales; a line's cost is the cost recorded when it was sold (never today's).
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. Uncosted lines are left out, never costed at 0. With a product or collection filter, only the matching lines count.
- **Refunds and cancellations:** Refunded merchandise comes off as in net sales; its product cost still counts unless the refund line was restocked.
- **Datasets:** Orders, Order lines by variant, Refunds, Fees

## Contribution after ads (`contribution_after_ads@1`)

Contribution before ads − ad spend, at store level only. Not net profit: overhead and other expenses aren't tracked.

- **Tile line:** Before ads − ad spend, store level
- **Unit:** money (daily values add up); better when up
- **Grain:** day
- **Filters applied:** none (any active filter is named in the scope note)
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** As its two parts.
- **Exclusions:** Ad spend is not allocated: with any filter this is unavailable.
- **Refunds and cancellations:** As contribution before ads.
- **Datasets:** Orders, Order lines by variant, Refunds, Fees, Ad spend

## Cost coverage (`cost_coverage@1`)

Σ units on lines with a known unit cost ÷ Σ units ordered in the period.

- **Tile line:** Units sold with a unit cost
- **Unit:** ratio; better when up
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** None (a share).
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Order placement day.
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. With a product or collection filter, only the matching lines count.
- **Refunds and cancellations:** Not affected by refunds.
- **Datasets:** Order lines by variant

## Fees (`fees@1`)

Recorded fees where the platform reports them (Amazon's settled fees); otherwise an estimate: the store's fee % × the amount charged (gross − discounts + shipping + tax) + its per-order fee × orders. Amazon as a channel: 15% referral on its sales.

- **Tile line:** Recorded where read, else estimated
- **Unit:** money (daily values add up); better when down
- **Grain:** day
- **Filters applied:** Channel, Product, Collection, Market, Segment
- **Currency:** The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Order placement day (a recorded fee on its own day).
- **Exclusions:** Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out. An estimate is labelled as one.
- **Refunds and cancellations:** Not reversed on refunds: processors keep their fee.
- **Datasets:** Orders, Fees

## Stock cover (`stock_cover@1`)

Tracked stock now ÷ units sold per day over the last 14 full days, whatever period is selected.

- **Tile line:** Days of tracked stock at the recent rate
- **Unit:** days; better when up
- **Grain:** product or variant, now
- **Filters applied:** Channel
- **Currency:** None (days).
- **Timezone:** The store's timezone (a demo store: this computer's).
- **Date basis:** Stock is current state; the sales rate is the last 14 full days.
- **Exclusions:** Untracked, sells-when-out, made-to-order, FBA-managed and supplier-managed stock gets no cover. No sales in 14 days: no estimate.
- **Refunds and cancellations:** Units ordered, as units.
- **Datasets:** Inventory, Order lines by variant
