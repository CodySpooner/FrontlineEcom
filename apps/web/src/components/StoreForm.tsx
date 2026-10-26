// Add or edit a store (Settings, onboarding).
import { useState, type FormEvent } from 'react';
import { NICHES, PLATFORMS, type Niche, type Platform, type Store } from '@frontline/shared';
import { useStoreActions } from '../api/client';
import { Button, cx, Field, inputClass } from './ui';

export const PLATFORM_NAME: Record<Platform, string> = { shopify: 'Shopify', tiktok_shop: 'TikTok Shop', etsy: 'Etsy', amazon: 'Amazon', woocommerce: 'WooCommerce', walmart: 'Walmart' };
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
  const [timezone, setTimezone] = useState(store?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  // The saved zone stays pickable even when this browser's list leaves it out (e.g. "UTC").
  const [zones] = useState(() => [...new Set([timezone, ...Intl.supportedValuesOf('timeZone')])]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { id: store?.id, name: name.trim(), platform, niche, ...(nicheDetail.trim() && { nicheDetail: nicheDetail.trim() }), currency: currency.trim().toUpperCase(), timezone, color },
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
      <Field label="Time zone">
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={cx(inputClass, 'cursor-pointer')}>
          {zones.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
        <span className="text-[11px] text-muted">Each day in its reports runs midnight to midnight here. A connected Shopify store uses the shop's own.</span>
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
