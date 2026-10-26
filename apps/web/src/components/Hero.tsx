import type { ReactNode } from 'react';
import { Bell, ChevronDown, Search, type LucideIcon } from 'lucide-react';
import { useApprovals, useCommander, useSettings } from '../api/client';
import { cx } from './ui';

/** UI-05 scene behind the title: who stands in the red light, plus one prop that hints at the page. */
export type HeroArt = 'duo' | 'squad' | 'scan' | 'pulse' | 'lone';

const GLOW = 'drop-shadow-[0_0_24px_rgba(255,42,58,.4)]';

function Figure({ kind, className }: { kind: 'hood' | 'helm'; className: string }) {
  return (
    <svg className={cx('absolute -bottom-1.5', GLOW, className)} viewBox="0 0 64 64" aria-hidden="true">
      <use href={`#${kind}`} />
    </svg>
  );
}

// The lead hood always stands where hero-bg's red glow sits (right 30% from 900px); side figures appear from 1280px.
const LEAD = 'right-[8%] size-[172px] min-[900px]:right-[30%]';
const SIDE = 'hidden size-[118px] opacity-55 min-[1280px]:block';

function Scene({ art }: { art: HeroArt }) {
  return (
    <>
      {art === 'scan' && (
        <svg className="absolute right-[calc(8%-64px)] -bottom-[110px] size-[300px] min-[900px]:right-[calc(30%-64px)]" viewBox="0 0 300 300" aria-hidden="true">
          <g fill="none" stroke="var(--color-red)" strokeOpacity=".22">
            <circle cx="150" cy="150" r="60" />
            <circle cx="150" cy="150" r="100" strokeDasharray="2 6" />
            <circle cx="150" cy="150" r="140" />
            <path d="M150 0v28M150 272v28M0 150h28M272 150h28" strokeOpacity=".45" />
          </g>
        </svg>
      )}
      {art === 'pulse' && (
        <svg className={cx('absolute right-0 bottom-9 h-20 w-[62%]', GLOW)} viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 62 40 56l30 8 34-20 28 10 36-26 30 14 34-30 32 16 30-12 34 6 32-22 40-6" fill="none" stroke="var(--color-red)" strokeWidth="1.6" opacity=".55" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {(art === 'duo' || art === 'squad') && <Figure kind="helm" className={cx(SIDE, 'right-[41%]')} />}
      {art === 'squad' && <Figure kind="helm" className={cx(SIDE, 'right-[21%] -scale-x-100')} />}
      <Figure kind="hood" className={LEAD} />
    </>
  );
}

// Page hero: title, subtitle, red-lit character art over a skyline, and the top bar (Ask AI, bell, profile).
export function Hero({ title, subtitle, icon: Icon, art = 'lone', children }: { title: string; subtitle: string; icon?: LucideIcon; art?: HeroArt; children?: ReactNode }) {
  const pending = useApprovals().data?.length ?? 0;
  const profile = useSettings().data?.profile ?? { name: 'Owner', plan: '' };
  const commander = useCommander().data;
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
      <Scene art={art} />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="pt-[22px]">
          <h1 className="flex items-center gap-3 font-display text-[34px] leading-none font-bold tracking-[.06em] uppercase [text-shadow:0_2px_18px_rgba(0,0,0,.7)]">
            {Icon && <Icon aria-hidden className="size-[30px] shrink-0 text-red drop-shadow-[0_0_10px_rgba(255,42,58,.65)]" strokeWidth={2.2} />}
            {title}
          </h1>
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
            <span className="grid size-8 place-items-center rounded-full border border-red bg-[radial-gradient(circle_at_50%_35%,#45121a,#120507)] font-display text-sm font-bold">{profile.name.charAt(0).toUpperCase()}</span>
            <span>
              <span className="block text-[13px] leading-tight font-semibold">{profile.name}</span>
              <span className="block text-[11px] text-muted">
                {profile.plan || 'Owner'}
                {commander && ` · LV ${commander.level}`}
              </span>
            </span>
            <ChevronDown className="size-[15px] text-muted" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  );
}
