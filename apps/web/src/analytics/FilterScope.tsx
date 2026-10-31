import { SA_FILTERS, SA_METRICS, type SaFilterScope, type SaMetricId } from '@frontline/shared';

/**
 * The active filters a panel leaves out, with why ("no silently ignored filters", spec §4). Nothing when it applies them
 * all. One line per filter and reason; a panel of several metrics names the ones each covers.
 */
export function FilterScope({ scope }: { scope?: SaFilterScope }) {
  if (!scope?.ignored.length) return null;
  const many = new Set(scope.ignored.map((f) => f.metric)).size > 1;
  const groups = new Map<string, { key: keyof typeof SA_FILTERS; reason: string; metrics: string[] }>();
  for (const f of scope.ignored) {
    const k = `${f.key}:${f.reason}`;
    if (!groups.has(k)) groups.set(k, { key: f.key, reason: f.reason, metrics: [] });
    if (f.metric) groups.get(k)!.metrics.push(SA_METRICS[f.metric as SaMetricId]?.label ?? f.metric);
  }
  return (
    <p className="text-[12px] text-muted">
      Not applied here:{' '}
      {[...groups].map(([k, g], i) => (
        <span key={k}>
          {i > 0 && '; '}
          <span className="text-text-2">{SA_FILTERS[g.key]}</span> ({g.reason}
          {many && g.metrics.length > 0 && `: ${g.metrics.join(', ')}`})
        </span>
      ))}
    </p>
  );
}
