import { useState } from 'react';
import { PR_BRIEF_FIELDS, PR_BRIEF_LABEL, type PrBrief, type Store } from '@frontline/shared';
import { Button, cx, Dialog, ErrorState, inputClass, LoadingState } from '../components/ui';
import { useBrief, useDraftProduct, useSaveBrief } from './api';
import { Pill } from './Card';

/** Draft test brief (PR-22): an owner form, prefilled only from stored data; the draft product is an approval request. */
export function BriefDialog({ id, title, store, onClose, onDraftWithAgent }: { id: string; title: string; store: Store; onClose: () => void; onDraftWithAgent: () => void }) {
  const q = useBrief(id, store.id);
  return (
    <Dialog open onClose={onClose} title="Test brief" subtitle={`${title} · ${store.name}`} width={720}>
      {q.isPending ? (
        <LoadingState rows={6} />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : (
        <BriefForm key={q.data.updatedAt ?? 'prefill'} id={id} store={store} brief={q.data} onDraftWithAgent={onDraftWithAgent} />
      )}
    </Dialog>
  );
}

function BriefForm({ id, store, brief, onDraftWithAgent }: { id: string; store: Store; brief: PrBrief; onDraftWithAgent: () => void }) {
  const [fields, setFields] = useState(brief.fields);
  const save = useSaveBrief(id, store.id);
  const draft = useDraftProduct(id, store.id);
  const dirty = !brief.updatedAt || PR_BRIEF_FIELDS.some((k) => fields[k].trim() !== brief.fields[k]);
  return (
    <form className="grid gap-3 text-xs" onSubmit={(e) => (e.preventDefault(), save.mutate({ fields }))}>
      <p className="text-muted">
        {brief.updatedAt
          ? `Saved ${new Date(brief.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`
          : 'Not saved yet. Prefilled only from stored data (your research profile, the latest report with a model, your base economics); a field with nothing stored is empty.'}
      </p>
      {PR_BRIEF_FIELDS.map((k) => (
        <label key={k} className="grid gap-1">
          <span className="flex flex-wrap items-center justify-between gap-1.5">
            <b className="text-text">{PR_BRIEF_LABEL[k]}</b>
            {brief.from[k] && fields[k] === brief.fields[k] && <Pill tone={brief.from[k]!.startsWith('Proposal') ? 'warn' : 'muted'}>{brief.from[k]}</Pill>}
          </span>
          <textarea
            value={fields[k]}
            rows={k === 'creativeConcepts' || k === 'budgetAssumptions' ? 3 : 2}
            maxLength={4000}
            onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
            className={cx(inputClass, 'w-full resize-y')}
          />
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button type="submit" size="sm" variant="primary" disabled={!dirty || save.isPending}>
          Save brief
        </Button>
        <Button size="sm" onClick={onDraftWithAgent}>
          Draft with an agent
        </Button>
        <Button size="sm" disabled={draft.isPending} onClick={() => draft.mutate()}>
          Prepare draft product
        </Button>
      </div>
      <p className="text-muted">Prepare draft product asks for your approval first; approving makes a draft in the store. Nothing is published, ordered or spent.</p>
      {draft.data && (
        <p role="status" className="text-text-2">
          {`Approval requested: ${draft.data.title}. Approve it from the bell to make the draft.`}
        </p>
      )}
      {(save.error ?? draft.error) && (
        <p role="alert" className="text-red">
          {(save.error ?? draft.error)!.message}
        </p>
      )}
    </form>
  );
}
