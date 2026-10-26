import type { ReactNode } from 'react';
import { Search, type LucideIcon } from 'lucide-react';
import { CommanderChip } from './Gamification';
import { NotificationBell } from './Notifications';
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
  return (
    <header className="titlebar hero-bg relative -mx-[22px] mb-4 min-h-[158px] overflow-hidden border-b border-line px-[22px] pt-5 pb-[26px]">
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
          {/* Below 900px it shrinks to an icon button the size of the bell. */}
          <button
            type="button"
            aria-label="Ask AI anything"
            onClick={() => window.dispatchEvent(new Event('frontline:ask'))}
            className="glass grid size-10 cursor-pointer place-items-center rounded-[11px] text-muted transition hover:text-text min-[900px]:flex min-[900px]:h-auto min-[900px]:w-[200px] min-[900px]:gap-2.5 min-[900px]:px-3 min-[900px]:py-[9px] min-[900px]:text-[13px] min-[1100px]:w-[280px]"
          >
            <Search className="size-[18px] min-[900px]:size-[15px]" strokeWidth={1.8} />
            <span className="hidden min-[900px]:inline">Ask AI anything…</span>
            <kbd className="ml-auto hidden rounded border border-line-2 px-1.5 font-sans text-[11px] text-muted min-[900px]:inline">Ctrl K</kbd>
          </button>
          <NotificationBell />
          <CommanderChip />
        </div>
      </div>
    </header>
  );
}
