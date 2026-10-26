import { Dialog, Switch } from '../components/ui';
import { DISPLAY_LABELS, type DisplayOptions } from './display';

export function OfficeSettings({ value, onChange, onClose }: { value: DisplayOptions; onChange: (value: DisplayOptions) => void; onClose: () => void }) {
  return <Dialog open onClose={onClose} title="Office Settings"><p className="eco-profile-copy">Choose what appears in your office. Preferences are saved on this device.</p><div className="eco-display-options">{(Object.keys(DISPLAY_LABELS) as (keyof DisplayOptions)[]).map((key) => <label key={key}><span>{DISPLAY_LABELS[key]}</span><Switch checked={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.checked })} /></label>)}</div></Dialog>;
}
