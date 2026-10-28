import { useState } from 'react';
import type { PrStoreProfile } from '@frontline/shared';
import { Button, Dialog, Field, inputClass } from '../components/ui';
import { useSaveProfile } from './api';
import { fromMinor, toMinor } from './format';

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const LISTS = [
  ['warehouses', 'Preferred warehouses', 'Two-letter country codes, e.g. US, CN'],
  ['includeCategories', 'Included categories', 'Store scope shows only these (unknown categories are kept)'],
  ['avoidCategories', 'Avoided categories', 'Flagged, never hidden'],
  ['avoidTerms', 'Avoided terms', 'Flagged, never hidden'],
  ['keywords', 'Saved keywords', 'Comma separated'],
] as const;

/** "Edit research profile" (decision 5): saving re-evaluates the store's fit, scope and flags on the server. */
export function ProfileDialog({ open, onClose, store, storeName, profile }: { open: boolean; onClose: () => void; store: string; storeName: string; profile: PrStoreProfile }) {
  const c = profile.priceCurrency;
  const init = () => ({
    audience: profile.audience ?? '',
    priceMin: fromMinor(profile.priceMin, c),
    priceMax: fromMinor(profile.priceMax, c),
    shipTo: profile.shipToDefault ? '' : (profile.shipTo ?? ''),
    maxDeliveryDays: profile.maxDeliveryDays === null ? '' : String(profile.maxDeliveryDays),
    ...Object.fromEntries(LISTS.map(([k]) => [k, profile[k].join(', ')])),
  }) as Record<string, string>;
  const [f, setF] = useState(init);
  const [bad, setBad] = useState('');
  const save = useSaveProfile(store);
  const field = (k: string) => ({ value: f[k] ?? '', onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }), className: inputClass });

  const submit = () => {
    const money = (k: 'priceMin' | 'priceMax') => (f[k]!.trim() ? toMinor(f[k]!, c) : null);
    const [min, max] = [money('priceMin'), money('priceMax')];
    if ((f.priceMin!.trim() && min === null) || (f.priceMax!.trim() && max === null)) return setBad(`Enter the price band as amounts in ${c}, like 15 or 39.99.`);
    const days = f.maxDeliveryDays!.trim();
    if (days && !/^\d+$/.test(days)) return setBad('Maximum delivery is a whole number of days.');
    setBad('');
    save.mutate(
      {
        audience: f.audience!.trim() || null,
        priceMin: min,
        priceMax: max,
        shipTo: f.shipTo!.trim() || null,
        maxDeliveryDays: days ? Number(days) : null,
        ...Object.fromEntries(LISTS.map(([k]) => [k, list(f[k]!)])),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      side="right"
      title="Edit research profile"
      subtitle={`How products are ranked and flagged for ${storeName}`}
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-4 overflow-y-auto p-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Audience">
          <input {...field('audience')} placeholder="e.g. US dog owners who groom at home" maxLength={500} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Sells at, from (${c})`}>
            <input {...field('priceMin')} inputMode="decimal" placeholder="Not set" />
          </Field>
          <Field label={`To (${c})`}>
            <input {...field('priceMax')} inputMode="decimal" placeholder="Not set" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ship to">
            <input {...field('shipTo')} maxLength={2} placeholder={profile.shipToDefault && profile.shipTo ? `${profile.shipTo} (default)` : 'Country code'} />
          </Field>
          <Field label="Maximum delivery (days)">
            <input {...field('maxDeliveryDays')} inputMode="numeric" placeholder="Not set" />
          </Field>
        </div>
        {LISTS.map(([k, label, hint]) => (
          <Field key={k} label={label}>
            <input {...field(k)} placeholder={hint} />
          </Field>
        ))}
        {(bad || save.error) && (
          <p role="alert" className="text-[12.5px] text-red">
            {bad || save.error?.message}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
