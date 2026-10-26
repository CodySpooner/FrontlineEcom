import { AGENT_ROLES, type AgentRole } from '@frontline/shared';
import { cx } from './ui';

// Character art from the approved mockup, mounted once as an SVG sprite and drawn with <use href="#hood|#helm">.
// ponytail: two looks shared by all roles; UI-08 gives each role its own character.
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
    </svg>
  );
}

const ROLES = Object.keys(AGENT_ROLES) as AgentRole[];

export function Portrait({ role, className }: { role: AgentRole; className?: string }) {
  return (
    <div className={cx('shrink-0 overflow-hidden rounded-[9px] border border-red/25 bg-[radial-gradient(circle_at_50%_30%,rgb(255_42_58/.38),#0b0b0d_72%)]', className ?? 'size-[42px]')}>
      <svg viewBox="0 0 64 64" className="block size-full" aria-hidden="true">
        <use href={ROLES.indexOf(role) % 2 ? '#helm' : '#hood'} />
      </svg>
    </div>
  );
}
