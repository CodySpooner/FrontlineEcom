// Settings frame (ST-02, board A1): the settings sidebar and a main column of at most 860 px under the page's Hero.
import type { ComponentType } from 'react';
import { Bell, Database, Gauge, Palette, Plug, Settings as Gear, Store, User, type LucideIcon } from 'lucide-react';
import type { SettingsSection } from '@frontline/shared';
import { Hero } from '../components/Hero';
import { NAV } from '../nav';
import { Integrations } from './integrations/Integrations';
import { Account } from './sections/Account';
import { Appearance } from './sections/Appearance';
import { General } from './sections/General';
import { Caps, YourData } from './sections/legacy';
import { Notifications } from './sections/Notifications';
import { Stores } from './sections/Stores';
import { Sidebar } from './Sidebar';

export type SettingsGroup = 'Personal' | 'Workspace' | 'AI & Connections' | 'Operations';

export interface SectionDef {
  slug: SettingsSection;
  group: SettingsGroup;
  label: string;
  icon: LucideIcon;
  /** The one line under the section title. */
  sub: string;
  Page: ComponentType;
}

/** The sections with content, in sidebar order. A section is listed in the same commit as its content (decision 1). */
export const SECTIONS: SectionDef[] = [
  { slug: 'account', group: 'Personal', label: 'Account', icon: User, sub: 'Your name as Frontline shows it.', Page: Account },
  { slug: 'appearance', group: 'Personal', label: 'Appearance', icon: Palette, sub: 'Motion, and what follows Windows.', Page: Appearance },
  { slug: 'notifications', group: 'Personal', label: 'Notifications', icon: Bell, sub: 'What lands in the bell.', Page: Notifications },
  { slug: 'general', group: 'Workspace', label: 'General', icon: Gear, sub: 'Preferences shared by every store.', Page: General },
  { slug: 'stores', group: 'Workspace', label: 'Stores', icon: Store, sub: 'Each store gets its own squad that learns its niche.', Page: Stores },
  {
    slug: 'integrations',
    group: 'AI & Connections',
    label: 'Integrations',
    icon: Plug,
    sub: 'Connect store platforms, ad accounts, analytics, suppliers and creative tools.',
    Page: () => <div data-legacy="ST-37a"><Integrations /></div>,
  },
  { slug: 'usage', group: 'Operations', label: 'Usage & Limits', icon: Gauge, sub: "Daily limits the agents can't cross, and what today has used.", Page: () => <div data-legacy="ST-24b"><Caps /></div> },
  { slug: 'data', group: 'Operations', label: 'Data & Backups', icon: Database, sub: 'Where your data lives on this computer, and its backups.', Page: () => <div data-legacy="ST-31"><YourData /></div> },
];

export function SettingsLayout({ section }: { section: SectionDef }) {
  // The Hero names the app-nav item that's lit: Integrations on its routes, Settings on the rest.
  const nav = NAV.find((n) => n.path === (section.slug === 'integrations' ? '/settings/integrations' : '/settings'))!;
  return (
    <>
      <Hero compact title={nav.title} icon={nav.icon} />
      {/* -mb-8 takes back the shell's bottom padding, so the sidebar's rule reaches the bottom without a scrollbar. */}
      <div className="-mx-[22px] -mb-8 flex min-h-[calc(100dvh-52px)] flex-col min-[900px]:flex-row">
        <Sidebar active={section.slug} />
        <section aria-labelledby="settings-title" className="min-w-0 flex-1">
          <div className="grid max-w-[860px] gap-[18px] px-4 pt-5 pb-16 min-[900px]:px-9 min-[900px]:pt-[26px]">
            <header>
              <h2 id="settings-title" className="text-[20px] font-semibold tracking-[-.01em]">
                {section.label}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-muted">{section.sub}</p>
            </header>
            <section.Page />
          </div>
        </section>
      </div>
    </>
  );
}
