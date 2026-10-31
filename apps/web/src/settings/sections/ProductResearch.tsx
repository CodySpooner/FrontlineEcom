// Product Research (ST-27, decision 13): a store's research profile, moved from the Research page's dialog. One explicit
// save through PUT /api/pr/profile over the version read. The server re-evaluates fit at save, puts the profile in each
// new research task's message and plans discovery from it; this only sets it. Store only: there is no workspace profile.
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { SETTINGS, settingsUrl, type PrStoreProfile } from '@frontline/shared';
import { api, json, type ApiError } from '../../api/client';
import { cx, ErrorState, inputClass, LoadingState } from '../../components/ui';
import { useProfile } from '../../product-research/api';
import { fromMinor, toMinor } from '../../product-research/format';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection, useScope } from '../kit';

const LISTS = ['warehouses', 'includeCategories', 'keywords', 'avoidCategories', 'avoidTerms'] as const;
type List = (typeof LISTS)[number];
/** The profile as edited: as typed (lists comma separated, the price in the store's currency), with the version read. */
type Form = { audience: string; priceMax: string; shipTo: string; maxDeliveryDays: string; version: number } & Record<List, string>;
type Key = Exclude<keyof Form, 'version'>;
const toForm = (p: PrStoreProfile): Form =>
  ({
    audience: p.audience ?? '',
    priceMax: fromMinor(p.priceMax, p.priceCurrency),
    shipTo: p.shipToDefault ? '' : (p.shipTo ?? ''),
    maxDeliveryDays: p.maxDeliveryDays === null ? '' : String(p.maxDeliveryDays),
    version: p.version ?? 0,
    ...Object.fromEntries(LISTS.map((k) => [k, p[k].join(', ')])),
  }) as Form;
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const refuse = (field: Key, message: string) => Object.assign(new Error(message), { field });
/** What changed, as PUT /api/pr/profile takes it. A value that isn't one is refused on its row, before anything is sent. */
function toBody(c: Partial<Form>, currency: string) {
  const body: Record<string, unknown> = {};
  if (c.audience !== undefined) body.audience = c.audience.trim() || null;
  if (c.priceMax !== undefined) {
    body.priceMax = c.priceMax.trim() ? toMinor(c.priceMax, currency) : null;
    if (c.priceMax.trim() && body.priceMax === null) throw refuse('priceMax', `Enter an amount in ${currency}, like 15 or 39.99.`);
  }
  if (c.shipTo !== undefined) body.shipTo = c.shipTo.trim() || null;
  if (c.maxDeliveryDays !== undefined) {
    const d = c.maxDeliveryDays.trim();
    if (d && !/^\d+$/.test(d)) throw refuse('maxDeliveryDays', 'Enter a whole number of days.');
    body.maxDeliveryDays = d ? Number(d) : null;
  }
  for (const k of LISTS) if (c[k] !== undefined) body[k] = list(c[k]);
  return body;
}
const def = (k: Key) => SETTINGS.find((s) => s.id === `pr.${k}`)!;
const field = cx(inputClass, 'py-1.5 text-[13px]');

export function ProductResearch() {
  const scope = useScope();
  const store = scope.store ?? scope.stores[0];
  const qc = useQueryClient();
  const q = useProfile(store?.id ?? null);
  const f = useSettingsForm<Form>({
    key: `product-research:${store?.id}`,
    saved: q.data && toForm(q.data),
    labels: Object.fromEntries(SETTINGS.filter((s) => s.id.startsWith('pr.')).map((s) => [s.id.slice(3), s.label])),
    save: async (changes, version) => {
      const body = toBody(changes, q.data!.priceCurrency);
      return api<PrStoreProfile>(`/api/pr/profile?store=${encodeURIComponent(store!.id)}`, json('PUT', { version, ...body })).then(
        (p) => (qc.setQueryData(['pr', 'profile', store!.id], p), toForm(p)),
        (e: ApiError) => {
          e.field = e.field?.replace(/^pr\./, ''); // the row's own key
          if (e.current) e.current = toForm(e.current as PrStoreProfile);
          throw e;
        },
      );
    },
    onSaved: () => void qc.invalidateQueries({ queryKey: ['pr'] }), // fit, scope and costs moved with it
  });
  const title = 'Research profile';
  if (!scope.ready || (store && q.isPending)) return <SettingsSection title={title}><LoadingState rows={4} className="px-[18px] pb-4" /></SettingsSection>;
  if (!store)
    return (
      <SettingsSection title={title}>
        <p className="border-t border-line px-[18px] py-3 text-[13px] text-muted">
          A research profile belongs to a store:{' '}
          <Link to={settingsUrl('stores')} className="text-[#ff6b76] hover:underline">
            add a store
          </Link>{' '}
          first.
        </p>
      </SettingsSection>
    );
  if (q.isError) return <SettingsSection title={title}><ErrorState message="Couldn't load the research profile." onRetry={() => q.refetch()} /></SettingsSection>;

  const d = f.draft!;
  const p = q.data!;
  const row = (k: Key) => ({ setting: `pr.${k}`, label: def(k).label, help: def(k).help, htmlFor: `pr-${k}`, error: f.error(k), changed: f.dirty.includes(k) });
  const text = (k: Key, className: string, more: Record<string, unknown> = {}) => (
    <input id={`pr-${k}`} data-setting={`pr.${k}`} value={d[k]} onChange={(e) => f.set(k, e.target.value)} className={cx(field, className)} {...more} />
  );
  return (
    <>
      <SettingsSection title={title} help="Fit is re-evaluated when you save. Saved reports are never rewritten.">
        <SettingRow {...row('audience')}>{text('audience', 'w-[260px] max-w-full', { maxLength: 500, placeholder: 'Who buys from this store' })}</SettingRow>
        <SettingRow {...row('priceMax')}>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            {text('priceMax', 'w-[110px]', { inputMode: 'decimal', placeholder: 'Not set' })}
            {p.priceCurrency}
          </span>
        </SettingRow>
        <SettingRow {...row('shipTo')}>{text('shipTo', 'w-[130px]', { maxLength: 2, placeholder: p.shipToDefault && p.shipTo ? `${p.shipTo} (default)` : 'Country code' })}</SettingRow>
        <SettingRow {...row('warehouses')}>{text('warehouses', 'w-[260px] max-w-full', { placeholder: 'Any' })}</SettingRow>
        <SettingRow {...row('maxDeliveryDays')}>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            {text('maxDeliveryDays', 'w-[110px]', { inputMode: 'numeric', placeholder: 'Not set' })}
            days
          </span>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="What discovery searches" help="Discovery searches change at the next daily plan (00:00 UTC) or Sync now. Comma separated.">
        <SettingRow {...row('includeCategories')}>{text('includeCategories', 'w-[260px] max-w-full', { placeholder: 'The niche only' })}</SettingRow>
        <SettingRow {...row('keywords')}>{text('keywords', 'w-[260px] max-w-full', { placeholder: 'None' })}</SettingRow>
      </SettingsSection>
      <SettingsSection title="Flagged, never hidden" help="A product with an avoided category or term stays in the list, flagged. Comma separated.">
        <SettingRow {...row('avoidCategories')}>{text('avoidCategories', 'w-[260px] max-w-full', { placeholder: 'None' })}</SettingRow>
        <SettingRow {...row('avoidTerms')}>{text('avoidTerms', 'w-[260px] max-w-full', { placeholder: 'None' })}</SettingRow>
      </SettingsSection>
      <SaveBar {...f.bar} scope={store.name} />
      {f.dialogs}
    </>
  );
}
