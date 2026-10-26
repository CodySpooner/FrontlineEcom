import type { AgentRole, Rank } from '@frontline/shared';
import { cx } from './ui';

// Character art, mounted once as an SVG sprite and drawn with <use href="#…">. Hood + helm come from the approved
// mockup (the hero uses them too); UI-08 adds one character per role, all in the same dark-armor + red-eye language.
const SHOULDERS = <path d="M4 64c2-9 10-15 18-16h20c8 1 16 7 18 16z" fill="#111114" />;
const SHELL = { fill: 'url(#hoodFill)', stroke: 'rgba(255,42,58,.5)', strokeWidth: 0.8 };
const EYE = { fill: '#ff2a3a', filter: 'url(#eyeGlow)' };
const TRIM = { fill: 'none', stroke: 'rgba(255,42,58,.35)', strokeWidth: 1 };

export function SvgDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <filter id="eyeGlow" x="-100%" y="-200%" width="300%" height="500%">
          <feGaussianBlur stdDeviation="1.1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="hoodFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#26262c" />
          <stop offset="1" stopColor="#0b0b0d" />
        </linearGradient>
      </defs>
      <symbol id="hood" viewBox="0 0 64 64">
        <path d="M4 64c2-9 10-15 18-16h20c8 1 16 7 18 16z" fill="#111114" />
        <path d="M32 3C17 3 9 16 9 30c0 12 6 22 12 26h22c6-4 12-14 12-26C55 16 47 3 32 3z" fill="url(#hoodFill)" stroke="rgba(255,42,58,.5)" strokeWidth=".8" />
        <path d="M32 15c-8 0-13 8-13 17 0 9 5 16 13 18 8-2 13-9 13-18 0-9-5-17-13-17z" fill="#040405" />
        <path d="M23 31l7 2.6v1.4l-7-2z" fill="#ff2a3a" filter="url(#eyeGlow)" />
        <path d="M41 31l-7 2.6v1.4l7-2z" fill="#ff2a3a" filter="url(#eyeGlow)" />
      </symbol>
      <symbol id="helm" viewBox="0 0 64 64">
        <path d="M4 64c2-9 10-15 18-16h20c8 1 16 7 18 16z" fill="#111114" />
        <path d="M32 6c-12 0-20 9-20 22v14c0 6 4 10 9 12l11 3 11-3c5-2 9-6 9-12V28C52 15 44 6 32 6z" fill="url(#hoodFill)" stroke="rgba(255,42,58,.5)" strokeWidth=".8" />
        <path d="M17 29h30l-3.5 7h-23z" fill="#040405" />
        <path d="M21 31.4h22l-1.5 2.4H22.5z" fill="#ff2a3a" filter="url(#eyeGlow)" />
        <path d="M32 7v9M24 44l8 3 8-3" stroke="rgba(255,42,58,.35)" strokeWidth="1" fill="none" />
      </symbol>
      <symbol id="horned" viewBox="0 0 64 64">
        {SHOULDERS}
        <path d="M17 25C10 21 8 12 10 3c3 7 7 11 13 13zM47 25c7-4 9-13 7-22-3 7-7 11-13 13z" {...SHELL} />
        <path d="M32 10c-11 0-18 8-18 20v12c0 6 4 10 9 12l9 3 9-3c5-2 9-6 9-12V30c0-12-7-20-18-20z" {...SHELL} />
        <path d="M20 30h24l-3 9H23z" fill="#040405" />
        <path d="M23 32l7 2v1.5l-7-1.5zM41 32l-7 2v1.5l7-1.5z" {...EYE} />
        <path d="M28 45h8M29 48h6" {...TRIM} />
      </symbol>
      <symbol id="masked" viewBox="0 0 64 64">
        {SHOULDERS}
        <path d="M32 3C17 3 9 16 9 30c0 12 6 22 12 26h22c6-4 12-14 12-26C55 16 47 3 32 3z" {...SHELL} />
        <path d="M32 15c-8 0-13 8-13 17 0 9 5 16 13 18 8-2 13-9 13-18 0-9-5-17-13-17z" fill="#040405" />
        <path d="M19.5 35c4 3 8 4 12.5 4s8.5-1 12.5-4v6c-3 6-7 9-12.5 10-5.5-1-9.5-4-12.5-10z" fill="#18181c" stroke="rgba(255,42,58,.35)" strokeWidth=".6" />
        <ellipse cx="26" cy="30.5" rx="3.2" ry="1.3" {...EYE} />
        <ellipse cx="38" cy="30.5" rx="3.2" ry="1.3" {...EYE} />
      </symbol>
      <symbol id="ninja" viewBox="0 0 64 64">
        {SHOULDERS}
        <path d="M32 8c-11 0-18 9-18 21 0 11 7 21 18 24 11-3 18-13 18-24 0-12-7-21-18-21z" {...SHELL} />
        <path d="M14.6 27h34.8v8H14.6z" fill="#040405" />
        <path d="M14.8 21.5h34.4v3H14.8zM49 22l10 3-8 1.5 7 6-10-4.5z" fill="#ff2a3a" opacity=".8" />
        <path d="M21 30.4h8l-1 1.7h-6zM35 30.4h8l-1 1.7h-6z" {...EYE} />
      </symbol>
      <symbol id="ram" viewBox="0 0 64 64">
        {SHOULDERS}
        <path d="M18 22c-8-2-13 4-11 11 2 6 9 7 11 2-4 1-7-1-6-4 1-4 5-4 7-2zM46 22c8-2 13 4 11 11-2 6-9 7-11 2 4 1 7-1 6-4-1-4-5-4-7-2z" fill="#1d1d22" stroke="rgba(255,42,58,.5)" strokeWidth=".8" />
        <path d="M32 9c-10 0-16 8-16 18v13c0 7 6 13 16 15 10-2 16-8 16-15V27c0-10-6-18-16-18z" {...SHELL} />
        <path d="M21 28h22v5h-8v14h-6V33h-8z" fill="#040405" />
        <path d="M23 29.5h7v2h-7zM34 29.5h7v2h-7z" {...EYE} />
      </symbol>
      <symbol id="crest" viewBox="0 0 64 64">
        {SHOULDERS}
        <path d="M23 15l1-11 5 8 3-10 3 10 5-8 1 11z" fill="#1d1d22" stroke="rgba(255,42,58,.5)" strokeWidth=".8" />
        <path d="M32 12c-10 0-16 8-16 18 0 10 6 20 16 23 10-3 16-13 16-23 0-10-6-18-16-18z" {...SHELL} />
        <path d="M19 28l11 3-1 4.5-9-2zM45 28l-11 3 1 4.5 9-2z" fill="#040405" />
        <path d="M21 30l8 2.2-.5 1.6-7-1.6zM43 30l-8 2.2.5 1.6 7-1.6z" {...EYE} />
        <path d="M27 44c3 2 7 2 10 0" {...TRIM} />
      </symbol>
      <symbol id="heavy" viewBox="0 0 64 64">
        <path d="M2 64c1-8 5-13 12-15l8-2v17zM62 64c-1-8-5-13-12-15l-8-2v17z" fill="#18181c" stroke="rgba(255,42,58,.35)" strokeWidth=".8" />
        <path d="M20 64V50h24v14z" fill="#111114" />
        <path d="M32 7c-12 0-19 8-19 19v15c0 7 5 12 12 13h14c7-1 12-6 12-13V26c0-11-7-19-19-19z" {...SHELL} />
        <path d="M18 27h28v6H18z" fill="#040405" />
        <circle cx="26" cy="30" r="1.7" {...EYE} />
        <circle cx="38" cy="30" r="1.7" {...EYE} />
        <path d="M26 39v8M29 39v9M32 39v9M35 39v9M38 39v8" {...TRIM} />
      </symbol>
    </svg>
  );
}

