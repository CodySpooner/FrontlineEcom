// Stores (ST-18, decisions 2 and 16): the list at /settings/stores, each store's page at /settings/stores/:id, and Add
// store. The store page is the one editor of a store's fields; Onboarding keeps StoreForm for the first store.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { NICHES, PLATFORMS, SET_BY_SYNC, settingsUrl, type ConfigImpact, type Niche, type Platform, type Store, type StoreDeleteImpact, type StoreUpdate } from '@frontline/shared';
import { api, json, useIntegrations, useStoreActions, useStores, type ApiError } from '../../api/client';
import { feeEstimate, nicheName, PLATFORM_NAME, StoreForm } from '../../components/StoreForm';
import { Badge, Button, cx, Dialog, ErrorState, inputClass, LoadingState } from '../../components/ui';
import { nicheKey } from '../../lib/niche';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection } from '../kit';

/** /settings/stores lists them; /settings/stores/:id is one store's page. */
export function Stores() {
  const id = useLocation().pathname.split('/')[3];
  return id ? <StorePage id={decodeURIComponent(id)} /> : <StoreList />;
}

const impactOf = (storeId: string | undefined, set: StoreUpdate) => api<{ impacts: ConfigImpact[] }>('/api/config/store-impact', json('POST', { storeId, set })).then((r) => r.impacts.map((i) => i.text));

