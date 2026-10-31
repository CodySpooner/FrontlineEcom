// SA-89 (decision 34): one count as bars a day (a week past 120 days), the product drawer's units sold. A day with
// nothing reported has no bar (never 0); a reported 0 is a hairline; today's bar is faint, "so far". The text summary
// names the numbers for screen readers and the Table toggle shows them.
import type { SaSeriesPoint } from '@frontline/shared';
import { cx, Table } from '../components/ui';
import { niceTicks } from '../lib/chart';
import { fmtDay } from '../lib/format';

const [W, H, PL, PR, PT, PB] = [490, 112, 28, 2, 8, 16]; // the board's

const num = (v: number) => v.toLocaleString('en-US');
const when = (p: SaSeriesPoint, grain: 'day' | 'week') => (grain === 'week' ? `${fmtDay(p.from)} – ${fmtDay(p.to)}` : fmtDay(p.from));

/** One sentence a screen reader gets instead of the picture. */
export function barSummary(points: SaSeriesPoint[], grain: 'day' | 'week', label: string) {
  const reported = points.filter((p) => p.value != null);
  const top = reported.reduce<SaSeriesPoint | undefined>((a, p) => (!a || p.value! > a.value! ? p : a), undefined);
  const missing = points.length - reported.length;
  return [
    points.length ? `${label}, ${fmtDay(points[0]!.from)} – ${fmtDay(points.at(-1)!.to)}` : label,
    reported.length ? `: ${num(reported.reduce((a, p) => a + p.value!, 0))} in all` : ': none reported',
    top?.value ? `. Most on ${when(top, grain)}, ${num(top.value)}` : '',
    missing ? `. ${missing} ${grain}${missing > 1 ? 's' : ''} not reported` : '',
    '.',
  ].join('');
}

export function BarChart({ points, grain, label, table }: { points: SaSeriesPoint[]; grain: 'day' | 'week'; label: string; table: boolean }) {
  if (table)
    return (
      <Table aria-label={label}>
        <thead>
          <tr>
            <th>{grain === 'week' ? 'Week' : 'Day'}</th>
            <th className="text-right!">Units</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.from}>
              <td>
                {when(p, grain)}
                {p.partial && <span className="text-muted"> · so far</span>}
              </td>
              <td className="text-right">{p.value == null ? <span className="text-muted">Not reported</span> : num(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    );

  const ticks = niceTicks(Math.max(0, ...points.map((p) => p.value ?? 0)) * 1.1);
  const hi = ticks.at(-1)!;
  const y = (v: number) => PT + (1 - v / hi) * (H - PT - PB);
  const slot = (W - PL - PR) / Math.max(1, points.length);
  const bw = Math.max(1, Math.min(11, slot - 4));
  const mid = Math.floor((points.length - 1) / 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={barSummary(points, grain, label)}>
      <g className="fill-[#7c7c86] text-[10.5px]">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} className="stroke-grid" />
            <text x={PL - 6} y={y(t) + 3} textAnchor="end">
              {num(t)}
            </text>
          </g>
        ))}
        {[...new Set([0, mid, points.length - 1])].map((i) =>
          points[i] ? (
            <text key={i} x={PL + (i + 0.5) * slot} y={H - 2} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
              {fmtDay(points[i]!.from)}
            </text>
          ) : null,
        )}
      </g>
      {points.map((p, i) =>
        p.value == null ? null : (
          <rect key={p.from} data-day={p.from} x={PL + i * slot + (slot - bw) / 2} y={Math.min(y(p.value), y(0) - 1)} width={bw} height={Math.max(1, y(0) - y(p.value))} rx={p.value ? 2 : 0} className={cx('fill-red', p.partial && 'opacity-45')}>
            <title>{`${when(p, grain)}: ${num(p.value)}${p.partial ? ' so far' : ''}`}</title>
          </rect>
        ),
      )}
    </svg>
  );
}
