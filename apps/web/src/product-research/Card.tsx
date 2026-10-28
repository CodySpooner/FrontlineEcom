import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Eye, Package } from 'lucide-react';
import { PR_FIT_LABEL, PR_FULFILLMENT_LABEL, PR_STAGE_LABEL, PR_TASK_STATUS_LABEL, type PrCard, type PrFulfillment, type PrStage, type PrTaskStatus } from '@frontline/shared';
import { cx } from '../components/ui';
import { ago } from '../lib/format';
import { useWatch } from './api';
import { conditionsLine, demandLines, minorMoney, sourceLine } from './format';

// The board's pills (docs/reference/product-research-workspace.html `.pill`, `.good`, `.warn`, `.bad`, `.run`).
const PILL = 'inline-flex items-center gap-1 rounded-md border px-[7px] py-0.5 text-[11px] font-semibold';
export const TONE = {
  muted: 'border-line-2 bg-bg-2 text-text-2',
  good: 'border-good/35 bg-good/8 text-good',
  warn: 'border-amber/35 bg-amber/8 text-amber',
  bad: 'border-red/40 bg-red/10 text-[#ff5a66]',
  run: 'border-[#7cb4ff]/35 bg-[#7cb4ff]/8 text-[#8cbcff]',
};
export const Pill = ({ tone = 'muted', className, children }: { tone?: keyof typeof TONE; className?: string; children: ReactNode }) => <span className={cx(PILL, TONE[tone], className)}>{children}</span>;

const FULFILLMENT_TONE: Record<PrFulfillment, keyof typeof TONE> = { verified: 'good', pending: 'run', insufficient: 'warn', not_eligible: 'bad' };
const STAGE_TONE: Partial<Record<PrStage, keyof typeof TONE>> = { researching: 'run', shortlisted: 'good', ready_to_test: 'good', testing: 'run', scaled: 'good', rejected: 'bad' };
export const TASK_TONE: Partial<Record<PrTaskStatus, keyof typeof TONE>> = { queued: 'run', running: 'run', waiting_for_you: 'warn', awaiting_approval: 'warn', report_ready: 'good', not_started: 'bad', interrupted: 'warn', failed: 'bad' };

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-2.5 border-b border-dashed border-line py-[5px] last:border-b-0">
    <span className="text-muted">{label}</span>
    <span className="min-w-0 text-right text-text-2">{children}</span>
  </div>
);
const Sub = ({ children }: { children: ReactNode }) => <span className="block text-[11px] text-muted">{children}</span>;

/** The card's watch toggle: the store's list, or the owner's all-stores list. It never opens the card. */
function WatchEye({ c, scope }: { c: PrCard; scope: string | null }) {
  const watch = useWatch(c.id, scope);
  return (
    <button
      type="button"
      aria-label={`Watch ${c.title}`}
      aria-pressed={c.watched}
      title={c.watched ? 'Watching: click to stop' : 'Watch'}
      disabled={watch.isPending}
      onClick={(e) => (e.stopPropagation(), watch.mutate({ on: !c.watched }))}
      onKeyDown={(e) => e.stopPropagation()}
      className={cx(
        'absolute top-[7px] right-[7px] grid size-[30px] cursor-pointer place-items-center rounded-lg border hover:text-text',
        // Watching: a red outline on a dark red backing (readable on a photo). A filled eye fills its pupil too: a red dot.
        c.watched ? 'border-red/70 bg-[rgb(48_8_12/.85)] text-red' : 'border-line-2 bg-[rgb(8_8_10/.7)] text-text-2',
      )}
    >
      <Eye aria-hidden className="size-3.5" strokeWidth={c.watched ? 2.6 : 2} />
    </button>
  );
}

