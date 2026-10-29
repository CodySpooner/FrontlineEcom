// The settings sidebar (board A1): 248 px of grouped sections. Below 900 px (the shell's breakpoint) it's a section select.
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { SettingsSection } from '@frontline/shared';
import { useIntegrations, useStores } from '../api/client';
import { cx, inputClass } from '../components/ui';
import { SECTIONS, type SettingsGroup } from './Layout';

const GROUPS: SettingsGroup[] = ['Personal', 'Workspace', 'AI & Connections', 'Operations'];

/** Badges from real data only: the store count, and integrations whose last sync failed. */
function useBadges(): Partial<Record<SettingsSection, { text: string; warn?: boolean }>> {
  const stores = useStores().data;
  const issues = useIntegrations().data?.filter((i) => i.status === 'error').length ?? 0;
  return {
    ...(stores && { stores: { text: String(stores.length) } }),
    ...(issues > 0 && { integrations: { text: `${issues} issue${issues > 1 ? 's' : ''}`, warn: true } }),
  };
}

export function Sidebar({ active }: { active: SettingsSection }) {
  const badges = useBadges();
  const navigate = useNavigate();
  // The store being edited carries over from section to section.
  const store = useSearchParams()[0].get('store');
  const to = (slug: SettingsSection) => `/settings/${slug}${store ? `?store=${encodeURIComponent(store)}` : ''}`;
  const groups = GROUPS.map((g) => ({ g, items: SECTIONS.filter((s) => s.group === g) })).filter((x) => x.items.length);
  return (
    <>
      <nav aria-label="Settings" className="hidden w-[248px] shrink-0 flex-col border-r border-[#1d1d22] bg-[#0a0a0c] px-3 py-4 min-[900px]:flex">
        {groups.map(({ g, items }) => (
          <div key={g}>
            <div id={`settings-group-${g.replace(/\W+/g, '-')}`} className="px-2.5 pt-3.5 pb-1.5 text-[10.5px] font-semibold tracking-[.09em] text-muted uppercase">
              {g}
            </div>
            <ul aria-labelledby={`settings-group-${g.replace(/\W+/g, '-')}`}>
              {items.map((s) => {
                const on = s.slug === active;
                const b = badges[s.slug];
                return (
                  <li key={s.slug}>
                    <Link
                      to={to(s.slug)}
                      aria-current={on ? 'page' : undefined}
                      className={cx(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]',
                        on ? 'bg-panel-2 text-white shadow-[inset_2px_0_0_var(--color-red)]' : 'text-text-2 hover:bg-panel hover:text-white',
                      )}
                    >
                      <s.icon aria-hidden className={cx('size-4 shrink-0', on ? 'text-text' : 'text-muted')} strokeWidth={1.8} />
                      <span className="min-w-0 truncate">{s.label}</span>
                      {b && <span className={cx('ml-auto text-[11px] tabular-nums', b.warn ? 'text-amber' : 'text-muted')}>{b.text}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <label className="px-4 pt-4 min-[900px]:hidden">
        <span className="sr-only">Settings section</span>
        <select value={active} onChange={(e) => navigate(to(e.target.value as SettingsSection))} className={cx(inputClass, 'w-full cursor-pointer')}>
          {groups.map(({ g, items }) => (
            <optgroup key={g} label={g}>
              {items.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.label}
                  {badges[s.slug] ? ` (${badges[s.slug]!.text})` : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </>
  );
}
