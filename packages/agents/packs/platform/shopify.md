# Shopify platform pack

## How selling works here
- Own storefront (DTC). Shopify supplies hosting, checkout, payments, and apps; the store brings every visitor. No marketplace demand.
- Traffic: paid social (Meta, TikTok), Google Shopping/Search, SEO, email/SMS, creators, Shop app.
- The store owns the customer: email, phone, order history, pixel data. Repeat purchase and LTV are the profit engine.
- What wins: clear offer, fast mobile pages, strong product page (photos, reviews, guarantee), Shop Pay, and flows that earn the second order. Judge channels on contribution margin after CAC, not platform ROAS.

## Fees and payouts
- Plans: ~$39/mo (Basic), ~$105 (Grow), ~$399 (Advanced); Plus from ~$2,300/mo. Annual billing ~25% cheaper.
- Shopify Payments: ~2.5–2.9% + ~$0.30 per online card order (US), lower on higher plans.
- Third-party gateway: extra ~0.6–2% Shopify fee on top of the gateway's own fee.
- Apps: ~$0–500+/mo combined. Chargebacks ~$15 each.
- Shopify Tax free up to ~$100k US sales/yr, then ~0.35%. Managed Markets (duties, merchant of record) ~6.5% of international orders.
- Payouts ~2–3 business days (US); first payout and risky accounts can be held.
- Fees change — check the current schedule before quoting exact numbers.

## Listing rules
- Title up to 255 chars; keep the visible title human (~40–70). Set SEO title (~60–70 chars) and meta description (~155) separately.
- Images: up to ~20 MB / 5000x5000 px; use consistent square ~2048 px and alt text.
- Variants: up to 3 options, up to ~2,048 variants per product. Each variant needs SKU, price, weight, tracked inventory, GTIN if branded.
- Use automated collections (tag/type rules) and metafields for specs, size charts, ingredients.
- Google/Meta feeds need GTIN or MPN + brand, price and stock matching the page, product category, plus visible shipping, refund, and contact pages.
- Prohibited/restricted: Shopify Acceptable Use Policy and Shopify Payments restricted list (CBD in many regions, firearms/parts, vapes, pharmaceuticals, adult, replicas, get-rich-quick). Ad platforms may block items Shopify allows.

## Policies and account health
- No platform SLA; the store must honor its own shipping promise. US FTC Mail Order Rule: ship within the stated time (~30 days if none stated), notify delays, offer cancellation.
- Show realistic delivery times on dropshipped goods (often ~7–20 days); vague times drive disputes.
- Keep dispute/chargeback rate under ~0.5%; card networks start monitoring near ~0.9–1%. Shopify Payments may impose reserves or close the account.
- Google Merchant Center suspends for "misrepresentation" when policies, business info, or honest pricing are missing.
- Tax: US economic nexus (often ~$100k or ~200 orders per state), EU IOSS on orders ≤~€150, UK VAT on ≤~£135.
- Ad accounts are part of health: unsupported claims or weak landing pages get Meta/Google accounts restricted.

## Ads and growth levers
- No native paid search; buy traffic on Meta, Google (PMax, Shopping, Search), TikTok, Pinterest through official channel apps (catalog sync + Conversions API).
- Same catalog feeds free Google listings and Facebook/Instagram shops.
- Shop app and Shop Pay lift checkout conversion; Shop Campaigns pay per new customer.
- Shopify Collabs for creators/affiliates; Shopify Audiences (Plus) for lookalikes.
- Email/SMS (Shopify Email, Klaviyo): welcome, abandoned checkout, browse abandonment, post-purchase, win-back; mature stores get ~20–30% of revenue here.
- SEO: collections target category terms, blog targets questions, product schema, good Core Web Vitals.
- Shopify Markets: local currency, translation, duties.
- AOV: bundles, quantity breaks, post-purchase upsell, free-shipping threshold ~15–30% above AOV.

## Playbook notes by role
- Store Developer: Online Store 2.0 theme with sections and app blocks; target LCP <2.5 s, INP <200 ms, CLS <0.1. Every app adds JS: remove unused apps and leftover snippets. Checkout layout edits are Plus-only via Checkout Extensibility.
- Ad Strategist: wire Conversions API before scaling; manage to blended MER and new-customer CAC vs first-order margin.
- Copywriter: product title = what it is + key differentiator; description leads with outcome, then specs, then guarantee.
- Email & SMS: the list is the asset; capture with a popup offer. SMS needs express written consent (TCPA) and quiet hours.
- Operations: track quantity, block overselling except planned preorders, sync stock across channels, upload tracking fast.
- Product Researcher: want ~3x+ markup over landed cost to absorb CAC; check supplier ship speed and payment restrictions first.
- Analytics Specialist: baseline conversion ~1.5–3%; report sessions → add-to-cart → checkout → purchase by device and channel.
