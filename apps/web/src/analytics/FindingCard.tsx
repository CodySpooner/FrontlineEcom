// SA-77 (spec §10 Evidence-based findings): the Overview's finding card. Rule mode shows the rule engine's top insight:
// what was observed, the metric definitions it rests on, its limitation and where to look into it. Never a score or a
// confidence (decision 28). Agent mode and the Send to buttons come in SA-127.
import { Info, ListChecks, Scale } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { SA_DATASETS, SA_METRICS, type SaInsight, type SaRule } from '@frontline/shared';
import { Button, buttonClass, cx, Dialog, Tooltip } from '../components/ui';

/** Where a flag is looked into: another page, or an action on this one. */
export type Investigate = { to: string } | { onClick: () => void; title: string };

/** "How flags work": every rule with its threshold, minimum sample and datasets. */
export function RulesDialog({ rules, open, onClose }: { rules: SaRule[]; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="How flags work" width={640}>
      <div className="grid gap-3 text-[13px]">
        <p className="text-text-2">
          Each flag is a fixed rule over this store's own data: what was observed, never a score or a cause. A rule needs its minimum sample before it flags, and one that would flag on a source that is out of date or failing is held back and says
          so.
        </p>
        <ul className="grid gap-2.5">
          {rules.map((r) => (
            <li key={r.id} className="border-t border-line pt-2.5">
              <b className="font-semibold">{r.name}</b> <span className="font-mono text-[11px] text-muted">{r.id}</span>
              <p className="text-text-2">{r.when}</p>
              <p className="text-xs text-muted">
                Minimum sample: {r.minSample} · Reads: {r.datasets.length ? r.datasets.map((x) => SA_DATASETS[x]).join(', ') : "every source's sync status"}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

const TAG = { business: ['Observed', 'bg-[rgba(127,178,255,.13)] text-[#a9d2ff]'], data_health: ['Data health', 'bg-red-soft text-[#ff9aa3]'] } as const;
const LIMIT = { business: "What a fixed rule observed in this store's data, not why it happened.", data_health: 'Rules that read this source are held back until it syncs again.' };

/** The top insight, or with none the Rule card fallback (Q14). */
export function FindingCard({ insight, rules, investigate }: { insight?: SaInsight; rules: SaRule[]; investigate?: Investigate }) {
  const [how, setHow] = useState(false);
  const rule = insight && rules.find((r) => r.id === insight.rule);
  const [tag, tone] = TAG[insight?.kind ?? 'business'];
  return (
    <section aria-label="Finding" className="flex min-w-0 flex-col gap-2 rounded-xl border border-line-2 bg-[#121216] px-[15px] py-[13px]">
      <div className="flex items-center gap-2">
        <ListChecks aria-hidden className="size-3.5 text-muted" />
        <span className="text-xs text-text-2">{rule ? `Rule · ${rule.name}` : 'Rule'}</span>
        {insight && <span className={cx('ml-auto rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.08em] uppercase', tone)}>{tag}</span>}
      </div>
      <h3 className="text-[13.5px] leading-[1.35] font-semibold">{insight?.title ?? 'No flags right now'}</h3>
      <p className="text-[12.5px] leading-normal text-text-2">{insight ? insight.detail : `None of the ${rules.length} rules found anything in this period.`}</p>
      {!!rule?.metrics.length && (
        <div className="flex flex-wrap gap-[5px]">
          {rule.metrics.map((id) => (
            <Tooltip key={id} tip={SA_METRICS[id].formula}>
              <span tabIndex={0} className="inline-flex items-center gap-[5px] rounded-md border border-line-2 bg-bg-2 px-[7px] py-px text-[11.5px] whitespace-nowrap text-text-2">
                <Scale aria-hidden className="size-[11px] text-muted" />
                {SA_METRICS[id].label} v{SA_METRICS[id].version}
              </span>
            </Tooltip>
          ))}
        </div>
      )}
      {insight && (
        <span className="flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-muted">
          <Info aria-hidden className="mt-0.5 size-3 shrink-0" />
          {LIMIT[insight.kind]}
        </span>
      )}
      <div className="mt-auto flex gap-1.5">
        {!insight ? (
          <Button size="sm" onClick={() => setHow(true)}>
            How flags work
          </Button>
        ) : investigate && 'to' in investigate ? (
          <Link to={investigate.to} className={buttonClass('ghost', 'sm')}>
            Investigate
          </Link>
        ) : (
          investigate && (
            <Button size="sm" title={investigate.title} onClick={investigate.onClick}>
              Investigate
            </Button>
          )
        )}
      </div>
      {!insight && <RulesDialog rules={rules} open={how} onClose={() => setHow(false)} />}
    </section>
  );
}
