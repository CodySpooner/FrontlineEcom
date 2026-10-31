// Product Research (ST-27, decision 13): a store's research profile, moved from the Research page's dialog. One explicit
// save through PUT /api/pr/profile over the version read. The server re-evaluates fit at save, puts the profile in each
// new research task's message and plans discovery from it; this only sets it. Store only: there is no workspace profile.
// ST-28: the store's default assumptions for economics, and Copy from another store (a preview, then one save).
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SETTINGS, settingsUrl, type PrStoreProfile, type Store } from '@frontline/shared';
import { api, json, type ApiError } from '../../api/client';
import { cx, Dialog, ErrorState, flatButtonClass, inputClass, LoadingState } from '../../components/ui';
import { useProfile } from '../../product-research/api';
import { fromMinor, minorMoney, toMinor } from '../../product-research/format';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection, useScope } from '../kit';

const LISTS = ['warehouses', 'includeCategories', 'keywords', 'avoidCategories', 'avoidTerms'] as const;
type List = (typeof LISTS)[number];
const PERCENTS = ['discountPct', 'returnRatePct', 'refundPct'] as const;
type Percent = (typeof PERCENTS)[number];
/** The profile as edited: as typed (lists comma separated, the price in the store's currency), with the version read. */
type Form = { audience: string; priceMax: string; shipTo: string; maxDeliveryDays: string; version: number } & Record<List | Percent, string>;
type Key = Exclude<keyof Form, 'version'>;
/** Every field, in the page's order (Copy from another store lists them so). */
const KEYS: Key[] = ['audience', 'priceMax', 'shipTo', 'warehouses', 'maxDeliveryDays', 'includeCategories', 'keywords', 'avoidCategories', 'avoidTerms', ...PERCENTS];
const toForm = (p: PrStoreProfile): Form =>
  ({
    audience: p.audience ?? '',
    priceMax: fromMinor(p.priceMax, p.priceCurrency),
    shipTo: p.shipToDefault ? '' : (p.shipTo ?? ''),
    maxDeliveryDays: p.maxDeliveryDays === null ? '' : String(p.maxDeliveryDays),
    version: p.version ?? 0,
    ...Object.fromEntries(LISTS.map((k) => [k, p[k].join(', ')])),
    ...Object.fromEntries(PERCENTS.map((k) => [k, p[k] == null ? '' : String(p[k])])),
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
  for (const k of PERCENTS) {
    const v = c[k]?.trim();
    if (v === undefined) continue;
    if (v && !(/^\d+(\.\d+)?$/.test(v) && Number(v) <= 100)) throw refuse(k, 'Enter a percentage from 0 to 100.');
    body[k] = v ? Number(v) : null;
  }
  return body;
}
/** Saves `changes` over `version`; a refusal names the row by its own key. */
const put = (store: string, changes: Partial<Form>, version: number, currency: string) =>
  api<PrStoreProfile>(`/api/pr/profile?store=${encodeURIComponent(store)}`, json('PUT', { version, ...toBody(changes, currency) })).catch((e: ApiError) => {
    e.field = e.field?.replace(/^pr\./, '');
    if (e.current) e.current = toForm(e.current as PrStoreProfile);
    throw e;
  });
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
    save: (changes, version) => put(store!.id, changes, version, q.data!.priceCurrency).then((p) => (qc.setQueryData(['pr', 'profile', store!.id], p), toForm(p))),
    onSaved: () => void qc.invalidateQueries({ queryKey: ['pr'] }), // fit, scope and costs moved with it
  });
  const [copying, setCopying] = useState(false);
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
  const others = scope.stores.filter((s) => s.id !== store.id);
  const was = p.priceSaved?.max != null ? p.priceSaved : null;
  const row = (k: Key) => ({ setting: `pr.${k}`, label: def(k).label, help: def(k).help, htmlFor: `pr-${k}`, error: f.error(k), changed: f.dirty.includes(k) });
  const text = (k: Key, className: string, more: Record<string, unknown> = {}) => (
    <input id={`pr-${k}`} data-setting={`pr.${k}`} value={d[k]} onChange={(e) => f.set(k, e.target.value)} className={cx(field, className)} {...more} />
  );
  return (
    <>
      <SettingsSection
        title={title}
        help="Fit is re-evaluated when you save. Saved reports are never rewritten."
        aside={
          others.length > 0 && (
            <button type="button" data-action="pr.copy" onClick={() => setCopying(true)} disabled={f.dirty.length > 0} title={f.dirty.length ? 'Save or discard your changes first' : undefined} className={cx(flatButtonClass('ghost'), 'shrink-0')}>
              Copy from another store…
            </button>
          )
        }
      >
        <SettingRow {...row('audience')}>{text('audience', 'w-[260px] max-w-full', { maxLength: 500, placeholder: 'Who buys from this store' })}</SettingRow>
        <SettingRow
          {...row('priceMax')}
          help={
            was ? (
              <>
                {def('priceMax').help}{' '}
                <span className="text-[#f5b754]">
                  {`Saved as ${minorMoney(was.max!, was.currency)}: `}
                  {was.converted ? `converted to ${p.priceCurrency} at the stored rate.` : `no ${was.currency} to ${p.priceCurrency} rate yet, so fit leaves it out. Enter it in ${p.priceCurrency}.`}
                </span>
              </>
            ) : (
              def('priceMax').help
            )
          }
        >
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
      <SettingsSection title="Default assumptions" help="A product's economics use these where you haven't typed its own figure. Saved comparisons keep theirs.">
        {PERCENTS.map((k) => (
          <SettingRow key={k} {...row(k)}>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              {text(k, 'w-[110px]', { inputMode: 'decimal', placeholder: k === 'refundPct' ? '100' : '0' })}%
            </span>
          </SettingRow>
        ))}
      </SettingsSection>
      <SaveBar {...f.bar} scope={store.name} />
      {f.dialogs}
      {copying && <CopyDialog store={store} others={others} profile={p} onClose={() => setCopying(false)} />}
    </>
  );
}

