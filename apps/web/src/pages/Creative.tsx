// UI-10 Creative Studio: brief the store's Creative Studio (or Copywriter) agent, preview what it made, act on it.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Captions, Copy, Download, PenLine, Sparkles, Trash2, Wand2, Zap } from 'lucide-react';
import { CREDITS, type AgentRole, type AspectRatio, type Creative as CreativeT, type CreativeKind } from '@frontline/shared';
import { useAgents, useCaps, useClaudeAccount, useCreatives, useDeleteCreative, useIntegrations, useStartRun } from '../api/client';
import { FixLink } from '../components/Chat';
import { Hero } from '../components/Hero';
import { useStoreSelection } from '../components/StoreFilter';
import { Badge, Button, buttonClass, ConfirmDelete, cx, EmptyState, ErrorState, LoadingState, Panel, StatusDot, Tabs } from '../components/ui';
import { ago } from '../lib/format';
import { NAV } from '../nav';

const KIND_LABEL: Record<CreativeKind, string> = { image: 'image', video: 'video', ugc: 'UGC avatar video', copy: 'ad copy' };
const ASPECTS: AspectRatio[] = ['9:16', '1:1', '4:5', '16:9'];

type Tab = 'generate' | 'ugc' | 'v2v' | 'image' | 'variations' | 'copy';
const TABS: { value: Tab; label: string; kind: CreativeKind; role: AgentRole; show?: CreativeKind; placeholder: string; prefix?: string }[] = [
  { value: 'generate', label: 'Generate Ads', kind: 'video', role: 'creative_studio', placeholder: 'Create a viral TikTok ad for our best seller. Modern, high energy, hook in the first second, captions, show the result.' },
  { value: 'ugc', label: 'UGC Avatars', kind: 'ugc', role: 'creative_studio', show: 'ugc', placeholder: 'A relatable creator unboxes the product in a car, talks to camera, reacts to the result, ends with the offer.' },
  { value: 'v2v', label: 'Video to Video', kind: 'video', role: 'creative_studio', show: 'video', prefix: 'Remix our best-performing video ad', placeholder: 'Same story as our top ad, but night-time city setting and faster cuts.' },
  { value: 'image', label: 'Image Studio', kind: 'image', role: 'creative_studio', show: 'image', placeholder: 'Product on a marble counter, soft morning light, bold headline with the discount.' },
  { value: 'variations', label: 'Ad Variations', kind: 'image', role: 'creative_studio', prefix: 'Make 3 variations of our best ad with different hooks', placeholder: 'Keep the product shot, change the hook: pain point, social proof, price anchor.' },
  { value: 'copy', label: 'Ad Copy', kind: 'copy', role: 'copywriter', show: 'copy', placeholder: 'Headline, primary text and CTA for a Meta ad: busy dog owners, 20% off this week.' },
];
// Deterministic, not an AI call: adds the brief items that most often lift hook rate and CTR.
const ENHANCE = {
  media: ' Hook in the first second, on-screen captions, show the result, end card with the offer and a clear CTA.',
  copy: ' Open with the pain point, add social proof with a number, keep it under 125 characters, end with one clear CTA.',
};

