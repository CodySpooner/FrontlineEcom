import type { OfficeAppearance } from '@frontline/shared';
import { Field, inputClass } from '../components/ui';
import { WorkerPortrait } from './WorkerPortrait';

export function AppearanceEditor({ value, onChange }: { value: OfficeAppearance; onChange: (look: OfficeAppearance) => void }) {
  return <div className="eco-appearance"><WorkerPortrait appearance={value} name="Worker preview" /><div className="eco-form-grid">
    <Field label="Outfit"><select className={inputClass} value={value.outfit} onChange={(e) => onChange({ ...value, outfit: e.target.value as OfficeAppearance['outfit'] })}>{['jacket', 'suit', 'hoodie'].map((x) => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Accessory"><select className={inputClass} value={value.accessory} onChange={(e) => onChange({ ...value, accessory: e.target.value as OfficeAppearance['accessory'] })}>{['none', 'headset', 'glasses'].map((x) => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Hair"><select className={inputClass} value={value.hair} onChange={(e) => onChange({ ...value, hair: Number(e.target.value) })}>{['Midnight', 'Copper', 'Silver', 'Gold', 'Violet', 'Teal'].map((x, i) => <option value={i} key={x}>{x}</option>)}</select></Field>
    <Field label="Skin tone"><select className={inputClass} value={value.skin} onChange={(e) => onChange({ ...value, skin: Number(e.target.value) })}>{['Light', 'Warm', 'Deep', 'Medium'].map((x, i) => <option value={i} key={x}>{x}</option>)}</select></Field>
    <Field label="Outfit color"><input type="color" value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })} /></Field>
  </div></div>;
}
