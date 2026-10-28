# WooCommerce platform pack

## How selling works here
- Own storefront on self-hosted WordPress. Free open-source plugin; the store owns hosting, security, updates, and every integration.
- No marketplace demand: traffic comes from SEO (WordPress's strongest edge), content, Google Shopping, paid social, email/SMS, affiliates.
- The store owns the customer and all data, with no platform rules on contact, pricing, or design.
- What wins: content-led SEO, a fast lean site, trusted checkout, and retention flows. Same CAC-vs-margin discipline as any DTC store, with extra technical upkeep.

## Fees and payouts
- Core software free. Hosting ~$10–100+/mo (managed Woo hosting ~$25–300); domain ~$15/yr.
- Premium extensions ~$49–299/yr each; premium theme ~$0–100. Expect ~$500–2,000/yr in licenses for a full stack.
- Payments: WooPayments or Stripe ~2.9% + $0.30 (US), +~1% international cards, +~1% currency conversion; PayPal ~3.5% + ~$0.49. No platform transaction fee.
- Tax automation (WooCommerce Tax, TaxJar, Avalara) free to ~$100+/mo by volume.
- Payouts by gateway: Stripe/WooPayments ~2 business days (US) after an initial ~7-day hold for new accounts.
- Fees change — check the current schedule before quoting exact numbers.

## Listing rules
- No hard platform limits. Keep titles human (~40–70 chars); set SEO title (~50–60 chars) and meta description (~150–160) in Yoast or Rank Math.
- Product types: simple, variable, grouped, external/affiliate; subscriptions and bookings via extensions.
- Variable products: build from global attributes (filterable). Above ~30 variations the front end loads them via AJAX; keep under ~100 per product for admin and page speed.
- Unique SKU, price, stock, weight, dimensions per variation; GTIN/MPN fields for feeds.
- Images: consistent aspect ratio set in theme product-image settings; WebP, ~1200–2000 px, compressed, alt text.
- Add product schema (via SEO plugin) for rich results; short description sits by the buy button, long description below.
- Prohibited items are set by the payment processor (Stripe/WooPayments restricted list: CBD, firearms, adult, pharma, etc.), the host's terms, law, and ad/feed policies.

## Policies and account health
- No platform SLA or enforcement; health = processor, Google, site, and email reputation.
- Keep dispute rate under ~0.5–0.75%; near ~1% Stripe/WooPayments may add reserves or close the account.
- Google Merchant Center: needs refund, shipping, contact pages, accurate price/stock; "misrepresentation" suspends new stores often.
- US FTC Mail Order Rule: ship within the stated time (~30 days if none), notify delays. EU: 14-day withdrawal right.
- Security: update core and plugins weekly on staging first, daily off-site backups, 2FA for admins, WAF. Abandoned plugins are the top hack vector.
- Privacy: privacy policy, cookie consent for pixels in EU/UK, GDPR/CCPA data export and deletion.
- Email: send via SMTP/ESP with SPF, DKIM, DMARC; Gmail/Yahoo bulk-sender rules need one-click unsubscribe and spam rate <~0.3%. Default wp_mail lands in spam.

## Ads and growth levers
- No native ads. Official channel extensions: Google for WooCommerce (Merchant Center feed, free listings, Performance Max), Meta (catalog, pixel, Conversions API), TikTok, Pinterest, Snapchat.
- SEO: category pages as landing pages, blog clusters, internal links, product schema.
- Email/SMS: Klaviyo, Omnisend, MailPoet, AutomateWoo for welcome, abandoned cart, post-purchase, win-back.
- Native coupons (%/fixed cart/fixed product, usage limits, expiry); bundles, BOGO, points and rewards, Subscriptions via extensions.
- Affiliates: AffiliateWP or similar. Marketplace sync (Amazon, eBay, Walmart) via connectors.

## Playbook notes by role
- Store Developer: stage and back up before any update; check HPOS compatibility; exclude cart, checkout, and account pages from page cache; use object cache, CDN, real cron instead of WP-Cron; one plugin per job, drop page-builder bloat. Target LCP <2.5 s, INP <200 ms.
- Ad Strategist: run server-side Conversions API plus consent mode; feed quality depends on the feed extension mapping GTIN, brand, category.
- Copywriter: fill SEO title, meta, and focus keyword per product and category; long descriptions plus FAQs win long-tail search.
- Email & SMS: full data ownership. Add opt-in checkbox at checkout; SMS needs express written consent; fix DNS auth before scaling.
- Operations: order status drives emails (Processing → Completed); set and publish own handling time; sync stock with any marketplace connector.
- Analytics Specialist: use WooCommerce Analytics plus order attribution (source per order) and GA4 ecommerce events; reconcile against gateway payouts.
- Product Researcher: no marketplace traffic to borrow; products need a content or ad angle and margin to cover CAC.
