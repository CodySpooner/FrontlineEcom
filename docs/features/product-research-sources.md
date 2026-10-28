# Product Research sources: the feasibility matrix

**Checked 2026-10-28** (PR-01), from official docs, help centers, pricing pages and announcements only. No account was
created, no one signed in and no data API was called. Where an official page refused the fetch, a fact taken from a
search engine's copy of that page is marked **(search index)**: lower confidence, re-check before relying on it.
Re-check a source here before building or changing its adapter, and update the date.

Each source is an adapter in `apps/server/src/product-research/sources/` that declares what it answers, its fields,
its rate and quota, how to connect it and its status (decision 4). The statuses are the app's (`PR_ACCESS_LABEL`,
`packages/shared/src/research.ts`):

- **Verified live integration:** a real call succeeded in this install (fixture rows never count).
- **Credentials required:** works once the owner enters a key; free or paid as stated.
- **Approval required:** the provider must accept an application first.
- **Authorized import:** the owner uploads a file they are entitled to export.
- **Manual research only:** no permitted automated access; the owner records notes with a link and date.
- **Unsupported:** not allowed (scrapers, unofficial endpoints) or the owner isn't eligible.

## Summary

| Source | Answers | Status (2026-10-28) | Built | What the owner does |
|---|---|---|---|---|
| CJdropshipping API | discovery, fulfillment | Credentials required (free) | yes (PR-05) | install CJ's API app, add an API key, paste it in Integrations |
| Google Trends CSV export | demand (relative interest) | Authorized import | yes (PR-06) | download the CSV on trends.google.com and upload it |
| Google Trends API (alpha) | demand (relative interest) | Approval required | adapter reports status only (PR-06) | apply on Google's alpha form and be selected |
| The stores' own orders | measured demand for what a store sells | Verified for connected real stores (`demo = 0`) | yes (PR-07) | connect the store's platform |
| TikTok Creative Center | discovery (ad signals) | Manual research only | notes only (PR-07) | browse it logged in, record a note with the link and date |
| Supplier feed CSV | fulfillment | Authorized import | yes (PR-07) | upload a feed they are entitled to export |
| Pasted product links | discovery, details | Owner-provided public pages, through the safe fetcher | yes (PR-14) | paste a link |
| AliExpress Open Platform (DS) | discovery, fulfillment | Approval required | no | see below |
| Amazon Creators API | discovery, rank | Approval required (license conflicts) | no | see below |
| Keepa API | demand (rank, sold buckets, price history) | Credentials required (paid) | no | buy a plan |
| Meta Ad Library API | discovery (EU/UK ad signals) | Credentials required (identity check) | no | see below |
| Pinterest Trends | demand (relative interest) | tool: Manual research only; API: Approval required | no | see below |
| eBay Browse / Marketplace Insights | discovery / sold history | Approval required (AI-use restriction) | no | see below |
| Etsy Open API v3 | discovery, demand proxy | Approval required (AI-use restriction) | no | see below |
| TikTok Commercial Content API / Research API | EU ads / research | Approval required / Unsupported | no | see below |
| Syncee | supplier catalog | Authorized import (through the feed CSV) | via the feed import | see below |
| pytrends, SerpApi, Creative Center scrapers | — | Unsupported | never | — |
| Other suppliers (BigBuy, Printful, Printify, vidaXL, Banggood, …) | fulfillment | see the supplier table | no | see below |
| Licensed intelligence (DataForSEO, Google Ads keyword planning, Jungle Scout, …) | search volume estimates | Credentials or approval required, mostly paid | no | see below |

