// Settings (docs/features/settings.md, docs/backlog/settings.md): section slugs and the one link builder the web and
// the server's notifications use.

/** Every Settings section slug. The web lists only the ones with content (`SECTIONS` in apps/web/src/settings/Layout.tsx). */
export const SETTINGS_SECTIONS = [
  'account',
  'appearance',
  'notifications',
  'general',
  'stores',
  'agents',
  'integrations',
  'knowledge',
  'product-research',
  'automation',
  'usage',
  'data',
  'history',
  'advanced',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** `/settings/<section>[/<id>][?store=<id>][#<setting>]`: the only way to link into Settings. */
export function settingsUrl(section: SettingsSection, o: { id?: string; store?: string; setting?: string } = {}) {
  return `/settings/${section}${o.id ? `/${encodeURIComponent(o.id)}` : ''}${o.store ? `?store=${encodeURIComponent(o.store)}` : ''}${o.setting ? `#${o.setting}` : ''}`;
}