export function StoreList() {
  const q = useStores();
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const added = useQuery({ queryKey: ['stores', 'impact', 'new'], queryFn: () => impactOf(undefined, {}), enabled: adding });
  return (
    <SettingsSection
      title="Your stores"
      help="Open a store to change its details, selling currency, timezone and fees."
      aside={
        <Button size="sm" variant="primary" data-action="stores.add" onClick={() => setAdding(true)}>
          Add store
        </Button>
      }
    >
      {q.isPending ? (
        <LoadingState rows={3} className="px-[18px] pb-4" />
      ) : q.isError ? (
        <ErrorState message="Couldn't load your stores." onRetry={() => q.refetch()} />
      ) : (
        <ul>
          {q.data.map((s) => (
            <li key={s.id} className="border-t border-line">
              <Link to={settingsUrl('stores', { id: s.id })} className="group flex items-center gap-3 px-[18px] py-3 hover:bg-panel">
                <i aria-hidden data-color={s.color} className="size-3 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13.5px] font-medium">
                    {s.name}
                    <Badge tone={s.connected ? 'good' : 'muted'}>{s.connected ? 'Live' : 'Demo data'}</Badge>
                  </span>
                  <span className="block text-xs text-muted">{[PLATFORM_NAME[s.platform], `Sells in ${s.currency}`, feeEstimate(s) ?? 'No fee estimate'].join(' · ')}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted group-hover:text-white" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a store" side="right">
        {added.data?.map((t) => (
          <p key={t} className="mb-4 rounded-lg border border-line bg-bg-2 px-3 py-2 text-xs text-text-2">
            {t}
          </p>
        ))}
        {adding && <StoreForm onDone={(s) => (setAdding(false), s && navigate(settingsUrl('stores', { id: s.id })))} />}
      </Dialog>
    </SettingsSection>
  );
}

type Form = { version: number; name: string; color: string; niche: Niche; nicheDetail: string; platform: Platform; currency: string; timezone: string; feePercent: number; feePerOrder: number };
const toForm = (s: Store): Form => ({
  version: s.version ?? 0,
  name: s.name,
  color: s.color,
  niche: s.niche,
  nicheDetail: s.nicheDetail ?? '',
  platform: s.platform,
  currency: s.currency,
  timezone: s.timezone,
  feePercent: s.feePercent ?? 0,
  feePerOrder: s.feePerOrder ?? 0,
});
/** As PATCH /api/stores/:id takes it: a blank sub-niche clears it. */
const toBody = (c: Partial<Form>): StoreUpdate => ({ ...c, ...(c.nicheDetail !== undefined && { nicheDetail: c.nicheDetail.trim() || null }) });
const ZONES = Intl.supportedValuesOf('timeZone');

function StorePage({ id }: { id: string }) {
  const q = useStores();
  const store = q.data?.find((s) => s.id === id);
  const qc = useQueryClient();
  const connections = useIntegrations().data?.filter((i) => i.storeId === id) ?? [];
  const setBy = (field: keyof typeof SET_BY_SYNC) => {
    const i = connections.find((c) => SET_BY_SYNC[field].includes(c.kind));
    return i && PLATFORM_NAME[i.kind as Platform];
  };
  const f = useSettingsForm<Form>({
    key: `store:${id}`,
    saved: store && toForm(store),
    labels: { name: 'Name', color: 'Color', niche: 'Niche', nicheDetail: 'Sub-niche', platform: 'Platform', currency: 'Selling currency', timezone: 'Business timezone', feePercent: 'Fees, % of revenue', feePerOrder: 'Fee per order' },
    save: (changes, version) =>
      api<Store>(`/api/stores/${encodeURIComponent(id)}`, json('PATCH', { ...toBody(changes), version })).then(toForm, (e: ApiError) => {
        if (e.field?.startsWith('store.')) e.field = e.field.slice(6); // the registry id names the row
        if (e.current) e.current = toForm(e.current as Store);
        throw e;
      }),
    onSaved: () => void qc.invalidateQueries(), // a store's fields show up in nearly every query
  });
  const changes = f.dirty.length ? toBody(f.changes()) : undefined;
  const impact = useQuery({ queryKey: ['stores', 'impact', id, changes], queryFn: () => impactOf(id, changes!), enabled: !!changes });
  const back = (
    <Link to={settingsUrl('stores')} className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2 hover:text-white">
      <ArrowLeft aria-hidden className="size-3.5" />
      All stores
    </Link>
  );
  if (q.isPending) return <SettingsSection title="Store"><LoadingState rows={4} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError) return <SettingsSection title="Store"><ErrorState message="Couldn't load your stores." onRetry={() => q.refetch()} /></SettingsSection>;
  if (!store) return <SettingsSection title="No such store" help={<>Nothing is saved as “{id}”. {back}</>} />;
  const d = f.draft!;
  const row = (k: keyof Form) => ({ setting: `store.${k}`, error: f.error(k), changed: f.dirty.includes(k) });
  const currencyBy = setBy('currency');
  const zoneBy = setBy('timezone');
  const texts = changes ? (impact.data ?? []) : [];
  return (
    <>
      {back}
      <SettingsSection
        title={
          <span className="flex items-center gap-2">
            <i aria-hidden className="size-3 rounded-full" style={{ background: store.color }} />
            {store.name}
          </span>
        }
        help="What the agents know the store as."
        aside={<Badge tone={store.connected ? 'good' : 'muted'}>{store.connected ? 'Live' : 'Demo data'}</Badge>}
      >
        <SettingRow {...row('name')} label="Name" htmlFor="store-name" help="Agents see it in their store profile.">
          <input id="store-name" data-setting="store.name" value={d.name} onChange={(e) => f.set('name', e.target.value)} maxLength={80} className={cx(inputClass, 'w-full min-[600px]:w-[260px]')} />
        </SettingRow>
        <SettingRow {...row('color')} label="Color" htmlFor="store-color" help="Marks the store across the app.">
          <input id="store-color" type="color" data-setting="store.color" value={d.color} onChange={(e) => f.set('color', e.target.value)} className={cx(inputClass, 'h-[34px] w-16 cursor-pointer p-1!')} />
        </SettingRow>
        <SettingRow {...row('niche')} label="Niche" htmlFor="store-niche" help="Picks the agents' niche pack.">
          <select id="store-niche" data-setting="store.niche" value={d.niche} onChange={(e) => f.set('niche', e.target.value as Niche)} className={cx(inputClass, 'py-1.5')}>
            {NICHES.map((n) => (
              <option key={n} value={n}>
                {nicheName(n)}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow {...row('nicheDetail')} label="Sub-niche" htmlFor="store-niche-detail" help="What the store sells, in a few words. Leave it blank to clear it.">
          <input id="store-niche-detail" data-setting="store.nicheDetail" value={d.nicheDetail} onChange={(e) => f.set('nicheDetail', e.target.value)} maxLength={120} placeholder="e.g. dog travel gear" className={cx(inputClass, 'w-full min-[600px]:w-[260px]')} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Selling" help="Where and how the store sells. Fees come off its profit.">
        <SettingRow {...row('platform')} label="Platform" htmlFor="store-platform" help={store.connected ? `${store.name} is live: to sell elsewhere, add that platform as a store of its own.` : 'Where the store sells.'}>
          <select id="store-platform" data-setting="store.platform" value={d.platform} disabled={store.connected} onChange={(e) => f.set('platform', e.target.value as Platform)} className={cx(inputClass, 'py-1.5 disabled:text-text-2')}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_NAME[p]}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow {...row('currency')} label="Selling currency" htmlFor="store-currency" help={currencyBy ? `Set by ${currencyBy} on every sync.` : 'Once connected, the store takes the currency its platform reports.'}>
          <input
            id="store-currency"
            data-setting="store.currency"
            value={d.currency}
            readOnly={!!currencyBy}
            onChange={(e) => f.set('currency', e.target.value.toUpperCase())}
            maxLength={3}
            className={cx(inputClass, 'w-20 uppercase', currencyBy && 'text-text-2')}
          />
        </SettingRow>
        <SettingRow
          {...row('timezone')}
          label="Business timezone"
          htmlFor="store-timezone"
          help={zoneBy ? `Set by ${zoneBy} on every sync.` : store.connected ? "The store's reporting days run midnight to midnight here." : 'Takes effect once the store goes live.'}
        >
          <select id="store-timezone" data-setting="store.timezone" value={d.timezone} disabled={!!zoneBy} onChange={(e) => f.set('timezone', e.target.value)} className={cx(inputClass, 'w-full py-1.5 disabled:text-text-2 min-[600px]:w-[260px]')}>
            {(ZONES.includes(d.timezone) ? ZONES : [d.timezone, ...ZONES]).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow {...row('feePercent')} label="Fees, % of revenue" htmlFor="store-fee-percent" help="Platform and payment fees, taken off profit for all orders, past ones included.">
          <input id="store-fee-percent" type="number" data-setting="store.feePercent" value={d.feePercent} onChange={(e) => f.set('feePercent', Number(e.target.value))} min={0} max={50} step={0.01} className={cx(inputClass, 'w-24')} />
        </SettingRow>
        <SettingRow {...row('feePerOrder')} label="Fee per order" htmlFor="store-fee-per-order" help={`In ${store.currency}, taken off profit for all orders, past ones included.`}>
          <input id="store-fee-per-order" type="number" data-setting="store.feePerOrder" value={d.feePerOrder} onChange={(e) => f.set('feePerOrder', Number(e.target.value))} min={0} max={100} step={0.01} className={cx(inputClass, 'w-24')} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Elsewhere for this store">
        <ul className="grid gap-1 border-t border-line px-[18px] py-3 text-[13px]">
          {[
            ['Knowledge workspace', `/knowledge?ws=${encodeURIComponent(id)}`],
            ['Niche pack', `/knowledge?view=library&tab=niche&doc=${encodeURIComponent(nicheKey(store))}`],
            ['Research profile and ship-to', settingsUrl('product-research', { store: id })],
            ['Integrations', settingsUrl('integrations', { store: id })],
          ].map(([label, to]) => (
            <li key={label}>
              <Link to={to!} className="text-text-2 underline-offset-2 hover:text-white hover:underline">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </SettingsSection>

      <DeleteStore store={store} />

      <SaveBar {...f.bar} scope={store.name} impact={texts.length ? texts.map((t) => <span key={t} className="mt-0.5 block text-xs">{t}</span>) : undefined} />
      {f.dialogs}
    </>
  );
}


/** The danger zone (ST-19): what goes and what stays, from real counts; Delete only once the store's name is typed. */
function DeleteStore({ store }: { store: Store }) {
  const { remove } = useStoreActions();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  // mutateAsync: the refetched list drops the store and unmounts this page first, which would skip mutate's onSuccess.
  const impact = useQuery({ queryKey: ['stores', store.id, 'delete-impact'], queryFn: () => api<StoreDeleteImpact>(`/api/stores/${encodeURIComponent(store.id)}/impact`) });
  const goes = impact.data?.removes.filter((r) => r.count > 0) ?? [];
  const stays = impact.data?.keeps.filter((r) => r.count > 0) ?? [];
  return (
    <SettingsSection title="Delete this store" help="Removes the store and what's listed here. This can't be undone.">
      {impact.data && (
        <div className="grid gap-1.5 border-t border-line px-[18px] py-3 text-xs text-text-2">
          <p>Removes: {goes.length ? goes.map((r) => r.text).join(', ') : 'only the store itself'}.</p>
          {stays.length > 0 && <p>Stays: {stays.map((r) => r.text).join(', ')}.</p>}
          {impact.data.codexFolder && <p>Its Codex work folder stays on disk: {impact.data.codexFolder}</p>}
        </div>
      )}
      <div data-action="stores.delete" className="flex flex-wrap items-center gap-3 border-t border-line px-[18px] py-3">
        <label htmlFor="delete-confirm" className="text-[13px]">
          Type <b>{store.name}</b> to confirm
        </label>
        <input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={cx(inputClass, 'w-full min-[600px]:w-[220px]')} />
        <Button variant="primary" disabled={typed !== store.name || remove.isPending} onClick={() => void remove.mutateAsync({ id: store.id, confirm: typed }).then(() => navigate(settingsUrl('stores')), () => {})}>
          Delete store
        </Button>
        {remove.isError && (
          <p role="alert" className="basis-full text-xs text-red">
            {remove.error.message}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
