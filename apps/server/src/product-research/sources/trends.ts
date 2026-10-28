import type { PrAdapter } from './adapter';

const FIELDS = ['interest over time: relative interest 0–100 within one export, never search volume', 'term', 'region', 'period', 'granularity'] as const;

/** The owner's own Trends downloads (decision 4): an authorized import; nothing is fetched. */
export const trendsCsvSource: PrAdapter = {
  id: 'google_trends_csv',
  name: 'Google Trends (CSV import)',
  answers: ['demand'],
  fields: FIELDS,
  rate: 'None: the owner uploads files',
  quota: 'None',
  connect:
    'On trends.google.com, search the product term for the store\'s country over the past 12 months (or 5 years for seasonality), then use Download (CSV) on the "Interest over time" chart. Upload the file on the Research page. Attribute it as "Data source: Google Trends".',
  access: () => 'authorized_import',
};

/** Google's Trends API is in a closed alpha (sources doc): it reports Approval required and makes no call. */
export const trendsApiSource: PrAdapter = {
  id: 'google_trends_api',
  name: 'Google Trends API (alpha)',
  answers: ['demand'],
  fields: FIELDS,
  rate: 'Not published',
  quota: 'Not published',
  connect:
    'Apply for the alpha at https://developers.google.com/search/apis/trends#apply (Google takes a very limited number of testers). Until access is granted, import CSV exports instead.',
  access: () => 'approval_required',
};
