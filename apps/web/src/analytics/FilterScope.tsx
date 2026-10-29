import { SA_FILTERS, type SaFilterScope } from '@frontline/shared';

/** The active filters a panel leaves out, with why ("no silently ignored filters", spec §4). Nothing when it applies them all. */
export function FilterScope({ scope }: { scope?: SaFilterScope }) {
  if (!scope?.ignored.length) return null;
  return (
    <p className="text-[12px] text-muted">
      Not applied here:{' '}
      {scope.ignored.map((f, i) => (
        <span key={`${f.key}:${f.metric ?? ''}`}>
          {i > 0 && '; '}
          <span className="text-text-2">{SA_FILTERS[f.key]}</span> ({f.reason})
        </span>
      ))}
    </p>
  );
}
