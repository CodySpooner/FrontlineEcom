// Kind-specific detail under an approval request (Dashboard, chat, Store Builder).
import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import type { ApprovalAction } from '@frontline/shared';
import { useProducts } from '../api/client';
import { adBrief, addedProducts, draftLink, fileList, marginAt, nichePack, priceChange, themeChange, toolInput } from '../lib/approvals';
import { cents } from '../lib/format';
import { Markdown } from './Markdown';
import { useStoreSelection } from './StoreFilter';

const SHOWN = 5;

export function ApprovalExtras({ action, storeId }: { action: ApprovalAction; storeId?: string }) {
  const { currency, stores } = useStoreSelection();
  const cur = storeId && currency(storeId);
  const added = addedProducts(action, stores.find((s) => s.id === storeId));
  if (added?.length)
    return (
      <ul className="mt-1.5 grid gap-0.5 text-xs text-muted">
        {added.slice(0, SHOWN).map((p, i) => (
          // In a narrow card the numbers wrap under the name: never cut, and the name only past a whole line.
          <li key={i} className="flex flex-wrap gap-x-1.5">
            <span className="min-w-0 truncate font-semibold text-text-2" title={p.title}>
              {p.title}
            </span>
            <span>
              {cents(p.price, cur || undefined)}
              {p.compareAt && ` · was ${cents(p.compareAt, cur || undefined)}`}
              {p.margin !== undefined && ` · ${p.margin}% margin`}
            </span>
          </li>
        ))}
        {added.length > SHOWN && <li>+{added.length - SHOWN} more</li>}
      </ul>
    );
  const price = priceChange(action);
  if (price && storeId) return <PriceMargin storeId={storeId} {...price} />;
  const pack = nichePack(action);
  if (pack)
    return (
      <details className="mt-1.5 text-xs">
        <summary className="cursor-pointer font-semibold text-text hover:underline">Read the pack</summary>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-line bg-bg-2 p-3">
          {/* Its "# Niche" title repeats the request's, as on the Knowledge page. */}
          <Markdown text={pack.replace(/^# .*\r?\n/, '')} />
        </div>
      </details>
    );
  const input = toolInput(action);
  if (input)
    return <pre className="mt-1.5 max-h-48 overflow-auto rounded-md border border-line bg-bg-2 p-2 font-mono text-[11px] whitespace-pre-wrap break-all text-text-2">{input}</pre>;
  const ad = adBrief(action);
  if (ad)
    return (
      <dl className="mt-1.5 grid gap-1 text-xs text-muted">
        {ad.copy && (
          <div className="whitespace-pre-line">
            <dt className="inline font-semibold text-text-2">Copy: </dt>
            <dd className="inline">
              {ad.copy}
              {ad.cta && ` · ${ad.cta}`}
            </dd>
          </div>
        )}
        {ad.brief && (
          <div>
            <dt className="inline font-semibold text-text-2">Brief: </dt>
            <dd className="inline">{ad.brief}</dd>
          </div>
        )}
      </dl>
    );
  const draft = draftLink(action);
  if (draft)
    return (
      <Link to={draft} className="mt-1.5 inline-block text-xs font-semibold text-text hover:underline">
        Review the draft
      </Link>
    );
  const t = themeChange(action);
  if (!t || (!t.previewUrl && !t.files.length)) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {t.previewUrl && (
        <a href={t.previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-text hover:underline">
          Preview changes
          <ExternalLink aria-hidden className="size-3" />
        </a>
      )}
      {t.files.length > 0 && (
        <span className="text-muted" title={t.files.join('\n')}>
          {fileList(t.files)}
        </span>
      )}
    </div>
  );
}

/** A price request's margin before and after, net of the unit cost and fee estimate. Nothing until the product has a cost. */
function PriceMargin({ storeId, productId, from, to }: { storeId: string; productId: string; from: number; to: number }) {
  const store = useStoreSelection().stores.find((s) => s.id === storeId);
  const p = useProducts([storeId]).data?.items.find((x) => x.id === productId);
  if (!p?.cost) return null;
  const fees = store?.feePercent || store?.feePerOrder;
  return (
    <p className="mt-1.5 text-xs text-muted">
      Margin <span className="font-semibold text-text-2">{marginAt(from, p.cost, store)}%</span> →{' '}
      <span className="font-semibold text-text-2">{marginAt(to, p.cost, store)}%</span> after the unit cost{fees ? ' and fees' : ''}
    </p>
  );
}
