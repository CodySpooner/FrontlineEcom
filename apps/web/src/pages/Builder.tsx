// UI-24 Store Builder: brief the Store Developer, review its page drafts (preview, SEO, change list), publish.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { LayoutTemplate } from 'lucide-react';
import { PRODUCT_PAGE_PLATFORMS, PRODUCT_WRITE_PLATFORMS, type PageDraft, type PageDraftStatus } from '@frontline/shared';
import { useApprovals, usePageDraftActions, usePageDrafts, useStartRun } from '../api/client';
import { ApprovalCard, FixLink } from '../components/Chat';
import { Hero } from '../components/Hero';
import { Markdown } from '../components/Markdown';
import { StoreFilter, useStoreSelection } from '../components/StoreFilter';
import { byHand } from '../components/StoreForm';
import { Badge, Button, ConfirmDelete, cx, EmptyState, ErrorState, Field, inputClass, LoadingState, Panel, Segmented } from '../components/ui';
import { ago } from '../lib/format';
import { NAV } from '../nav';

const STATUS: Record<PageDraftStatus, { label: string; tone: 'red' | 'good' | 'muted' }> = {
  draft: { label: 'Draft', tone: 'muted' },
  pending: { label: 'Waiting for you', tone: 'red' },
  approved: { label: 'Approved', tone: 'muted' },
  published: { label: 'Published', tone: 'good' },
  rejected: { label: 'Denied', tone: 'muted' },
};
const IDEAS = [
  "Rewrite our best seller's product page to lift conversion: benefits first, social proof, FAQ, clear CTA.",
  'Build an FAQ page from the questions customers ask most (shipping, returns, sizing).',
  'Draft a landing page for this week’s promo with one hero, three benefits and a countdown to the offer end.',
];
// The agent writes body HTML only; give the preview a plain storefront base.
const BASE = '<meta name="viewport" content="width=device-width"><style>body{margin:0;padding:24px;font:15px/1.6 system-ui,sans-serif;color:#1f1f1f;background:#fff}img{max-width:100%;height:auto}</style>';

