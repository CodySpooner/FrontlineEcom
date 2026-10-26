import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { niceMax } from '../lib/chart';
import { fmtDay, money, shortMoney } from '../lib/format';

const H = 250;
const PL = 46;
const PR = 12;
const PT = 14;
const PB = 28;

/** Single-series money area chart (ported from the mockup): crosshair + tooltip on hover, arrow keys when focused. */
export function AreaChart({ points, weekly, label }: { points: { date: string; value: number }[]; weekly?: boolean; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/[^\w-]/g, '');
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e?.contentRect.width || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  if (n < 2) return null;
  const max = niceMax(Math.max(...points.map((p) => p.value)) * 1.1);
  const x = (j: number) => PL + (j / (n - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - Math.max(0, v) / max) * (H - PT - PB);
  const line = points.map((p, j) => `${x(j).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const i = Math.min(n - 1, Math.max(0, hover ?? n - 3));
  const p = points[i]!;
  const px = x(i);
  const py = y(p.value);
  const shift = px < 80 ? '-12%' : px > W - 80 ? '-88%' : '-50%';

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const mx = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setHover(Math.round(((mx - PL) / (W - PL - PR)) * (n - 1)));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step) {
      e.preventDefault();
      setHover(Math.min(n - 1, Math.max(0, i + step)));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setHover(e.key === 'Home' ? 0 : n - 1);
    }
  };

  return (
    <div ref={wrap} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-[250px] w-full touch-none outline-none"
        role="img"
        aria-label={`${label}. Use arrow keys to read values.`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`area${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-red)" stopOpacity=".42" />
            <stop offset="1" stopColor="var(--color-red)" stopOpacity="0" />
          </linearGradient>
          <filter id={`glow${uid}`} x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="fill-muted text-[11px]">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={PL} x2={W - PR} y1={y(max * f)} y2={y(max * f)} className="stroke-grid" />
              <text x={PL - 8} y={y(max * f) + 4} textAnchor="end">
                {shortMoney(max * f)}
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const j = Math.round(f * (n - 1));
            return (
              <text key={f} x={x(j)} y={H - 8} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
                {fmtDay(points[j]!.date)}
              </text>
            );
          })}
        </g>
        <polygon points={`${PL},${y(0)} ${line} ${W - PR},${y(0)}`} fill={`url(#area${uid})`} />
        <polyline points={line} fill="none" stroke="var(--color-red)" strokeWidth="2.2" strokeLinejoin="round" filter={`url(#glow${uid})`} />
        <line x1={px} x2={px} y1={PT} y2={H - PB} stroke="rgba(255,255,255,.28)" />
        <circle cx={px} cy={py} r="4.5" className="fill-red stroke-white" strokeWidth="2" />
      </svg>
      <div
        aria-live="polite"
        className="pointer-events-none absolute rounded-[9px] border border-line-2 bg-bg-2/95 px-[11px] py-[7px] whitespace-nowrap shadow-[0_8px_24px_-6px_rgb(0_0_0/.55),0_0_18px_-8px_rgb(255_42_58/.35)]"
        style={{ left: px, top: py, transform: `translate(${shift}, calc(-100% - 14px))` }}
      >
        <b className="block font-display text-base">{money(p.value)}</b>
        <span className="text-[11px] text-muted">
          {weekly ? 'Week ending ' : ''}
          {fmtDay(p.date, true)}
        </span>
      </div>
    </div>
  );
}
