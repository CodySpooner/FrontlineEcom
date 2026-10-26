import type { ReactNode } from 'react';
import { Bell, ChevronDown, Search } from 'lucide-react';
import { useApprovals } from '../api/client';

// Page hero: title, subtitle, red-lit character art over a skyline, and the top bar (Ask AI, bell, profile).
// ponytail: one look for every page; UI-05 adds per-page art variants.
export function Hero({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  const pending = useApprovals().data?.length ?? 0;
  return (
    <header className="hero-bg relative -mx-[22px] mb-4 min-h-[158px] overflow-hidden border-b border-line px-[22px] pt-5 pb-[26px]">
      <svg className="absolute bottom-0 left-0 h-16 w-full" viewBox="0 0 850 80" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M0 80V54h30V40h22v18h26V30h14v-8h12v22h30v-10h26v26h20V28h24v20h26V36h14V20h18v24h28v14h30V32h22v16h30V30h18V14h12v24h30v14h28V36h26v12h30V26h22v16h28v16h26V36h22V22h14v22h30v10h28V32h20v14h28V28h22v24h26V40h30v16h38v24z"
          fill="#09090b"
          stroke="rgba(255,42,58,.3)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <svg className="absolute right-[41%] -bottom-1.5 hidden size-[118px] opacity-55 drop-shadow-[0_0_24px_rgba(255,42,58,.4)] min-[1280px]:block" viewBox="0 0 64 64" aria-hidden="true">
        <use href="#helm" />
      </svg>
      <svg className="absolute right-[8%] -bottom-1.5 size-[172px] drop-shadow-[0_0_24px_rgba(255,42,58,.4)] min-[900px]:right-[30%]" viewBox="0 0 64 64" aria-hidden="true">
        <use href="#hood" />
      </svg>
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="pt-[22px]">
          <h1 className="font-display text-[34px] leading-none font-bold tracking-[.06em] uppercase [text-shadow:0_2px_18px_rgba(0,0,0,.7)]">{title}</h1>
          <p className="mt-[9px] font-display text-[13px] font-semibold tracking-[.17em] text-text-2 uppercase">{subtitle}</p>
          {children}
        </div>
        <div className="flex items-center gap-3">
          {/* ponytail: opens nothing until the Ask AI palette lands (UI-19) */}
          <button type="button" className="glass hidden w-[200px] cursor-pointer items-center gap-2.5 rounded-[11px] px-3 py-[9px] text-[13px] text-muted transition hover:text-text min-[900px]:flex min-[1100px]:w-[280px]">
            <Search className="size-[15px]" strokeWidth={1.8} />
            Ask AI anything…
            <kbd className="ml-auto rounded border border-line-2 px-1.5 font-sans text-[11px] text-muted">Ctrl K</kbd>
          </button>
          <button type="button" aria-label={`Notifications: ${pending} waiting`} className="glass relative grid size-10 cursor-pointer place-items-center rounded-[11px] text-text-2 transition hover:text-white">
            <Bell className="size-[18px]" strokeWidth={1.8} />
            {pending > 0 && (
              <b className="absolute -top-1.5 -right-1.5 h-[19px] min-w-[19px] rounded-[10px] bg-red px-[5px] text-center text-[11px] leading-[19px] font-bold text-white shadow-glow">{pending}</b>
            )}
          </button>
          <button type="button" className="glass flex cursor-pointer items-center gap-2.5 rounded-[13px] py-[5px] pr-2.5 pl-[5px] text-left">
            <span className="grid size-8 place-items-center rounded-full border border-red bg-[radial-gradient(circle_at_50%_35%,#45121a,#120507)] font-display text-sm font-bold">X</span>
            <span>
              <span className="block text-[13px] leading-tight font-semibold">Xody</span>
              <span className="block text-[11px] text-muted">Owner</span>
            </span>
            <ChevronDown className="size-[15px] text-muted" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  );
}