Two findings shape the build: **eBay's and Etsy's terms restrict putting their data into AI** the provider hasn't
licensed (the app's agents run on Claude), and **Amazon's license allows only use that sends traffic to Amazon**
(analysis needs Amazon's prior written approval). Neither is built.

## CJdropshipping (supplier data, fulfillment) — Credentials required

Read from CJ's developer docs on 2026-10-28. No credentials were used and no API was called. Pages, all under
`https://developers.cjdropshipping.com/en/`: auth `api/api2/api/auth.html`, products `api/api2/api/product.html`,
logistics `api/api2/api/logistic.html`, limits `api/start/limit.html`, points `api/api2/standard/points.html`, error
codes `api/api2/standard/ps-code.html`, development rules `api/start/development.html`, API key `api/start/apikey.html`,
definitions `api/api2/standard/definition.html`.

- **Base URL** `https://developers.cjdropshipping.com/api2.0/v1`; headers `CJ-Access-Token` and
  `Content-Type: application/json` (definitions).
- **Success rule** (development): HTTP 200 **and** (`code` 200, or `code` 0, or no `code` field). Some documented
  responses have no `result` field (`getInventoryByPid`, `globalWarehouseList`), so the old `!body.result` check is
  wrong for them. PR-05 uses the documented rule.

### Auth
| Call | Body | Returns |
|---|---|---|
| `POST /authentication/getAccessToken` | `{ apiKey }` only | `openId`, `accessToken`, `accessTokenExpiryDate`, `refreshToken`, `refreshTokenExpiryDate`, `createDate` |
| `POST /authentication/refreshAccessToken` | `{ refreshToken }` | the same, without `openId` |
| `POST /authentication/logout` | header only | `true`; both tokens expire |

- Access and refresh tokens each live **180 days**. getAccessToken is limited to **1 call per second**, and "when the
  same account calls the Get Token endpoint multiple times within 24 hours, the returned accessToken and refreshToken
  remain consistent" (auth).
- On `1600001` (invalid token) refresh; if the refresh returns `1600003`, request a new token (development).
- Tokens stay on the backend and never reach the front end (token page). The app already keeps them in the encrypted
  integrations store.

### Rate limits and quota
- Per user, by account level (limits): **Free or sales level 0–1: 1 request/second**; Plus or level 2: 2/s; Prime or
  level 3: 4/s; Advanced or level 4–5: 6/s. Also at most 10 requests/second per IP, and 3 users per IP.
- **Daily points** (points page; in force for every account since 2026-07-01): 50,000 base points a day, reset at
  00:00 UTC, plus "MAX of the last 3 months' transaction amounts × 100". Points refill per minute (total ÷ 1440).
  Costs: `listV2` and `list` **50**; `product/query`, `variant/query`, `variant/queryByVid` **10**; each stock call
  **10**; `freightCalculate` and `freightCalculateTip` **10**; image search 1,000. Unlisted endpoints (categories,
  warehouses, `productDetail/query`, order list) cost nothing. Every response carries `pointsInfo {usedToday,
  remaining, total}`.
- Over the rate limit: **HTTP 429 with code 1600200**. Points used up: the points page shows HTTP 429 with body code
  429 "Insufficient API points…", the code table lists `16900500`. The docs disagree, so both are classified as quota.
- 30 days with no transactions suspends API access: every call returns `1600014` until the owner reactivates it at
  `https://www.cjdropshipping.com/my.html#/authorize/APIStores`.

**Caps in the app** (`apps/server/src/product-research/caps.ts`): CJ's own call spacing stays at 1.1 s (the free
tier's 1/s). Ingestion: at most 5 pages × 20 results per query per day and 500 calls a day; watch checks 100 calls a
day; 1 page per "Search CJ" click; 3 calls per alternative-supplier search. At most 100 list pages (5,000 points) plus
400 detail, stock or freight calls (4,000 points) a day is under a fifth of the free 50,000, which leaves room for the
owner's own searches and agent searches. CJ defines points, so `pr_calls` also records `pointsInfo.remaining` from the
last response in the source's `quota_json`.

### Error classes (code table, verbatim codes)
| Class | Codes | What the app does |
|---|---|---|
| auth | 1600001, 1600002, 1600003, 1600004, 1600005, 1600006, 1601000, HTTP 401/403 | stop the source until the owner saves the key again; no retry |
| disabled | 1600014 | stop (as auth); the owner reactivates API access at CJ's link above |
| rate limit | 1600200, HTTP 429 without a points message | wait (Retry-After if sent, at most 10 min, else 30 s, 2 min, 8 min), at most 3 times |
| quota | 1600201, 16900500, body code 429 "Insufficient API points" | stop until 00:00 UTC |
| server / timeout | 1600000, 1600100 (interface offline), 1600301 (read timed out), HTTP 5xx, no answer in 20 s, anything unlisted | retry at most 3 times with backoff (30 s, 2 min, 8 min) |
| not found | 1602000, 1602001, 1602003 (variant removed) | mark the listing `gone`; not a source failure, not retried |
| request | 1600300, 1605002, 16900202, 16900205, 16900403 | a bug on our side: logged, not retried |

### Endpoints used
| Need | Call | Key fields |
|---|---|---|
| Discovery (paged) | `GET /product/listV2` — `keyWord`, `page` (1–1000), `size` (1–100, default 10), `categoryId`, `countryCode`, `startSellPrice`/`endSellPrice`, `productFlag` (0 trending, 1 new, 2 video, 3 slow-moving), `orderBy` (0 best match, 1 listing count, 2 price, 3 create time, 4 inventory), `sort`, `features` | `data.content[].productList[]`: `id`, `nameEn`, `sku` (the SPU), `bigImage`, `sellPrice` (USD, a string), `listedNum` ("Number of times this product is listed on the platform"), `categoryId`, `oneCategoryName`/`twoCategoryName`/`threeCategoryName`, `warehouseInventoryNum`, `deliveryCycle` (days), `supplierName`, `createAt`; `totalRecords` (max 6,000) |
| Category tree | `GET /product/getCategory` (free) | `categoryFirstName` → `categorySecondName` → `categoryId`, `categoryName` |
| Product detail and variants | `GET /product/query` — one of `pid`, `productSku`, `variantSku`; `countryCode` | `pid`, `productNameEn`, `productSku`, `bigImage`, `productImageSet`, `productWeight` (g), `categoryName`, `entryCode` (HS code), `sellPrice`, `suggestSellPrice`, `listedNum`, `supplierName`, `description`, `variants[]` (`vid`, `variantNameEn`, `variantSku`, `barcode`, `variantKey`, `variantLength`/`Width`/`Height` mm, `variantWeight` g, `variantSellPrice` USD, `inventories[]`) |
| Variants only | `GET /product/variant/query` (`pid` / `productSku` / `variantSku`), `GET /product/variant/queryByVid?vid=&features=enable_inventory` | as above, plus `variantProperty` |
| Stock per warehouse | `GET /product/stock/queryByVid?vid=` | per warehouse: `areaId`, `areaEn`, `countryCode`, `totalInventoryNum`, `cjInventoryNum`, `factoryInventoryNum` (`storageNum` is deprecated) |
| Stock for every variant | `GET /product/stock/getInventoryByPid?pid=` | `inventories[]` per warehouse and `variantInventories[] {vid, inventory[] {countryCode, totalInventory, cjInventory, factoryInventory}}` |
| Warehouses | `GET /product/globalWarehouseList` (free) | `areaId`, `areaEn`, `countryCode`, `nameEn` |
| Freight quote | `POST /logistic/freightCalculate` — `startCountryCode`, `endCountryCode` (required), `zip`, `products[] {quantity, vid}` (required) | per method: `logisticName`, `logisticPrice` (USD), `logisticAging` (a range string such as `"2-5"`; the docs don't name the unit), `taxesFee`, `clearanceOperationFee`, `totalPostageFee` (USD) |
| Popularity among CJ sellers | `POST /product/productDetail/query {id}` (free) | `soldOut` ("Sales volume in the last 90 days"), `orderCount`, `listed`, `commentCount`, `score` |

- **What these numbers are.** `listedNum`, `soldOut` and `orderCount` are CJ's own figures about sellers using CJ:
  shown as "popularity among CJ sellers" with the date read, never as demand evidence (decision 9). `sellPrice` is
  CJ's price in USD, a supplier claim until a variant offer is read. `logisticAging` has no unit in the docs: it is
  stored in the offer's `delivery_days_min`/`max` on the assumption that it is days (to confirm on the first live
  check, decision 16) and shown as CJ's estimate, a supplier claim.
- **Doc gaps:** the unit of `logisticAging`; whether `sellPrice` can be a range (the old code assumed "2.47 -- 3.10",
  the docs only show single values: PR-05 parses a range as unknown, never as 0); which body points-exhaustion
  actually returns.

### API key (what the owner does)
CJ's API-key page: "Apps" in the left navigation → Install App → under Others, install **API** ("installing the app
does not create a key by itself") → open **My CJ → Authorization → API** (`https://www.cjdropshipping.com/my.html#/authorize/API`)
→ **Add API**, Type **API Key**, Confirm → copy the key from the **API Key & MCP Token** column. The REST API needs
only the key: getAccessToken takes `apiKey` alone, and no email is sent. The app keeps its "Account email" field, now
optional, for the owner's reference.

### Terms
The developer docs set no rules on caching or displaying product data (not found). Videos should be cached rather than
hot-linked. CJ's User Agreement (`https://cjdropshipping.com/user-agreement`) IX.3 forbids using platform content "for
any form of commercial purposes" or displaying it "on channels other than the source pages" without written
permission; how that applies to authorized API use isn't stated. The app keeps CJ data in the owner's local database
for the owner's own research, shows it only to the owner, and links every listing back to CJ.

## Google Trends CSV export (demand) — Authorized import

- **What it gives:** "Interest over time" for up to 8 terms or groups (new Explore: "up to 8 groups of terms at once
  and up to 50 terms in each group"; classic explore: 5 groups of 25), downloaded as CSV with the Download button at
  the chart's top right ([export](https://support.google.com/trends/answer/4365538?hl=en),
  [compare](https://support.google.com/trends/answer/4359550?hl=en)). Both UIs still exist.
- **What the numbers are:** each point is divided by total searches for its geography and time range, then "scaled on
  a range of 0 to 100"; the data is a sample with statistical noise added for privacy, repeat searches and searches
  from AI Mode and AI Overviews filtered out ([FAQ](https://support.google.com/trends/answer/4365533?hl=en)). Values
  are **relative within one request**: never search volume, units or revenue, and two files never share a scale.
- **Granularity:** ranges of 30 days or longer are in UTC with "a granularity of one day, one week, or one month";
  ranges of 7 days or shorter are local time, typically hourly (FAQ). Which range gives which granularity: not stated.
- **Low values:** the docs only say low-volume terms "appear as '0'" (FAQ). The "<1" seen in exports is not documented.
- **File layout: not documented by Google** (checked the FAQ, export, compare,
  [quick comparisons](https://support.google.com/trends/answer/17261722?hl=en),
  [Gemini Explore](https://support.google.com/trends/answer/16763742?hl=en) and
  [troubleshooting](https://support.google.com/trends/answer/9009229?hl=en) pages). Classic exports
  (`multiTimeline.csv`) have commonly looked like this. That is general knowledge of past files, not a specification,
  and no file was checked in this run:

  ```
  Category: All categories

  Week,dog paw cleaner: (United States)
  2025-10-26,45
  2025-11-02,<1
  ```

  A first line naming the category, a blank line, a header whose first cell names the granularity (`Day`, `Week` or
  `Month`) and whose other cells read `<term>: (<region>)`, then one row per period with 0–100 or `<1`. The Explore
  redesign was announced 2026-01-14 ([blog](https://blog.google/products-and-platforms/products/search/google-trends-explore-with-ai/));
  no official note of a CSV change exists. **The parser (PR-06) is tolerant**: it finds the header row instead of
  assuming line 3, reads the granularity from the first header cell or from the date spacing, and refuses a file it
  can't read with the reason. It is checked against the owner's first real export (decision 16).
- **Geography:** worldwide plus countries and regions ([4355212](https://support.google.com/trends/answer/4355212)).
  Update frequency: not stated.
- **Terms:** "You can use any information from Google Trends, subject to the Google Terms of Service"; attribute it as
  "Data source: Google Trends" with the URL, and don't cite it together with Google Ads data (export page). The app
  labels every use "Imported from Google Trends, <date>".
- The BigQuery Trends dataset only has the Top 25 and Top 25 Rising terms (US DMAs and about 50 countries), not
  arbitrary keywords ([12764470](https://support.google.com/trends/answer/12764470?hl=en)): not useful here.

## Google Trends API (alpha) — Approval required

- Search interest that is "consistently scaled" across requests (not 0–100 per request, unlike the website), a rolling
  1,800 days up to "just 2 days ago", daily, weekly, monthly and yearly aggregation, ISO 3166-2 regions and subregions,
  "dozens of terms" per comparison ([announcement, 2025-07-24](https://developers.google.com/search/blog/2025/07/trends-api),
  [API page](https://developers.google.com/search/apis/trends)).
- **Applications are open** as of 2026-10-28: "We're now accepting applications for alpha testers"
  ([API page, Apply](https://developers.google.com/search/apis/trends#apply)). The page embeds a Google Form:
  `https://docs.google.com/forms/d/e/1FAIpQLSfiP3XUUWGr4CkYk1oJHpthCAcAw2kL0UaE6p7tq3ZoxFiLtA/viewform`. Google
  prioritises developers "that know what they want to do, that can start doing it soon, and that are willing to
  provide feedback", and admits "a very limited number of testers".
- Auth, cost, quotas, terms and endpoints: not stated. The adapter reports Approval required and makes no call.

## The stores' own orders (measured demand) — built in PR-07

Orders the app already syncs from each store's platform (Shopify, WooCommerce, Etsy, Amazon, TikTok Shop connectors),
matched to a product by SKU or by the owner. These are the only **measured** sales in the app. They count **only for
stores with `demo = 0`**: a demo store's orders are generated and never count as evidence.

## TikTok — Manual research only (Creative Center notes, PR-07); APIs not built

- **Creative Center Top Products:** desktop, logged in, Inspiration → Top Products, sorted by Popularity or Popularity
  change (search index: [help](https://ads.tiktok.com/help/article/how-to-use-top-products); that URL now serves
  "About Creative Center"). Product pages show Popularity, CTR, CVR, CPA, Cost and Impressions
  ([example](https://ads.tiktok.com/business/creativecenter/product-category/Bras-601262/pc/en)). **No API**: the only
  Creative Center API is Symphony, a video engine ([About](https://ads.tiktok.com/help/article/creative-center)).
  TikTok's terms bar "automated scripts to collect information" (search index,
  [terms](https://www.tiktok.com/legal/terms-of-service?lang=en)). These are ad-delivery signals, not sales. The owner
  records notes with a link and date; nothing is fetched.
- **Commercial Content API:** EU-delivered ads only "in this phase", kept until a year after the ad last ran; apply
  with a developer account using an official email, review about 2 working days; client key and secret
  ([product](https://developers.tiktok.com/products/commercial-content-api/),
  [getting started](https://developers.tiktok.com/doc/commercial-content-api-getting-started)). Quotas, cost: not
  stated. **Approval required**, ads only.
- **Research API:** academic and not-for-profit researchers "independent of commercial interests"
  ([product](https://developers.tiktok.com/products/research-api/)). **Unsupported**: the owner isn't eligible.

## Supplier feed CSV — Authorized import, built in PR-07

A CSV the owner is entitled to export from a supplier or a feed tool, mapped to listings, variants and offers with
origin `import`. An offer's `checked_at` is the date the file states; a file with no date gives provenance
`supplier_claim`. PR-07 lists the exact columns under Blocked.

**Syncee** ([what it is](https://help.syncee.com/en/articles/3971222-what-is-the-syncee-datafeed-manager)) is a feed
tool, not an API: its DataFeed Manager imports a supplier's CSV, XML, XLS(X) or JSON into a Shopify, ShopRenter or
Jumpseller store ([import](https://help.syncee.com/en/articles/8957806-how-to-import-products-by-using-the-syncee-datafeed-manager)),
uploads capped at 100 MB, UTF-8 ([upload](https://help.syncee.com/en/articles/1238709-data-feed-file-sources-import-with-file-upload)),
scheduled daily to monthly ([schedule](https://help.syncee.com/en/articles/9009063-schedule-your-datafeed-import-task)).
No retailer developer API is documented. Retailer plans: Free, $39.99/mo (100 products), $59.99 (250), $99.99
(10,000) ([pricing](https://syncee.com/pricing)). Its product export CSV
([export](https://help.syncee.com/en/articles/4201300-product-export-how-to-make-a-product-export-task)) is a file the
owner can upload to the feed import.

## Pasted product links — built in PR-14

The owner pastes a public product page. The app reads it once through the shared safe fetcher (decision 12: pinned
DNS, private ranges blocked, every redirect re-checked, size and time caps, robots.txt honoured) and keeps what the
page states as origin `owner_link`. It never logs in, never pages through a site and never re-fetches on a timer.

## Marketplaces and ad libraries (not built)

| Source | What it gives | Access and auth | Cost | Limits | Restrictions | Status | What the owner would do |
|---|---|---|---|---|---|---|---|
| **AliExpress Open Platform**, Dropshipper APIs ([category](https://openservice.aliexpress.com/doc/api.htm#/api?cid=21038)) | `aliexpress.ds.product.get` per product and `ship_to_country`: title, category, `sales_count`, rating, SKUs with price, sale price, stock, wholesale tiers, import charges, package size and weight, `delivery_time`; `aliexpress.ds.freight.query`: options with fee, min/max delivery days, carrier, ship-from; `aliexpress.ds.text.search` by keyword; image search, categories, feed item ids | developer account, app type "Drop Shipping"; the "Dropshipping Developer" category is requested with a reason and approved by admins ([1361](https://openservice.aliexpress.com/doc/doc.htm?nodeId=27493&docId=118729#/?docId=1361)); an AliExpress **buyer** account signed up to the DS Center Dropshipping Program ([1646](https://openservice.aliexpress.com/doc/doc.htm?nodeId=27493&docId=118729#/?docId=1646)); App Key and Secret, then OAuth, refresh token 30–60 days ([1590](https://openservice.aliexpress.com/doc/doc.htm?nodeId=27493&docId=118729#/?docId=1590)) | `chargeable: false` on these APIs | QPS: product.get 500, freight.query 350, image search 15 ([1687](https://openservice.aliexpress.com/doc/doc.htm?nodeId=27493&docId=118729#/?docId=1687)) | developer agreement not readable in English; caching and display terms not stated | Approval required | buyer account + DS agreement, developer account, category approval, enter App Key and Secret, authorize |
| **Amazon Creators API** (replaces PA-API 5, which now returns 403) ([intro](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction)) | GetItems, SearchItems, GetVariations, GetBrowseNodes: title, brand, features, dimensions, EAN/UPC; OffersV2 price and availability; SalesRank; no reviews ([reference](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference)) | Associates account with at least 10 qualifying sales in the past 30 days | not stated | 1 TPS and 8,640 a day, growing with shipped revenue, lost after 30 days without sales ([rates](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/api-rates)) | use "solely to send end users and sales to an Amazon Site"; "aggregating, analyzing, extracting, or repurposing" needs prior written approval; no image caching, other content 24 h ([license](https://affiliate-program.amazon.com/help/operating/policies/)) | Approval required (a research tool conflicts with the license) | Associates sales, then Amazon's written approval |
| **Keepa API** ([docs](https://keepa.com/api-docs/)) | price, sales-rank, rating, review-count and offer-count history; `monthlySold` buckets (e.g. "100+"); Product Finder, deals, best sellers ([product object](https://keepa.com/api-docs/product-object.html)) | `key` parameter | paid monthly plans; prices behind JavaScript, not read; free tier not stated | tokens per minute by plan, unused expire after 60 min; product 1 token, search 10 a page ([plans](https://keepa.com/api-docs/plans-tokens.html)) | terms not read | Credentials required (paid) | buy a plan, enter the key |
| **Meta Ad Library API** ([ads_archive](https://developers.facebook.com/docs/graph-api/reference/ads_archive/)) | all ads delivered to the UK/EU in the past year (others only if political or issue): creative text, delivery dates, snapshot URL, page, platforms, reach by location; EU reach and payer; **spend and impressions only for political ads** ([archived ad](https://developers.facebook.com/docs/graph-api/reference/archived-ad/)) | identity and location confirmed at facebook.com/ID (days), developer app, token (search index: [API page](https://www.facebook.com/ads/library/api)) | not stated | error 613 exists, numbers not stated | not read | Credentials required (identity check) | confirm identity, create an app, enter a token |
| **Pinterest Trends** ([tool](https://help.pinterest.com/en/business/article/pinterest-trends), [API](https://developers.pinterest.com/docs/analytics-and-reports/trends/)) | tool: up to two years, each graph indexed so its peak is 100; API: top keywords per region and trend type with week-, month- and year-on-year growth and a weekly 0–100 series | tool: business account; API: "agencies, Enterprise clients, and partner platforms", "not widely available" ([staff, 2024-01-22](https://community.pinterest.biz/t/list-trending-keywords-access/2617)) | not stated | trial per day, Standard per minute ([tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/)) | relative interest only | tool: Manual research only; API: Approval required | record notes from the tool |
| **eBay Browse** ([overview](https://www.edp.ebay.com/api-docs/buy/browse/overview.html)) and **Marketplace Insights** | search and item details; Insights: sold-item history up to 90 days (Limited Release, search index) | Buy APIs "intended for eBay partners only", through the eBay Partner Network, "require an additional license" ([requirements](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html)) | not stated | per app | the [API License](https://www.edp.ebay.com/join/api-license-agreement)'s "Restricted APIs" (market trends, pricing, sales volumes) may not be ingested into AI not provided or licensed by eBay without consent; no AI training | Approval required | EPN approval; eBay's consent for AI use |
| **Etsy Open API v3** ([spec](https://www.etsy.com/openapi/generated/oas/3.0.0.json)) | active listings by keyword, price and taxonomy; `num_favorers`, tags; shops' `transaction_sold_count` and `review_average` | `x-api-key`; tools beyond your own shop need a Personal App ("deeper review") or Commercial Access ([docs](https://developers.etsy.com/documentation/)) | not stated | per app QPS and QPD ([limits](https://developers.etsy.com/documentation/essentials/rate-limits)) | the Terms of Use bar using data for ML/AI "testing, prompting…" without permission (search index, [ToU](https://www.etsy.com/legal/terms-of-use)); current caching clause not read | Approval required | Personal App approval and Etsy's permission for AI use |

## Unofficial tools — Unsupported

- **pytrends**: "Pseudo API for Google Trends … not an official or supported API", archived 2025-04-17
  ([GitHub](https://github.com/GeneralMills/pytrends)).
- **SerpApi**: "Scrape Google Trends results" ([SerpApi](https://serpapi.com/google-trends-api)).
- **Creative Center and marketplace scrapers.** The app never scrapes (spec §5).

## Other suppliers and regional fulfillment (evaluated, not built)

Each would plug into the same adapter interface as CJ (`apps/server/src/product-research/sources/adapter.ts`).

| Platform | What it gives | Access and auth | Cost | Limits | Coverage, freshness | Restrictions | Status | What the owner would do |
|---|---|---|---|---|---|---|---|---|
| **BigBuy** (EU wholesaler) [guide](https://www.bigbuy.eu/public/doc/Guia_API_BigBuy_EN.pdf), [OpenAPI](https://api.bigbuy.eu/rest/doc.json) | products (`sku`, `ean13`, weight and size, `wholesalePrice`, `retailPrice`, tiered `priceLargeQuantities`), variants with their own SKU, EAN and price, stock per warehouse by handling time (0–1, 1–2, 2–4 days), shipping quotes per destination and postcode (`delay`, `cost`) | REST with `Authorization: Bearer <key>`, key "provided upon request using the contact form"; CSV/XML files over FTP; sandbox | paid: the "Ecommerce" pack or higher; the only official figure is an old blog post (€90 activation + €69/mo), current price unconfirmed | bulk catalog 10/hour per endpoint, product info 24/hour, single lookups 1 per 5 s, shipping 1/s, HTTP 429 | ships from Valencia, Spain to Europe; catalog daily, stock every 10–15 min | not stated | Credentials required (paid) | buy the pack, request a key, enter it |
| **Printful** (print on demand) [v1](https://developers.printful.com/docs/), [v2](https://developers.printful.com/docs/v2-beta/), [pricing](https://www.printful.com/pricing) | catalog products and variants with `price`, `in_stock`, availability per region; regional prices (v2); shipping rates with `rate`, `currency`, `minDeliveryDays`/`maxDeliveryDays` | REST, private token (scoped, expires) | free account; optional Growth plan $24.99/mo | 120/min (30/min unauthenticated catalog); shipping rates 120/60 s | worldwide, NA, EU, UK, AU, JP, BR regions; ships from the nearest center | rates are "meant to be called only right before placing an order"; jewelry not in the API | Credentials required (free) | free account, private token with catalog and shipping scopes |
| **Printify** (print on demand) [docs](https://developers.printify.com/), [API terms](https://printify.com/api-terms/) | blueprints, print providers with location, variants; shipping per method with handling time (days) and cost in cents. **No cost on catalog variants** (only on products already in a shop) | REST, Personal Access Token (1 year) | free account (Premium $24.99–39/mo optional); "quota that can be increased by upgrading" (HTTP 402) unexplained | 600/min, catalog 100/min | per provider location | API terms forbid storing or copying merchant data, putting data "in a search engine or directory", benchmarking | Credentials required (free) | free account, personal token |
| **vidaXL** (EU) (search index) | products by code, real-time stock | email + API token, requested from the B2B team | ~€30/mo (unverified) | not verified | EU | not verified | Approval required | request API access |
| **Banggood Open Platform** [portal](https://api.banggood.com/) | product information, shipment information, stock, tracking | apply to the partner program for an Appid and AppSecret | "No joining fee" | on a linked page, not stated | global from CN | not stated | Approval required | register and apply |
| Zendrop, AutoDS, Helium 10 | catalog search, shipping windows | **MCP servers only** (no REST): they would plug into the agent engine, not the server pipeline | plan-dependent | Zendrop 120 reads/min | — | AutoDS supports Claude only | Credentials required | account + MCP sign-in |
| Spocket | — | no official developer docs (`developers.spocket.co` does not resolve) | — | — | — | — | Manual research only | — |
| Faire | brand-side API only; no retailer sourcing API found | — | — | — | — | — | Unsupported | — |

**The next supplier to build** is Printful (free, real per-region prices and delivery ranges) for print-on-demand
stores, then BigBuy for EU stores once the owner buys its pack. Neither is in this build (decision 4).

## Licensed product-intelligence services (evaluated, not built)

| Service | What it measures | Access and auth | Cost | Limits | Coverage, freshness | Restrictions | Status | What the owner would do |
|---|---|---|---|---|---|---|---|---|
| **DataForSEO** [docs](https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/), [pricing](https://dataforseo.com/pricing) | Google Ads `search_volume` ("the (approximate) number of searches": Google's estimate), `monthly_searches` (up to 4 years), competition, bids; also a Google Trends endpoint | REST, Basic auth (API login and password) | paid: $50 prepaid minimum, no subscription; $0.06 (standard) to $0.09 (live) per task of up to 1,000 keywords; Trends from $0.0027 per task | live endpoints 12/min | worldwide or per location/language; keyword data updates mid-month | ToS §7.1: the data must not "compete with or adversely affect" search engines; store results yourself (live results aren't kept) | Credentials required (paid) | create an account, top up $50, enter the API login |
| **Google Ads API keyword planning** [docs](https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas), [access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels) | `avg_monthly_searches`, `monthly_search_volumes`, competition index, top-of-page bids | OAuth through a Cloud project (developer tokens were sunset on 2026-09-09); Explorer access **restricts** KeywordPlanIdeaService | no fee stated | 1 request/s per customer for keyword ideas; 15,000 operations/day at Basic | monthly refresh; Google recommends caching | internal use is exempt from the minimum-functionality rules | Approval required (Basic access + brand verification) | Google Ads account, apply for Basic access in the Cloud console |
| **Jungle Scout API** [docs](https://developer.junglescout.com/), [product](https://www.junglescout.com/products/jungle-scout-api/) | Amazon keyword search estimates, historical search volume, **estimated** sales (modelled from rank), share of voice | REST, `KEY_NAME:API_KEY` + `X-API-Type` | paid: Growth Accelerator or Brand Owner plan (~$79–149/mo, unverified) **plus** the API add-on $29/mo (1,000 requests) to $199/mo (10,000); first 100 requests free | 300/min | Amazon US, UK, DE, IN, CA, FR, IT, ES, MX, JP | channel-partner terms bar making the data available to third parties (search index) | Credentials required (paid) | buy a base plan and the API add-on |
| Exploding Topics [API](https://explodingtopics.com/feature/et-api) | curated trending topics with search volume and a forecast; **no custom keyword or region lookups** | REST key | paid: $249/mo + API $1,000–4,000/mo | 60/min | daily | product integration needs custom pricing | Credentials required (paid) | — |
| Semrush, Ahrefs | keyword volumes (SEO tools) | API keys on paid plans | Semrush Business (~$499.95/mo, snippet) + API units; Ahrefs from $129/mo | Semrush 10/s per IP | — | Semrush: no caching over a month without consent | Credentials required (paid) | — |
| Similarweb, Glimpse | web traffic estimates; a trends API | sales quote | paid (quote) | — | — | — | Approval required | contact sales |
| Pipiads | ad-spy results | Open API key + credits | paid credits (price not stated) | — | — | — | Credentials required (paid) | — |
| Minea | ad spy | no public API found | — | — | — | — | Manual research only | — |

**What this means for the build.** Every licensed intelligence source costs money or needs an approval, so none is
built (spec §5: no subscriptions without the owner's go-ahead). The cheapest real search-volume route is DataForSEO
($50 prepaid, pay per use); the free one is Google Ads keyword planning after Basic access is approved. Both give
Google's **estimated** monthly searches: if added later, they would be labelled "Google Ads estimate", never as
measured demand or sales. Jungle Scout's sales figures are modelled estimates for Amazon only.
