// SA-71 (decision 34): the Overview's trend. The period as a red line and area, the comparison dashed, a day with
// nothing reported a gap (never 0), today dashed and labelled "so far" when the period holds it. A text summary names
// the numbers for screen readers, and the Table toggle shows them. `marks` (SA-72) are dashed verticals topped by their
// number, or a red "!" for data health.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { SA_METRICS, type SaSeries, type SaSeriesPoint } from '@frontline/shared';
import { Table } from '../components/ui';
import { niceTicks } from '../lib/chart';
import { fmtDay, shortMoney } from '../lib/format';
import { fmtValue } from './KpiStrip';

const H = 186;
const [PL, PR, PB] = [46, 10, 22];

export type Mark = { date: string; label: string; red?: boolean };
const plusDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

/** Runs of consecutive reported points, as index lists: a null breaks the line. */
function runs(vals: (number | null)[]) {
  const out: number[][] = [];
  vals.forEach((v, i) => (v == null ? null : vals[i - 1] == null ? out.push([i]) : out.at(-1)!.push(i)));
  return out;
}

/** The comparison point's dates: the same offset into the comparison period. */
function previousSpan(s: SaSeries, i: number) {
  if (!s.compare || !('from' in s.compare)) return undefined;
  const from = plusDays(s.compare.from, i * (s.grain === 'week' ? 7 : 1));
  if (from > s.compare.to) return undefined;
  const to = s.grain === 'week' ? plusDays(from, 6) : from;
  return { from, to: to > s.compare.to ? s.compare.to : to };
}

const when = (s: SaSeries, p: SaSeriesPoint) => (s.grain === 'week' ? `${fmtDay(p.from)} – ${fmtDay(p.to)}` : `${weekday(p.from)} ${fmtDay(p.from)}`);

/** One sentence a screen reader gets instead of the picture. */
export function summary(s: SaSeries, label: string, currency?: string) {
  const f = (v: number) => fmtValue(s.metric, v, currency);
  const reported = s.points.filter((p) => p.value != null);
  const top = reported.reduce<SaSeriesPoint | undefined>((a, p) => (!a || p.value! > a.value! ? p : a), undefined);
  const missing = s.points.length - reported.length;
  const change = s.total.change.kind === 'pct' ? `, ${s.total.change.value >= 0 ? 'up' : 'down'} ${Math.abs(s.total.change.value).toFixed(1)}%` : s.total.change.kind === 'points' ? `, ${s.total.change.value >= 0 ? 'up' : 'down'} ${Math.abs(s.total.change.value).toFixed(2)} points` : '';
  const vs = s.compare && 'from' in s.compare ? ` vs ${fmtDay(s.compare.from)} – ${fmtDay(s.compare.to)}` : '';
  return [
    `${label} by ${s.grain}, ${fmtDay(s.period.from)} – ${fmtDay(s.period.to)}`,
    s.total.value == null ? ': not available' : `: ${f(s.total.value)}${change}${change && vs}`,
    top ? `. Highest ${when(s, top)}, ${f(top.value!)}` : '',
    missing ? `. ${missing} ${s.grain}${missing > 1 ? 's' : ''} not reported` : '',
    '.',
  ].join('');
}

