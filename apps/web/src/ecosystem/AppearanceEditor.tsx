import { OFFICE_ARCHETYPES, OFFICE_GEAR, type OfficeAppearance } from '@frontline/shared';
import { Button, Field, inputClass } from '../components/ui';
import { WorkerPortrait } from './WorkerPortrait';
import { ARCHETYPE_LABELS, GEAR_LABELS, appearanceFor } from './characters';

export function AppearanceEditor({ value, onChange, role }: { role?: string; value: OfficeAppearance; onChange: (look: OfficeAppearance) => void }) {
  return <div className="eco-appearance"><div className="eco-look-preview"><WorkerPortrait role={role} appearance={value} name="Worker preview" /><Button size="sm" type="button" onClick={() => onChange(appearanceFor(crypto.randomUUID()))}>Randomize look</Button></div><div className="eco-form-grid">
    <Field label="Character type"><select className={inputClass} value={value.archetype} onChange={(e) => onChange({ ...value, archetype: e.target.value as OfficeAppearance['archetype'] })}>{OFFICE_ARCHETYPES.map((x, i) => <option value={x} key={x}>{ARCHETYPE_LABELS[i]}</option>)}</select></Field>
    <Field label="Equipment"><select className={inputClass} value={value.gear} onChange={(e) => onChange({ ...value, gear: e.target.value as OfficeAppearance['gear'] })}>{OFFICE_GEAR.map((x, i) => <option value={x} key={x}>{GEAR_LABELS[i]}</option>)}</select></Field>
    <Field label="Outfit"><select className={inputClass} value={value.outfit} onChange={(e) => onChange({ ...value, outfit: e.target.value as OfficeAppearance['outfit'] })}>{['jacket', 'suit', 'hoodie'].map((x) => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Accessory"><select className={inputClass} value={value.accessory} onChange={(e) => onChange({ ...value, accessory: e.target.value as OfficeAppearance['accessory'] })}>{['none', 'headset', 'glasses'].map((x) => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Hair"><select className={inputClass} value={value.hair} onChange={(e) => onChange({ ...value, hair: Number(e.target.value) })}>{['Midnight', 'Copper', 'Silver', 'Gold', 'Violet', 'Teal'].map((x, i) => <option value={i} key={x}>{x}</option>)}</select></Field>
    <Field label="Skin tone"><select className={inputClass} value={value.skin} onChange={(e) => onChange({ ...value, skin: Number(e.target.value) })}>{['Light', 'Tan', 'Brown', 'Deep'].map((x, i) => <option value={i} key={x}>{x}</option>)}</select></Field>
    <Field label="Outfit color"><input type="color" value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })} /></Field>
    <Field label="Glow color"><input type="color" value={value.accent} onChange={(e) => onChange({ ...value, accent: e.target.value })} /></Field>
  </div></div>;
}