export function Builder() {
  const nav = NAV.find((n) => n.path === '/builder')!;
  const { ids } = useStoreSelection();
  const q = usePageDrafts(ids);
  // A publish request links here with ?draft=<id>.
  const [picked, setPicked] = useState(useSearchParams()[0].get('draft') ?? undefined);
  const sel = q.data?.find((d) => d.id === picked) ?? q.data?.[0];
  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} art={nav.art} />
      <div className="mb-3.5">
        <StoreFilter />
      </div>
      <div className="grid items-start gap-3.5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid gap-3.5">
          <Brief />
          <ThemeChanges />
          <Panel title="Drafts" sub={q.data && `${q.data.length} page${q.data.length === 1 ? '' : 's'} from the Store Developer`}>
            {q.isPending ? (
              <LoadingState rows={3} />
            ) : q.isError ? (
              <ErrorState message="Couldn't load the drafts." onRetry={() => q.refetch()} />
            ) : !q.data.length ? (
              <EmptyState icon={LayoutTemplate} title="No drafts yet">
                Brief the Store Developer above. Its pages land here for you to preview and publish.
              </EmptyState>
            ) : (
              <ul className="grid gap-1.5">
                {q.data.map((d) => (
                  <DraftRow key={d.id} d={d} on={d.id === sel?.id} onPick={() => setPicked(d.id)} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
        {sel ? (
          <DraftView key={sel.id} d={sel} />
        ) : (
          <Panel title="Preview">
            <EmptyState icon={LayoutTemplate} title="Nothing to preview">
              Pick a draft to see the page, its search snippet and what changed.
            </EmptyState>
          </Panel>
        )}
      </div>
    </>
  );
}

function Brief() {
  const { ids, stores } = useStoreSelection();
  const [storeId, setStoreId] = useState('');
  const store = stores.find((s) => s.id === storeId) ?? stores.find((s) => s.id === ids[0]) ?? stores[0];
  const [task, setTask] = useState('');
  const start = useStartRun();
  const send = () => store && start.mutate({ agentId: `${store.id}:store_developer`, task: `${task.trim()} Save it as a page draft for the owner to review.` }, { onSuccess: () => setTask('') });
  // The Store Developer only saves drafts the app can publish there (AGT-163); anything else comes back in its answer.
  const noPages = byHand(store, PRODUCT_PAGE_PLATFORMS);
  const productOnly = !noPages && byHand(store, PRODUCT_WRITE_PLATFORMS);
  return (
    <Panel title="Brief the Store Developer" sub="It drafts the page here. Nothing goes live until you publish.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="grid gap-3"
      >
        <Field label="Store">
          <select value={store?.id ?? ''} onChange={(e) => setStoreId(e.target.value)} className={cx(inputClass, 'cursor-pointer')}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {(noPages || productOnly) && (
          <p className="-mt-1 text-xs text-muted">
            {noPages
              ? `The app can't publish pages to ${noPages} stores yet: the Store Developer writes the page in chat for you to add by hand.`
              : `On ${productOnly}, only product pages publish from here: other pages come back in chat for you to add by hand.`}
          </p>
        )}
        <Field label="What should it build?">
          <textarea value={task} onChange={(e) => setTask(e.target.value)} required rows={3} placeholder={IDEAS[0]} className={cx(inputClass, 'resize-y')} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {['Product page', 'FAQ page', 'Promo landing page'].map((label, i) => (
            <button key={label} type="button" onClick={() => setTask(IDEAS[i]!)} className="cursor-pointer rounded-full border border-line-2 px-2.5 py-1 text-xs text-text-2 transition hover:border-red/50 hover:text-white">
              {label}
            </button>
          ))}
        </div>
        {start.isError && (
          <p role="alert" className="text-xs text-red">
            {start.error.message} <FixLink message={start.error.message} agentId={start.variables?.agentId ?? ''} />
          </p>
        )}
        {start.data && (
          <p className="text-xs text-text-2">
            On it.{' '}
            <Link to={`/agents/${encodeURIComponent(start.data.agentId)}?run=${start.data.id}`} className="text-red hover:underline">
              Follow along in chat
            </Link>
          </p>
        )}
        <Button type="submit" disabled={!task.trim() || !store || start.isPending}>
          Send to Store Developer
        </Button>
      </form>
    </Panel>
  );
}

function DraftRow({ d, on, onPick }: { d: PageDraft; on: boolean; onPick: () => void }) {
  const { name } = useStoreSelection();
  const st = STATUS[d.status];
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={on}
        className={cx('w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition', on ? 'border-red/50 bg-red-soft' : 'border-line bg-bg-2 hover:border-line-2')}
      >
        <span className="flex items-start justify-between gap-2">
          <b className="text-[13px]">{d.title}</b>
          <Badge tone={st.tone}>{st.label}</Badge>
        </span>
        <span className="text-xs text-muted">
          {d.kind === 'product' ? 'Product page' : 'Page'} · {name(d.storeId)} · {ago(d.createdAt)}
        </span>
      </button>
    </li>
  );
}

function DraftView({ d }: { d: PageDraft }) {
  const { name, stores } = useStoreSelection();
  const { publish, remove } = usePageDraftActions();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const st = STATUS[d.status];
  const store = name(d.storeId);
  // `approved`: the approval's push to the platform failed (5xx, rate limit); publishing again retries it.
  const canPublish = d.status !== 'published';
  // The same gate as agents' publish_page: product pages reach more platforms than other pages.
  const manual = byHand(stores.find((s) => s.id === d.storeId), d.kind === 'product' && d.productId ? PRODUCT_PAGE_PLATFORMS : PRODUCT_WRITE_PLATFORMS);
  const error = publish.error ?? remove.error;
  // A direct publish answers once its push is done, so still unpublished means it failed (core's notice says why). Not
  // so after approving a request: that answers before the push.
  const [unpushed, setUnpushed] = useState<string>();
  const failed = unpushed === d.id && d.status !== 'published';
  // A store page is created, not updated: a push that timed out may have made it live (AGT-215), and again puts it up twice.
  const twice = d.kind === 'page' && !manual && (d.status === 'approved' || failed);
  return (
    <div className="grid gap-3.5">
      <Panel
        title={d.title}
        sub={`${d.kind === 'product' ? 'Product page' : 'Page'} for ${store} · drafted ${ago(d.createdAt)}`}
        action={<Segmented label="Preview size" value={device} onChange={setDevice} options={[{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Mobile' }]} />}
      >
        <div className="rounded-lg border border-line bg-bg-2 p-2">
          <iframe
            title={`Preview of ${d.title}`}
            sandbox=""
            srcDoc={BASE + d.html}
            className={cx('mx-auto block h-[520px] rounded-md bg-white transition-[width]', device === 'mobile' ? 'w-[390px] max-w-full' : 'w-full')}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Badge tone={st.tone}>{st.label}</Badge>
          <span className="text-xs text-text-2">
            {d.status === 'published' && `Live on ${store}${d.publishedAt ? ` since ${ago(d.publishedAt)}` : ''}.`}
            {d.status === 'pending' && 'The Store Developer asked to publish this.'}
            {d.status === 'approved' &&
              (twice
                ? `Approved, but ${store} didn't confirm it. It may be live anyway: check ${store}'s pages before you publish it again, or it goes up twice.`
                : `Approved, but it couldn't be pushed to ${store}. ${manual ? 'Apply it by hand.' : 'Try again, or apply it by hand.'}`)}
            {d.status === 'rejected' && 'You turned this down. You can still publish it.'}
            {d.status === 'draft' && 'Not published yet.'}
          </span>
          {canPublish &&
            (manual ? (
              <span className="ml-auto text-xs text-text-2">
                The app can't publish this kind of page to {manual} yet. Copy it into {manual} by hand.
              </span>
            ) : (
              <Button
                variant="primary"
                className="ml-auto"
                disabled={publish.isPending}
                onClick={() => publish.mutate(d.id, { onSuccess: (r) => setUnpushed(d.status !== 'pending' && r.status !== 'published' ? d.id : undefined) })}
              >
                {d.status === 'pending' ? 'Approve and publish' : twice ? 'Publish again' : d.status === 'approved' ? 'Try again' : `Publish to ${store}`}
              </Button>
            ))}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-red">
            {error.message}
          </p>
        )}
        {failed && (
          <p role="alert" className="mt-2 text-xs text-red">
            {twice && d.status !== 'approved'
              ? `It didn't go through (the bell says why). If it timed out, the page may be live anyway: check ${store}'s pages before you publish it again.`
              : "It didn't go through: the bell says why."}
          </p>
        )}
      </Panel>
      {(d.seoTitle || d.seoDescription) && (
        <Panel title="Search Snippet" sub="How it can show up on Google.">
          <div className="rounded-lg border border-line bg-bg-2 p-3">
            {d.seoTitle && <p className="text-[15px] font-semibold text-text">{d.seoTitle}</p>}
            {d.seoDescription && <p className="mt-1 text-[13px] text-text-2">{d.seoDescription}</p>}
          </div>
          <p className="mt-2 text-xs text-muted">
            Title {d.seoTitle?.length ?? 0}/60 · Description {d.seoDescription?.length ?? 0}/160 characters
          </p>
        </Panel>
      )}
      <Panel title="What Changed" sub="The Store Developer's change list, with its reasons.">
        <Markdown text={d.notes} />
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs">
          {d.runId && (
            <Link to={`/agents/${encodeURIComponent(d.agentId)}?run=${d.runId}`} className="text-text-2 hover:text-white">
              See the conversation
            </Link>
          )}
          <ConfirmDelete question="Delete this draft?" confirm="Delete draft" busy={remove.isPending} onConfirm={() => remove.mutate(d.id)} className="ml-auto">
            {(open, ref) => (
              <button ref={ref} type="button" onClick={open} className="ml-auto cursor-pointer text-muted hover:text-red">
                Delete draft
              </button>
            )}
          </ConfirmDelete>
        </div>
      </Panel>
    </div>
  );
}

/** Theme edits the Store Developer is waiting on (`store.publish_theme` requests): preview, then approve or deny. */
function ThemeChanges() {
  const { has } = useStoreSelection();
  const list = (useApprovals().data ?? []).filter((a) => a.action.kind === 'store.publish_theme' && has(a.storeId));
  if (!list.length) return null;
  return (
    <Panel title="Theme changes" sub="Waiting for your go-ahead">
      <ul className="grid gap-2">
        {list.map((a) => (
          <li key={a.id}>
            <ApprovalCard a={a} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