const shown = (k: Key, v: string, currency: string) =>
  !v ? (k === 'shipTo' ? 'Default' : PERCENTS.includes(k as Percent) ? 'Built-in' : 'Not set') : k === 'priceMax' ? `${v} ${currency}` : PERCENTS.includes(k as Percent) ? `${v}%` : v;

/** The other store's values for every field that differs, then one save over the version read (the preview is the body). */
function CopyDialog({ store, others, profile, onClose }: { store: Store; others: Store[]; profile: PrStoreProfile; onClose: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(others[0]!.id) // shown only when there is one;
  const theirs = useProfile(from);
  const mine = toForm(profile);
  const other = theirs.data && toForm(theirs.data);
  // A band is in its own store's currency: another currency's isn't copied.
  const band = theirs.data && theirs.data.priceCurrency !== profile.priceCurrency;
  const rows = other ? KEYS.filter((k) => !(k === 'priceMax' && band) && mine[k] !== other[k]) : [];
  const name = others.find((s) => s.id === from)?.name;
  const m = useMutation({
    mutationFn: () => put(store.id, Object.fromEntries(rows.map((k) => [k, other![k]])), profile.version ?? 0, profile.priceCurrency),
    onSuccess: (p) => (qc.setQueryData(['pr', 'profile', store.id], p), void qc.invalidateQueries({ queryKey: ['pr'] }), onClose()),
  });
  return (
    <Dialog open onClose={onClose} title="Copy from another store" width={560}>
      <label className="flex items-center gap-2 text-[13px]">
        <span className="text-muted">From</span>
        <select value={from} onChange={(e) => (setFrom(e.target.value), m.reset())} className={cx(inputClass, 'py-1.5')}>
          {others.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {theirs.isPending ? (
        <LoadingState rows={3} className="mt-3" />
      ) : theirs.isError ? (
        <ErrorState message={`Couldn't load ${name}'s profile.`} onRetry={() => theirs.refetch()} />
      ) : rows.length ? (
        <table className="mt-3 w-full text-left text-[12.5px]" aria-label="Changes to copy">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-medium">Setting</th>
              <th className="py-1 font-medium">{store.name}</th>
              <th className="py-1 font-medium">{name}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k} data-key={k} className="border-t border-line align-top">
                <td className="py-1.5 pr-2">{def(k).label}</td>
                <td className="py-1.5 pr-2 break-words text-muted">{shown(k, mine[k], profile.priceCurrency)}</td>
                <td className="py-1.5 break-words">{shown(k, other![k], profile.priceCurrency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-[13px] text-muted">{`${name}'s profile is the same as ${store.name}'s.`}</p>
      )}
      {band && <p className="mt-2 text-xs text-muted">{`${name}'s highest cost is in ${theirs.data!.priceCurrency}, so it isn't copied.`}</p>}
      {m.error && (
        <p role="alert" className="mt-2 text-xs text-[#ff6b76]">
          {m.error.message}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={flatButtonClass('ghost')}>
          Cancel
        </button>
        <button type="button" onClick={() => m.mutate()} disabled={!rows.length || m.isPending} className={flatButtonClass('primary')}>
          {m.isPending ? 'Copying…' : `Copy ${rows.length} setting${rows.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Dialog>
  );
}
