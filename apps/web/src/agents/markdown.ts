import MarkdownIt from 'markdown-it';
import { webHref } from '../knowledge/url';

// A reply renders through one parser with raw HTML off (decision 15). Links go through webHref (web pages only, opening
// outside the app); images are off. `[kb:<id>]` cites a knowledge card, numbered in order of first use, and
// `[measured]`, `[research]` and `[hypothesis]` become evidence tags.

const md = new MarkdownIt({ html: false, breaks: true }).disable('image');

export const EVIDENCE = {
  measured: ['Measured', 'text-[#3ddc84] bg-[#3ddc84]/10'],
  research: ['Research', 'text-[#7aa7ff] bg-[#7aa7ff]/10'],
  hypothesis: ['Hypothesis', 'text-[#f2b84b] bg-[#f2b84b]/10'],
} as const;

interface Env {
  cites: string[];
  cardHref: (id: string) => string;
  /** Ids that aren't a card of the run's store or General: left as written, unnumbered. */
  missing?: ReadonlySet<string>;
}

md.inline.ruler.before('link', 'cite', (state, silent) => {
  const m = /^\[(?:kb:([\w-]+)|(measured|research|hypothesis))\]/i.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) state.push(m[1] ? 'kb_cite' : 'evidence', '', 0).meta = m[1] ? { id: m[1] } : { kind: m[2]!.toLowerCase() };
  state.pos += m[0].length;
  return true;
});

md.renderer.rules.kb_cite = (tokens, i, _o, env: Env) => {
  const id = String(tokens[i]!.meta.id);
  if (env.missing?.has(id)) return md.utils.escapeHtml(`[kb:${id}]`);
  const n = env.cites.indexOf(id) + 1 || env.cites.push(id);
  return `<sup><a class="ml-px text-[10px] font-bold text-[#ff6b76] no-underline" href="${md.utils.escapeHtml(env.cardHref(id))}">${n}</a></sup>`;
};

md.renderer.rules.evidence = (tokens, i) => {
  const [label, tone] = EVIDENCE[tokens[i]!.meta.kind as keyof typeof EVIDENCE];
  return `<span class="rounded px-1.5 py-px text-[10.5px] font-semibold ${tone}">${label}</span>`;
};

md.renderer.rules.link_open = (tokens, i, o, _env, self) => {
  const open = tokens[i]!;
  if (!webHref(open.attrGet('href') ?? undefined)) {
    // Not a web page: keep the words, drop the link (its close follows; links don't nest).
    open.meta = { drop: true };
    const close = tokens.slice(i).find((t) => t.type === 'link_close');
    if (close) close.meta = { drop: true };
    return '';
  }
  open.attrSet('target', '_blank');
  open.attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, i, o);
};
md.renderer.rules.link_close = (tokens, i, o, _env, self) => (tokens[i]!.meta?.drop ? '' : self.renderToken(tokens, i, o));

/** The reply as HTML, and the card ids it cites in number order. Pass one `cites` to number several parts as one reply. */
export function renderReply(text: string, cardHref: (id: string) => string, cites: string[] = [], missing?: ReadonlySet<string>) {
  return { html: md.render(text, { cites, cardHref, ...(missing ? { missing } : {}) } satisfies Env), cites };
}
