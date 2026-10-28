import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Search, type LucideIcon } from 'lucide-react';
import { useSettings } from '../api/client';
import { NotificationBell } from './Notifications';

export function Hero({ title, subtitle, icon: Icon, children }: { title: string; subtitle: string; icon?: LucideIcon; children?: ReactNode }) {
  const profile = useSettings().data?.profile ?? { name: 'Owner', plan: '' };
  return (
    <header className="titlebar hero-bg relative -mx-[22px] mb-4 border-b border-line px-[22px] pt-5 pb-[26px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="pt-[22px]">
          <h1 className="flex items-center gap-3 font-display text-[34px] leading-none font-bold tracking-[.06em] uppercase">
            {Icon && <Icon aria-hidden className="size-[30px] shrink-0 text-red drop-shadow-[0_0_10px_rgba(255,42,58,.65)]" strokeWidth={2.2} />}
            {title}
          </h1>
          <p className="mt-[9px] font-display text-[13px] font-semibold tracking-[.17em] text-text-2 uppercase">{subtitle}</p>
          {children}
        </div>
        <div className="flex items-center gap-3">
          {/* Below 900px it shrinks to an icon button the size of the bell. */}
          <button
            type="button"
            aria-label="Ask AI anything"
            onClick={() => window.dispatchEvent(new Event('frontline:ask'))}
            className="glass grid size-10 cursor-pointer place-items-center rounded-[11px] text-muted transition hover:text-text min-[900px]:flex min-[900px]:h-auto min-[900px]:w-[200px] min-[900px]:gap-2.5 min-[900px]:px-3 min-[900px]:py-[9px] min-[900px]:text-[13px] min-[1100px]:w-[280px]"
          >
            <Search className="size-[18px] min-[900px]:size-[15px]" strokeWidth={1.8} />
            <span className="hidden whitespace-nowrap min-[900px]:inline">Ask AI anything…</span>
            {/* The hint only fits the wider field (1100px up): at 200px it pushed the words onto two lines. */}
            <kbd className="ml-auto hidden rounded border border-line-2 px-1.5 font-sans text-[11px] text-muted min-[1100px]:inline">Ctrl K</kbd>
          </button>
          <NotificationBell />
          <Link to="/settings" className="glass flex items-center gap-2.5 rounded-[13px] py-[5px] pr-2.5 pl-[5px]">
            <span className="grid size-8 place-items-center rounded-full border border-red bg-[radial-gradient(circle_at_50%_35%,#45121a,#120507)] font-display text-sm font-bold">{profile.name.charAt(0).toUpperCase()}</span>
            <span>
              <span className="block text-[13px] leading-tight font-semibold">{profile.name}</span>
              <span className="block text-[11px] text-muted">{profile.plan || 'Owner'}</span>
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