const LOOK: Record<AgentRole, string> = {
  ad_strategist: 'horned',
  product_hunter: 'helm',
  store_developer: 'hood',
  creative_studio: 'crest',
  market_analyst: 'ram',
  copywriter: 'masked',
  email_sms: 'ninja',
  operations: 'heavy',
};

/** Rank frames: the border heats up from grey (Recruit) to a double red ring with glow (Legend). */
const FRAME: Record<Rank, string> = {
  Recruit: 'border-line-3',
  Operative: 'border-red/30',
  Specialist: 'border-red/55',
  Veteran: 'border-red/80 shadow-glow',
  Elite: 'border-red shadow-glow outline-1 outline-offset-2 outline-red/40',
  Legend: 'border-red shadow-glow-lg outline-2 outline-offset-2 outline-red/75',
};

export function Portrait({ role, rank, className }: { role: AgentRole; rank?: Rank; className?: string }) {
  return (
    <div
      title={rank}
      className={cx(
        'shrink-0 overflow-hidden rounded-[9px] border bg-[radial-gradient(circle_at_50%_30%,rgb(255_42_58/.38),#0b0b0d_72%)]',
        rank ? FRAME[rank] : 'border-red/25',
        className ?? 'size-[42px]',
      )}
    >
      <svg viewBox="0 0 64 64" className="block size-full" aria-hidden="true">
        <use href={`#${LOOK[role]}`} />
      </svg>
    </div>
  );
}
