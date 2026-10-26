// Add or edit a store (Settings, onboarding).
import { useState, type FormEvent } from 'react';
import { NICHES, PLATFORMS, type Niche, type Platform, type Store } from '@frontline/shared';
import { useStoreActions } from '../api/client';
import { Button, cx, Field, inputClass } from './ui';

export const PLATFORM_NAME: Record<Platform, string> = { shopify: 'Shopify', tiktok_shop: 'TikTok Shop', etsy: 'Etsy', amazon: 'Amazon', woocommerce: 'WooCommerce', walmart: 'Walmart' };
/** The platform's name when the app can't make this change on a connected store (platform not in `can`, shared's *_PLATFORMS), so it goes in by hand. */
export const byHand = (s: Store | undefined, can: readonly Platform[]) => (s?.connected && !can.includes(s.platform) ? PLATFORM_NAME[s.platform] : undefined);
/** Usual platform + payment fees as [% of revenue, per order], shown as a starting point for the owner's estimate. */
const FEE_HINT: Record<Platform, [number, number]> = { shopify: [2.9, 0.3], etsy: [9.5, 0.25], tiktok_shop: [8, 0], amazon: [15, 0], woocommerce: [2.9, 0.3], walmart: [15, 0] };
/** The owner's fee estimate as one line (e.g. "Fees 9.5% + 0.25 per order"), undefined when none is set. */
export function feeEstimate(s: Pick<Store, 'feePercent' | 'feePerOrder'>) {
  const parts = [s.feePercent && `${s.feePercent}%`, s.feePerOrder && `${s.feePerOrder.toFixed(2)} per order`].filter(Boolean);
  return parts.length ? `Fees ${parts.join(' + ')}` : undefined;
}
export const nicheName = (n: Niche) => n.charAt(0).toUpperCase() + n.slice(1);

/** Add or edit a store. `onDone` gets the saved store, or nothing on Cancel. */
export function StoreForm({ store, onDone }: { store?: Store; onDone: (saved?: Store) => void }) {
  const { save } = useStoreActions();
  const [name, setName] = useState(store?.name ?? '');
  const [platform, setPlatform] = useState<Platform>(store?.platform ?? 'shopify');
  const [niche, setNiche] = useState<Niche>(store?.niche ?? 'pet');
  const [nicheDetail, setNicheDetail] = useState(store?.nicheDetail ?? '');
  const [currency, setCurrency] = useState(store?.currency ?? 'USD');
  const [color, setColor] = useState(store?.color ?? '#ff2a3a');
  const [feePercent, setFeePercent] = useState(store?.feePercent ? String(store.feePercent) : '');
  const [feePerOrder, setFeePerOrder] = useState(store?.feePerOrder ? String(store.feePerOrder) : '');
  const [timezone, setTimezone] = useState(store?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  // The saved zone stays pickable even when this browser's list leaves it out (e.g. "UTC").
  const [zones] = useState(() => [...new Set([timezone, ...Intl.supportedValuesOf('timeZone')])]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { id: store?.id, name: name.trim(), platform, niche, ...(nicheDetail.trim() && { nicheDetail: nicheDetail.trim() }), currency: currency.trim().toUpperCase(), timezone, color, feePercent: Number(feePercent) || 0, feePerOrder: Number(feePerOrder) || 0 },
      { onSuccess: (saved) => onDone(saved) },
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Store name">
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Pawsome Gear" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Sells on">
          <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className={cx(inputClass, 'cursor-pointer')}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_NAME[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Niche">
          <select value={niche} onChange={(e) => setNiche(e.target.value as Niche)} className={cx(inputClass, 'cursor-pointer')}>
            {NICHES.map((n) => (
              <option key={n} value={n}>
                {nicheName(n)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={niche === 'other' ? 'What do you sell?' : 'Sub-niche (optional)'}>
        <input
          value={nicheDetail}
          onChange={(e) => setNicheDetail(e.target.value)}
          required={niche === 'other'}
          maxLength={120}
          placeholder={niche === 'other' ? 'e.g. handmade ceramic planters' : 'e.g. dog travel gear'}
          className={inputClass}
        />
      </Field>
      <p className="-mt-2 text-xs text-muted">The squad reads its niche pack and tunes research, ads and copy to it. The more specific, the better.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Currency">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} required pattern="[A-Za-z]{3}" maxLength={3} placeholder="USD" className={cx(inputClass, 'uppercase')} />
        </Field>
        <Field label="Color">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className={cx(inputClass, 'h-[38px] w-full cursor-pointer p-1')} />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted">Once connected, the store takes the currency its platform reports.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Fees, % of revenue">
          <input type="number" value={feePercent} onChange={(e) => setFeePercent(e.target.value)} min={0} max={50} step={0.01} placeholder={`e.g. ${FEE_HINT[platform][0]}`} className={inputClass} />
        </Field>
        <Field label="Fees per order">
          <input type="number" value={feePerOrder} onChange={(e) => setFeePerOrder(e.target.value)} min={0} max={100} step={0.01} placeholder={`e.g. ${FEE_HINT[platform][1].toFixed(2)}`} className={inputClass} />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted">
        Typical on {PLATFORM_NAME[platform]}: {FEE_HINT[platform][0]}%{FEE_HINT[platform][1] > 0 && ` + ${FEE_HINT[platform][1].toFixed(2)} per order`}. Your estimate comes off profit; blank means none.
      </p>
      <Field label="Time zone">
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={cx(inputClass, 'cursor-pointer')}>
          {zones.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
        <span className="text-[11px] text-muted">Each day in its reports runs midnight to midnight here. A connected Shopify or WooCommerce store uses the shop's own.</span>
      </Field>
      {save.isError && (
        <p role="alert" className="text-xs text-red">
          {save.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button onClick={() => onDone()}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {store ? 'Save store' : 'Add store'}
        </Button>
      </div>
    </form>
  );
}