export function Creative() {
  const nav = NAV[4]!;
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.value === params.get('tab')) ?? TABS[0]!;
  const { ids, stores, has, name } = useStoreSelection();
  const [storeId, setStoreId] = useState('');
  const store = stores.find((s) => s.id === storeId) ?? stores.find((s) => s.id === ids[0]) ?? stores[0];
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  const start = useStartRun();
  const cap = useCaps(store?.id ?? '').data;
  const hf = useIntegrations().data?.find((i) => i.kind === 'higgsfield')?.status;
  // The agent briefed on this tab thinks with Claude only on a live store; demo stores get the scripted engine.
  const engine = useAgents().data?.find((a) => a.id === `${store?.id}:${tab.role}`)?.engine?.provider;
  const signedIn = useClaudeAccount(engine === 'claude').q.data?.signedIn;
  const claude = engine === 'demo' ? 'demo' : engine === 'claude' && signedIn === false ? 'error' : signedIn ? 'connected' : undefined;
  const lib = useCreatives(tab.show);
  const list = (lib.data ?? []).filter((c) => has(c.storeId) && (tab.show || c.kind !== 'copy'));
  const [picked, setPicked] = useState<string>();
  const shown = list.find((c) => c.id === picked) ?? list[0];

  const media = tab.kind !== 'copy';
  const brief = prompt.trim();
  const enhance = media ? ENHANCE.media : ENHANCE.copy;
  const ask = (task: string, role: AgentRole = tab.role, storeFor = store?.id) => storeFor && start.mutate({ agentId: `${storeFor}:${role}`, task });
  const generate = () =>
    ask(
      media
        ? `${tab.prefix ? `${tab.prefix}. ` : ''}Make a ${aspect} ${KIND_LABEL[tab.kind]} ad and save it to the creatives library. Brief: ${brief}`
        : `Write ad copy (headline, primary text, CTA) and save it to the creatives library. Brief: ${brief}`,
    );

  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} art={nav.art} />
      <Tabs label="Creative tools" tabs={TABS} value={tab.value} onChange={(t) => (start.reset(), setParams(t === 'generate' ? {} : { tab: t }, { replace: true }))} />
      <div className="mt-4 grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title={media ? 'Create Your Ad' : 'Write Your Copy'} sub={`For ${store?.name ?? 'your store'} · ${tab.role === 'copywriter' ? 'Copywriter' : 'Creative Studio'} agent`}>
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Store
              <select value={store?.id ?? ''} onChange={(e) => setStoreId(e.target.value)} className="cursor-pointer rounded-lg border border-line-2 bg-bg-2 px-3 py-2 text-[13px] text-text focus:border-red/60 focus:outline-none">
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-lg border border-line-2 bg-bg-2 focus-within:border-red/60">
              <label htmlFor="brief" className="sr-only">
                Brief
              </label>
              <textarea
                id="brief"
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={900}
                placeholder={tab.placeholder}
                className="block w-full resize-y bg-transparent px-3 py-2.5 text-[13px] leading-relaxed placeholder:text-muted focus:outline-none"
              />
              <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
                <button
                  type="button"
                  disabled={!brief || prompt.includes(enhance.trim())}
                  onClick={() => setPrompt((p) => (/[.!?]$/.test(p.trim()) ? p.trim() : `${p.trim()}.`) + enhance)}
                  title="Adds proven hook, caption and CTA guidance to your brief"
                  className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-2 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Wand2 className="size-3.5" />
                  Enhance
                </button>
                {media && (
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    Aspect
                    <select value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)} className="cursor-pointer rounded-md border border-line-2 bg-panel px-2 py-1 text-xs text-text focus:outline-none">
                      {ASPECTS.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
            <Button variant="primary" className="w-full py-2.5" disabled={!brief || !store || start.isPending} onClick={generate}>
              <Zap className="size-4" />
              {media ? 'Generate with Higgsfield AI' : 'Write with Claude'}
              {media && <span className="rounded bg-black/25 px-1.5 py-0.5 text-[11px]">{CREDITS[tab.kind]} credits</span>}
            </Button>
            {start.isSuccess && (
              <p className="text-xs text-text-2" role="status">
                On it.{media && ` It asks you before spending ${CREDITS[tab.kind]} credits.`} The result lands in the library below.{' '}
                <Link to={`/agents/${encodeURIComponent(start.data.agentId)}`} className="text-red hover:underline">
                  Watch it work
                </Link>
              </p>
            )}
            {start.isError && (
              <p role="alert" className="text-xs text-red">
                {start.error.message} <FixLink message={start.error.message} agentId={start.variables?.agentId ?? ''} />
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
              Integration
              <Link
                to="/integrations"
                title={hf === 'connected' ? 'Renders images and video' : 'Connect Higgsfield for real renders'}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-2 px-2 py-1 text-text-2 hover:text-white"
              >
                <StatusDot tone={hf === 'connected' ? 'good' : hf === 'error' ? 'red' : 'idle'} />
                Higgsfield AI{hf !== 'connected' && <span className="text-muted">{hf === 'error' ? ' · needs attention' : ' · demo renders'}</span>}
              </Link>
              <Link
                to="/integrations"
                title={claude === 'demo' ? 'Demo stores get scripted answers' : 'Writes the copy and the briefs'}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-2 px-2 py-1 text-text-2 hover:text-white"
              >
                <StatusDot tone={claude === 'connected' ? 'good' : claude === 'error' ? 'red' : 'idle'} />
                Claude{claude && claude !== 'connected' && <span className="text-muted">{claude === 'error' ? ' · needs attention' : ' · demo copy'}</span>}
              </Link>
              {cap && <span className="ml-auto">Daily cap {cap.higgsfieldCreditsPerDay} credits</span>}
            </div>
          </div>
        </Panel>
        <Panel title="Preview" sub={shown && `${name(shown.storeId)} · ${KIND_LABEL[shown.kind]}${shown.aspect ? ` · ${shown.aspect}` : ''} · ${ago(shown.createdAt, Date.now())}`}>
          {lib.isPending ? (
            <LoadingState rows={4} />
          ) : !shown ? (
            <EmptyState icon={Sparkles} title="Nothing generated yet">
              Write a brief and generate. Finished ads appear here and in the library.
            </EmptyState>
          ) : (
            <Preview c={shown} onAsk={(task) => ask(task, 'creative_studio', shown.storeId)} busy={start.isPending} />
          )}
        </Panel>
      </div>
      <Panel title={tab.show === 'copy' ? 'Ad Copy Library' : 'Generated Ads'} sub={`${list.length} in the library`} className="mt-4">
        {lib.isError ? (
          <ErrorState message="Couldn't load the library." onRetry={() => lib.refetch()} />
        ) : !list.length ? (
          <p className="text-[13px] text-muted">Nothing here yet for {tab.label}.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-3 min-[1100px]:grid-cols-5">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setPicked(c.id)}
                  aria-pressed={c.id === shown?.id}
                  className={cx('block w-full cursor-pointer overflow-hidden rounded-lg border bg-bg-2 text-left transition', c.id === shown?.id ? 'border-red shadow-glow' : 'border-line hover:border-line-3')}
                >
                  {c.mediaUrl ? (
                    <Media c={c} className="aspect-video w-full object-cover" />
                  ) : (
                    <div className="aspect-video p-2.5 text-xs leading-snug text-text-2">
                      <b className="mb-1 line-clamp-2 block text-text">{c.headline}</b>
                      <span className="line-clamp-2">{c.primaryText}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-muted">
                    <span className="truncate">{c.headline}</span>
                    {c.credits > 0 && <span className="shrink-0 tabular-nums">{c.credits} cr</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

const isVideo = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);

function Media({ c, className, controls }: { c: CreativeT; className?: string; controls?: boolean }) {
  if (!c.mediaUrl) return null;
  return isVideo(c.mediaUrl) ? <video src={c.mediaUrl} controls={controls} muted playsInline className={className} /> : <img src={c.mediaUrl} alt={c.headline} loading="lazy" className={className} />;
}

function Preview({ c, onAsk, busy }: { c: CreativeT; onAsk: (task: string) => void; busy: boolean }) {
  const del = useDeleteCreative();
  const [copied, setCopied] = useState(false);
  const text = [c.headline, c.primaryText, c.cta].filter(Boolean).join('\n\n');
  const motion = c.kind === 'video' || c.kind === 'ugc';
  return (
    <div className="grid gap-3">
      {c.mediaUrl && (
        <div className="grid max-h-[420px] place-items-center overflow-hidden rounded-lg border border-line bg-black">
          <Media c={c} controls className="max-h-[420px] w-auto max-w-full object-contain" />
        </div>
      )}
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-semibold">{c.headline}</h3>
          <Badge tone={c.source === 'higgsfield' ? 'red' : 'muted'}>{c.source === 'demo' ? 'Demo render' : c.source === 'higgsfield' ? 'Higgsfield' : 'Agent-written'}</Badge>
        </div>
        <p className="mt-1 text-[13px] whitespace-pre-wrap text-text-2">{c.primaryText}</p>
        {c.cta && <p className="mt-1.5 text-xs text-muted">CTA: {c.cta}</p>}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Link to={`/agents/${encodeURIComponent(`${c.storeId}:${c.kind === 'copy' ? 'copywriter' : 'creative_studio'}`)}`} className={buttonClass('ghost', 'sm')}>
          <PenLine className="size-3.5" />
          Edit in Studio
        </Link>
        {c.kind !== 'copy' && (
          <Button size="sm" disabled={busy} onClick={() => onAsk(`Make 3 variations of this ${c.aspect ?? ''} ${KIND_LABEL[c.kind]} ad with different hooks and save them: "${c.headline}". Original brief: ${c.prompt ?? c.primaryText}`)}>
            <Sparkles className="size-3.5" />
            Generate Variations
          </Button>
        )}
        {motion && (
          <Button size="sm" disabled={busy} onClick={() => onAsk(`Add on-screen captions to this ${KIND_LABEL[c.kind]} ad and save the new version: "${c.headline}". Brief: ${c.prompt ?? c.primaryText}`)}>
            <Captions className="size-3.5" />
            Add Captions
          </Button>
        )}
        {c.mediaUrl ? (
          <a href={c.mediaUrl} download={`${c.headline.replace(/[^\w-]+/g, '-').slice(0, 40)}.${c.mediaUrl.startsWith('data:') ? 'svg' : c.mediaUrl.split('?')[0]!.split('.').pop()}`} className={buttonClass('ghost', 'sm')}>
            <Download className="size-3.5" />
            Export
          </a>
        ) : (
          <Button size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
            <Copy className="size-3.5" />
            {copied ? 'Copied' : 'Copy text'}
          </Button>
        )}
        <ConfirmDelete question="Delete this creative?" confirm="Delete creative" busy={del.isPending} onConfirm={() => del.mutate(c.id)} className="ml-auto">
          {(open, ref) => (
            <Button ref={ref} size="sm" className="ml-auto" disabled={del.isPending} onClick={open} aria-label={`Delete ${c.headline}`}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          )}
        </ConfirmDelete>
      </div>
      {del.isError && (
        <p role="alert" className="text-xs text-red">
          {del.error.message}
        </p>
      )}
    </div>
  );
}