/** One product card as on the board. `store`: the store scope's name (stage, fit and the footer), null in All stores. */
export function ProductCard({
  c,
  store,
  scope,
  currency,
  shipTo,
  storeName,
  selected,
  onOpen,
  onKeyDown,
}: {
  c: PrCard;
  store: string | null;
  scope: string | null;
  currency: string;
  shipTo: string | null;
  storeName: (id: string) => string;
  selected: boolean;
  onOpen: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const [noImage, setNoImage] = useState(false);
  const [demand, demandSub] = demandLines(c);
  const conditions = conditionsLine(c);
  const reason = c.fulfillment?.reasons[0];
  return (
    <article
      tabIndex={0}
      data-card={c.id}
      aria-label={c.title}
      aria-current={selected || undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className={cx(
        'card flex cursor-pointer flex-col overflow-hidden [contain-intrinsic-size:auto_340px] [content-visibility:auto] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red/70',
        selected && 'outline-2 -outline-offset-1 outline-red',
      )}
    >
      <div className="relative grid h-[120px] place-items-center border-b border-line bg-[radial-gradient(circle_at_50%_45%,#1f1f25,#121215)] text-muted">
        <Package aria-hidden className="size-12" strokeWidth={1.2} />
        {c.imageListing && !noImage && (
          <img
            src={`/api/pr/listings/${encodeURIComponent(c.imageListing)}/image${scope ? `?store=${encodeURIComponent(scope)}` : ''}`}
            alt=""
            loading="lazy"
            onError={() => setNoImage(true)}
            className="absolute inset-0 size-full object-contain p-2"
          />
        )}
        {/* Over a photo the pills' 8% fills need a backing to stay readable. */}
        <span className={cx('absolute top-[9px] left-[9px] flex gap-1', c.imageListing && !noImage && 'rounded-lg bg-bg-2/90 p-0.5')}>
          {store && c.stage && <Pill tone={STAGE_TONE[c.stage]}>{PR_STAGE_LABEL[c.stage]}</Pill>}
          {c.fixture && <Pill tone="warn">Test fixture</Pill>}
        </span>
        <WatchEye c={c} scope={scope} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <h3 title={c.title} className="line-clamp-2 text-sm leading-[1.3] font-semibold">
            {c.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted">{sourceLine(c)}</p>
        </div>
        <div className="text-xs">
          <Row label={`Cost + ship to ${shipTo ?? 'your country'}, excl. duties`}>
            {c.costShip === null ? (
              <b title={reason ?? 'No verified offer row yet'}>Unknown</b>
            ) : (
              <b className="text-text">{minorMoney(c.costShip, currency)}</b>
            )}
          </Row>
          <Row label="Fulfillment">
            {c.fulfillment ? (
              <>
                <Pill tone={FULFILLMENT_TONE[c.fulfillment.status]} className="whitespace-normal">
                  {PR_FULFILLMENT_LABEL[c.fulfillment.status]}
                </Pill>
                {conditions && <Sub>{conditions}</Sub>}
              </>
            ) : (
              'Not checked yet'
            )}
          </Row>
          <Row label="Demand">
            {demand}
            {demandSub && <Sub>{demandSub}</Sub>}
          </Row>
          {store && c.fit && (
            <Row label={`Fit for ${store}`}>
              <span title={c.fit.reason}>{c.fit.fit === 'strong' || !c.fit.reason ? PR_FIT_LABEL[c.fit.fit] : `${PR_FIT_LABEL[c.fit.fit]}, ${c.fit.reason}`}</span>
            </Row>
          )}
          <Row label="Flags">
            {!c.flags ? (
              'Not checked yet'
            ) : c.flags.first ? (
              <Pill tone="warn" className="whitespace-normal">
                <span title={c.flags.first.reason}>{c.flags.first.label}</span>
                {c.flags.count > 1 && <span className="font-medium">+{c.flags.count - 1}</span>}
              </Pill>
            ) : (
              'No flags found (rule checks only)'
            )}
          </Row>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 text-[11.5px] text-muted">
          {/* The execution state, never the stage (spec §10): the stage is the pill at the top. */}
          {store && c.research ? (
            <Pill tone={TASK_TONE[c.research.status]}>{PR_TASK_STATUS_LABEL[c.research.status]}</Pill>
          ) : store ? (
            <Pill tone="muted">Not researched</Pill>
          ) : (
            <span>{!store && c.privateTo ? `Private to ${storeName(c.privateTo)}` : !store && c.storesEvaluating > 0 ? `${c.storesEvaluating} store${c.storesEvaluating === 1 ? '' : 's'} evaluating` : ''}</span>
          )}
          {store && c.research ? <span>Updated {ago(c.research.updatedAt)}</span> : (c.evidenceAt ?? c.firstSeenAt) && <span>Updated {ago((c.evidenceAt ?? c.firstSeenAt)!)}</span>}
        </div>
      </div>
    </article>
  );
}
