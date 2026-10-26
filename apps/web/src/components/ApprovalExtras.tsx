// Kind-specific detail under an approval request (Dashboard, chat, Store Builder).
import { ExternalLink } from 'lucide-react';
import type { ApprovalAction } from '@frontline/shared';
import { fileList, themeChange } from '../lib/approvals';

export function ApprovalExtras({ action }: { action: ApprovalAction }) {
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
