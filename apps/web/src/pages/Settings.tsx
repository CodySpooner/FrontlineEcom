// Settings (docs/features/settings.md): the router entry for /settings/*. One element stays mounted across sections.
import { Navigate, useLocation } from 'react-router';
import { SECTIONS, SettingsLayout } from '../settings/Layout';

export function Settings() {
  const { pathname, search, hash } = useLocation();
  const slug = pathname.split('/')[2];
  const section = SECTIONS.find((s) => s.slug === slug);
  // /settings, and a section that has no content yet, land on General.
  if (!section) return <Navigate to={`/settings/general${search}${hash}`} replace />;
  return <SettingsLayout section={section} />;
}