export function TrendChart({ series: s, label, currency, table, marks = [] }: { series: SaSeries; label: string; currency?: string; table: boolean; marks?: Mark[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(740);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/[^\w-]/g, '');
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(e?.contentRect.width || 740));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);

  const f = (v: number) => fmtValue(s.metric, v, currency);
  const pts = s.points;
  if (table)
    return (
      <Table aria-label={`${label} by ${s.grain}`}>
        <thead>
          <tr>
            <th>{s.grain === 'week' ? 'Week' : 'Day'}</th>
            <th className="text-right!">{label}</th>
            {s.compare && 'from' in s.compare && <th className="text-right!">Previous</th>}
          </tr>
        </thead>
        <tbody>
          {pts.map((p, i) => {
            const prev = previousSpan(s, i);
            return (
              <tr key={p.from}>
                <td>
                  {when(s, p)}
                  {p.partial && <span className="text-muted"> · so far</span>}
                </td>
                <td className="text-right">{p.value == null ? <span className="text-muted">Not reported</span> : f(p.value)}</td>
                {s.compare && 'from' in s.compare && (
                  <td className="text-right text-text-2">
                    {p.previous == null ? <span className="text-muted">–</span> : f(p.previous)}
                    {prev && <span className="text-muted"> ({fmtDay(prev.from)})</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>
    );

  const n = pts.length;
  const PT = marks.length ? 24 : 12; // room for the marks' circles over the plot
  const all = pts.flatMap((p) => [p.value, p.previous]).filter((v): v is number => v != null);
  const ticks = niceTicks(Math.max(0, ...all) * 1.1, Math.min(0, ...all) * 1.1);
  const [lo, hi] = [ticks[0]!, ticks.at(-1)!];
  const x = (i: number) => PL + (n > 1 ? i / (n - 1) : 0.5) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const axis = (t: number) => (SA_METRICS[s.metric].unit === 'money' ? shortMoney(t, currency) : SA_METRICS[s.metric].unit === 'ratio' ? `${+(t * 100).toFixed(1)}%` : t.toLocaleString('en-US'));
  const path = (idx: number[], v: (i: number) => number) => idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v(i)).toFixed(1)}`).join(' ');
  const partial = pts.at(-1)?.partial && pts.at(-1)?.value != null && pts.at(-2)?.value != null;
  const cur = runs(pts.map((p, i) => (partial && i === n - 1 ? null : p.value)));
  const prev = runs(pts.map((p) => p.previous));
  const base = s.grain === 'week' ? 4 : 7; // weekly ticks, or every other week when a narrow chart can't fit their labels
  const step = base * Math.max(1, Math.ceil(56 / (((W - PL - PR) / Math.max(1, n - 1)) * base)));
  const i = hover == null ? null : Math.min(n - 1, Math.max(0, hover));
  const p = i == null ? undefined : pts[i];
  const pv = i == null ? undefined : previousSpan(s, i);
  const tipX = i == null ? 0 : x(i);
  const shift = tipX < 110 ? '0%' : tipX > W - 110 ? '-100%' : '-50%';

  const onMove = (e: PointerEvent<SVGSVGElement>) => setHover(Math.round(((e.clientX - e.currentTarget.getBoundingClientRect().left - PL) / (W - PL - PR)) * (n - 1)));
  const onKey = (e: KeyboardEvent) => {
    const to = { ArrowLeft: (i ?? n) - 1, ArrowRight: (i ?? -1) + 1, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setHover(Math.min(n - 1, Math.max(0, to)));
  };

  return (
    <div ref={wrap} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[186px] w-full touch-pan-y" role="img" aria-label={summary(s, label, currency)} tabIndex={0} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}>
        <defs>
          <linearGradient id={`ta${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-red)" stopOpacity=".32" />
            <stop offset="1" stopColor="var(--color-red)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="fill-[#7c7c86] text-[10.5px]">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} className="stroke-grid" />
              <text x={PL - 8} y={y(t) + 3.5} textAnchor="end">
                {axis(t)}
              </text>
            </g>
          ))}
          {pts.map((q, j) =>
            j % step === 0 ? (
              <text key={q.from} x={x(j)} y={H - 4} textAnchor={j === 0 ? 'start' : x(j) > W - 40 ? 'end' : 'middle'}>
                {fmtDay(q.from)}
              </text>
            ) : null,
          )}
        </g>
        {cur.map((r) => (
          <path key={`a${r[0]}`} d={`${path(r, (j) => pts[j]!.value!)} L${x(r.at(-1)!).toFixed(1)} ${y(Math.max(lo, 0)).toFixed(1)} L${x(r[0]!).toFixed(1)} ${y(Math.max(lo, 0)).toFixed(1)} Z`} fill={`url(#ta${uid})`} />
        ))}
        {prev.map((r) => (
          <path key={`p${r[0]}`} data-series="previous" d={path(r, (j) => pts[j]!.previous!)} fill="none" stroke="#6f6f78" strokeWidth="1.5" strokeDasharray="4 4" />
        ))}
        {cur.map((r) => (
          <path key={`c${r[0]}`} data-series="period" d={path(r, (j) => pts[j]!.value!)} fill="none" stroke="var(--color-red)" strokeWidth="2" strokeLinejoin="round" />
        ))}
        {cur.filter((r) => r.length === 1).map((r) => <circle key={`d${r[0]}`} cx={x(r[0]!)} cy={y(pts[r[0]!]!.value!)} r="2.5" className="fill-red" />)}
        {partial && <path data-series="partial" d={path([n - 2, n - 1], (j) => pts[j]!.value!)} fill="none" stroke="var(--color-red)" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />}
        {/* ponytail: two marks on one day overlap; the list under the chart names both */}
        {marks.map((m) => {
          const j = pts.findIndex((q) => q.from <= m.date && m.date <= q.to);
          if (j < 0) return null;
          return (
            <g key={`${m.label}${m.date}`} data-mark={m.label}>
              <line x1={x(j)} x2={x(j)} y1={16} y2={H - PB} stroke={m.red ? '#ff6b77' : '#8b8b94'} strokeDasharray="2 3" />
              <circle cx={x(j)} cy={8} r={7} fill={m.red ? '#2a1316' : '#1a1a1e'} stroke={m.red ? '#ff6b77' : '#8b8b94'} />
              <text x={x(j)} y={11.5} textAnchor="middle" className="fill-[#f0f0f2] text-[9.5px] font-bold">
                {m.label}
              </text>
            </g>
          );
        })}
        {p && (
          <>
            <line x1={tipX} x2={tipX} y1={PT} y2={H - PB} stroke="rgba(255,255,255,.22)" />
            {p.value != null && <circle cx={tipX} cy={y(p.value)} r="4.5" className="fill-red stroke-white" strokeWidth="2" />}
          </>
        )}
      </svg>
      {p && (
        <div aria-live="polite" className="pointer-events-none absolute top-1 rounded-md border border-line-2 bg-bg-2/95 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg" style={{ left: tipX, transform: `translateX(${shift})` }}>
          <b className="block font-semibold">
            {when(s, p)} · {p.value == null ? 'Not reported' : f(p.value)}
            {p.partial && <span className="font-normal text-muted"> so far</span>}
          </b>
          {pv && <span className="text-muted">Previous: {p.previous == null ? 'not reported' : f(p.previous)} ({s.grain === 'week' ? `${fmtDay(pv.from)} – ${fmtDay(pv.to)}` : fmtDay(pv.from)})</span>}
        </div>
      )}
    </div>
  );
}
