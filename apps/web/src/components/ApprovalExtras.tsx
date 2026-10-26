// Kind-specific detail under an approval request (Dashboard, chat, Store Builder).
import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import type { ApprovalAction } from '@frontline/shared';
import { addedProducts, draftLink, fileList, themeChange } from '../lib/approvals';
import { cents } from '../lib/format';
import { useStoreSelection } from './StoreFilter';

const SHOWN = 5;

export function ApprovalExtras({ action, storeId }: { action: ApprovalAction; storeId?: string }) {
  const { currency } = useStoreSelection();
  const cur = storeId && currency(storeId);
  const added = addedProducts(action);
  if (added?.length)
    return (
      <ul className="mt-1.5 grid gap-0.5 text-xs text-muted">
        {added.slice(0, SHOWN).map((p, i) => (
          <li key={i} className="truncate">
            <span className="font-semibold text-text-2">{p.title}</span> · {cents(p.price, cur || undefined)}
            {p.compareAt && ` · was ${cents(p.compareAt, cur || undefined)}`}
            {p.margin !== undefined && ` · ${p.margin}% margin`}
          </li>
        ))}
        {added.length > SHOWN && <li>+{added.length - SHOWN} more</li>}
      </ul>
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
