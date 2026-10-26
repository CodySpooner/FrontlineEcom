import { Dialog, Field, Switch, inputClass } from '../components/ui';
import { DISPLAY_LABELS, type DisplayOptions } from './display';
import { OFFICE_THEMES, themeId, type OfficeThemeId } from './themes';

export function OfficeSettings({ value, onChange, onClose, theme, onTheme }: { value: DisplayOptions; onChange: (value: DisplayOptions) => void; onClose: () => void; theme: OfficeThemeId; onTheme: (id: OfficeThemeId) => void }) {
  return <Dialog open onClose={onClose} title="Office Settings"><p className="eco-profile-copy">Choose what appears in your office. Preferences are saved on this device.</p><Field label="Office theme"><select className={inputClass} value={theme} onChange={(e) => onTheme(themeId(e.target.value))}>{Object.entries(OFFICE_THEMES).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}</select></Field><h3 className="eco-panel-heading">Display layers</h3><div className="eco-display-options">{(Object.keys(DISPLAY_LABELS) as (keyof DisplayOptions)[]).map((key) => <label key={key}><span>{DISPLAY_LABELS[key]}</span><Switch checked={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.checked })} /></label>)}</div></Dialog>;
}
