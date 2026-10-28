// The knowledge base's safe fetcher (decision 10). It reads public pages and documents for research, and nothing on this
// computer or its network: every hop's host is checked, then the connection goes to the checked address (no second DNS
// lookup, so a rebinding name can't swap it). It asks robots.txt first, waits between requests to one site, caps size
// and time, and reads only documents. What it returns is text, never followed and never run.
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { KbSourceStatus } from '@frontline/shared';
import { LOCAL } from '../competitors';

export interface Addr {
  address: string;
  family: number;
}
export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}
/** One GET to `url`, connecting to `to` (already checked) whatever DNS says now. */
export type Transport = (url: URL, to: Addr, headers: Record<string, string>, timeoutMs?: number) => Promise<Reply>;
export interface Fetched {
  /** Where the text came from, after redirects. */
  url: string;
  status: KbSourceStatus;
  title?: string;
  publishedAt?: string;
  /** Only when it was read. */
  text?: string;
  /** Why it wasn't read. */
  error?: string;
  /** Image mode only: the image, and the type its first bytes show (never the server's word for it). */
  bytes?: Uint8Array;
  imageType?: ImageType;
  /** Product mode only: the answer's HTTP status when it wasn't 2xx, and an HTML page's product metadata. */
  httpStatus?: number;
  product?: ProductMeta;
}
/** A page's meta tags (lower-cased names) and its JSON-LD blocks, parsed as data: nothing on the page is run. */
export interface ProductMeta {
  meta: Record<string, string>;
  jsonLd: unknown[];
}
export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

const AGENT = 'FrontlineEcomBot';
const HEADERS = {
  'user-agent': `${AGENT}/1.0 (research for a store owner's knowledge base; obeys robots.txt)`,
  accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,text/markdown,text/csv;q=0.9',
};
const IMAGE_HEADERS = { ...HEADERS, accept: 'image/png,image/jpeg,image/webp,image/gif;q=0.9' };
const IMAGE_MAX = 5 * 1_048_576;
const HTML = ['text/html', 'application/xhtml+xml'];
const TEXT = ['text/plain', 'text/markdown', 'text/x-markdown', 'text/csv'];
const DAY = 86_400_000;

/** The real transport: node's http(s) with a `lookup` that answers with the checked address. TLS still checks the name. */
export const pinned: Transport = (url, to, headers, timeoutMs = 20_000) =>
  new Promise((ok, fail) => {
    const pin = ((_host: string, o: { all?: boolean }, cb: (e: null, a: unknown, f?: number) => void) => (o.all ? cb(null, [to]) : cb(null, to.address, to.family))) as unknown as LookupFunction;
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { headers, lookup: pin, signal: AbortSignal.timeout(timeoutMs) }, (res) =>
      ok({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, String(v)])), body: res, close: () => res.destroy() }),
    );
    req.on('error', fail).end();
  });

/** Up to `max` bytes of the body, or null when there's more. */
async function readBody(reply: Reply, max: number) {
  if (Number(reply.headers['content-length']) > max) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const c of reply.body) {
    if ((size += c.length) > max) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** The image type from its magic bytes: png, jpeg, webp or gif. Never SVG (it can carry script). */
export function sniffImage(b: Uint8Array): ImageType | null {
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
  return null;
}

/** Image mode's reply: at most 5 MB, and only when the bytes are one of the four image types. */
async function image(url: URL, reply: Reply): Promise<Fetched> {
  const at = url.href;
  if (reply.status < 200 || reply.status >= 300) return { url: at, status: 'failed', error: `The site answered HTTP ${reply.status}` };
  const bytes = await readBody(reply, IMAGE_MAX);
  if (!bytes) return { url: at, status: 'too_large', error: 'The image is over the 5 MB limit' };
  const imageType = sniffImage(bytes);
  return imageType ? { url: at, status: 'read', bytes, imageType } : { url: at, status: 'unsupported', error: "That isn't a png, jpeg, webp or gif image" };
}

/** Whether robots.txt lets this tool read `path` (path and query): its own group, else `*`; the longest rule wins, Allow on a tie. */
export function robotsAllows(txt: string, path: string, agent = AGENT.toLowerCase()) {
  const groups: { agents: string[]; rules: [boolean, string][] }[] = [];
  let open = false;
  for (const raw of txt.split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*/, '').trim();
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (key === 'user-agent') {
      if (!open) groups.push({ agents: [], rules: [] });
      groups.at(-1)!.agents.push(value.toLowerCase());
      open = true;
      continue;
    }
    open = false;
    if ((key === 'allow' || key === 'disallow') && value && groups.length) groups.at(-1)!.rules.push([key === 'allow', value]);
  }
  const mine = groups.filter((g) => g.agents.includes(agent));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best: [boolean, string] | undefined;
  for (const r of rules) {
    const re = new RegExp(`^${r[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
    if (re.test(path) && (!best || r[1].length > best[1].length || (r[1].length === best[1].length && r[0]))) best = r;
  }
  return best?.[0] ?? true;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', laquo: '«', raquo: '»', times: '×', euro: '€', pound: '£',
};
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
const clean = (s: string) => decode(s).replace(/\s+/g, ' ').trim();

// Raw-text and embedded elements go first, unclosed ones to the end as a browser reads them; then a tag walk drops
// page furniture and anything hidden, and keeps paragraphs.
const RAW = /<!--[\s\S]*?(-->|$)|<(script|style|noscript|template|textarea|svg|math|iframe|object|title)\b[\s\S]*?(<\/\2\s*>|$)/gi;
const TOKEN = /<(\/?)([a-z][a-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</gi;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const DROP = new Set(['nav', 'aside', 'header', 'footer', 'form', 'button', 'select', 'dialog', 'menu']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'table', 'figure', 'figcaption', 'hr', 'address', 'details', 'summary']);
const HIDDEN = /(^|\s)hidden(\s|=|$)|aria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden)/i;

function walk(html: string) {
  let text = '';
  let gap = 0;
  let skip: { tag: string; depth: number } | undefined;
  const put = (t: string) => {
    const s = decode(t).replace(/\s+/g, ' ');
    if (!s.trim()) {
      if (text && !gap && !text.endsWith(' ')) text += ' ';
      return;
    }
    if (gap) {
      text = text.trimEnd();
      if (text) text += gap > 1 ? '\n\n' : '\n';
      gap = 0;
    }
    text += !text || /[\s]$/.test(text) ? s.trimStart() : s;
  };
  for (const [all, close, name, attrs = '', words] of html.matchAll(TOKEN)) {
    if (!name) {
      if (!skip) put(words ?? all);
      continue;
    }
    const tag = name.toLowerCase();
    if (skip) {
      if (tag === skip.tag && !(skip.depth += close ? -1 : 1)) skip = undefined;
      continue;
    }
    if (!close && !VOID.has(tag) && (DROP.has(tag) || HIDDEN.test(attrs))) skip = { tag, depth: 1 };
    else if (tag === 'br' || tag === 'tr') gap = Math.max(gap, 1);
    else if (tag === 'li') {
      gap = Math.max(gap, 1);
      if (!close) put('- ');
    } else if (tag === 'td' || tag === 'th') put(' ');
    else if (BLOCK.has(tag)) gap = 2;
  }
  return text.trim();
}

function metaTags(html: string) {
  const meta: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = (n: string) => tag.match(new RegExp(`\\s${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((v) => v !== undefined);
    const key = attr('property') ?? attr('name') ?? attr('itemprop');
    const content = attr('content');
    if (key && content !== undefined) meta[key.toLowerCase()] ??= decode(content).trim();
  }
  return meta;
}

/** Product mode (product research's link preview): read before scripts are stripped; a block that isn't JSON is skipped. */
export function productMeta(html: string): ProductMeta {
  const jsonLd: unknown[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      jsonLd.push(JSON.parse(m[1]!));
    } catch {
      /* not JSON: skipped */
    }
  }
  return { meta: metaTags(html), jsonLd };
}

/** A page's title, published date and readable text: the article, else the main content, else the body. */
export function readable(html: string) {
  const meta = metaTags(html);
  const title = clean(meta['og:title'] || meta['twitter:title'] || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300);
  const date = meta['article:published_time'] ?? meta['datepublished'] ?? meta['date'] ?? meta['pubdate'] ?? meta['dc.date'] ?? meta['dcterms.date'] ?? html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  const body = html.replace(RAW, ' ');
  const parts = [/<article\b[^>]*>([\s\S]*)<\/article>/i, /<main\b[^>]*>([\s\S]*)<\/main>/i, /<body\b[^>]*>([\s\S]*)/i].map((re) => body.match(re)?.[1]);
  let text = '';
  for (const p of [...parts, body]) if (p && (text = walk(p))) break;
  return { title, text, ...(day(date) ? { publishedAt: day(date) } : {}) };
}

/** YYYY-MM-DD from an ISO date, a PDF date (D:20260901…), or anything Date can read. */
function day(s: string | undefined) {
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? s.match(/^D:(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

const fileName = (u: URL) => decodeURIComponent(u.pathname.split('/').filter(Boolean).at(-1) ?? '') || u.hostname;
const charset = (type: string) => {
  try {
    return new TextDecoder(type.match(/charset=["']?([^;"']+)/i)?.[1]?.trim() ?? 'utf-8');
  } catch {
    return new TextDecoder();
  }
};

/** Turns an answer into text, or says why not. */
async function document(url: URL, reply: Reply, maxBytes: number, asProduct = false): Promise<Fetched> {
  const at = url.href;
  const code = asProduct && (reply.status < 200 || reply.status >= 300) ? { httpStatus: reply.status } : {};
  if (reply.status === 401 || reply.status === 407) return { url: at, status: 'login', error: 'The page asks to sign in', ...code };
  if (reply.status === 402) return { url: at, status: 'paywalled', error: 'The page is behind a paywall', ...code };
  if (reply.status < 200 || reply.status >= 300) return { url: at, status: 'failed', error: `The site answered HTTP ${reply.status}`, ...code };
  const type = reply.headers['content-type'] ?? '';
  const mime = type.split(';')[0]!.trim().toLowerCase();
  if (![...HTML, ...TEXT, 'application/pdf'].includes(mime)) return { url: at, status: 'unsupported', error: mime ? `${mime} isn't a document that can be read` : "The page didn't say what it is" };
  const bytes = await readBody(reply, maxBytes);
  if (!bytes) return { url: at, status: 'too_large', error: `The file is over the ${maxBytes >= 1_048_576 ? `${maxBytes / 1_048_576} MB` : `${maxBytes / 1024} KB`} limit` };
  if (mime === 'application/pdf') return pdf(url, bytes);
  const raw = charset(type).decode(bytes);
  // A markdown document's first # heading is its title (sites that serve markdown on request do).
  const heading = mime.includes('markdown') ? clean(raw.match(/^#[ \t]+(.+)$/m)?.[1] ?? '') : '';
  if (TEXT.includes(mime)) return raw.trim() ? { url: at, status: 'read', title: heading || fileName(url), text: raw.trim() } : { url: at, status: 'failed', error: 'The file is empty' };
  const page = readable(raw);
  // ponytail: markers, not a model: a page that hides its text behind a wall or a sign-in form is skipped, not half-read.
  if (/"isAccessibleForFree"\s*:\s*"?false/i.test(raw) || /\b(?:class|id)\s*=\s*["'][^"']*\bpaywall/i.test(raw) || /subscribe (?:now )?to (?:continue|keep) reading|for subscribers only/i.test(raw))
    return { url: at, status: 'paywalled', error: 'The page is behind a paywall' };
  if (/<input\b[^>]*type\s*=\s*["']?password/i.test(raw) && page.text.length < 1000) return { url: at, status: 'login', error: 'The page asks to sign in' };
  if (!page.text) return { url: at, status: 'failed', error: 'No readable text on the page' };
  return { url: at, status: 'read', title: page.title || fileName(url), ...(page.publishedAt ? { publishedAt: page.publishedAt } : {}), text: page.text, ...(asProduct ? { product: productMeta(raw) } : {}) };
}

async function pdf(url: URL, bytes: Buffer): Promise<Fetched> {
  const { extractText, getDocumentProxy, getMeta } = await import('unpdf');
  try {
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const { text } = await extractText(doc, { mergePages: true });
      const { info } = (await getMeta(doc)) as { info: Record<string, unknown> };
      const at = day(typeof info.CreationDate === 'string' ? info.CreationDate : undefined);
      if (!text.trim()) return { url: url.href, status: 'failed', error: 'The PDF has no text in it (a scan?)' };
      return { url: url.href, status: 'read', title: clean(String(info.Title ?? '')) || fileName(url), ...(at ? { publishedAt: at } : {}), text: text.trim() };
    } finally {
      await doc.loadingTask.destroy();
    }
  } catch {
    return { url: url.href, status: 'failed', error: "The PDF couldn't be read" };
  }
}

const UPLOADS: Record<string, string> = { pdf: 'application/pdf', txt: 'text/plain', vtt: 'text/plain', srt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html' };

/** An uploaded document (Research From Source), read as the same file fetched from a site would be; its name says what it is. */
export function readUpload(name: string, bytes: Uint8Array, maxBytes = 10 * 1_048_576): Promise<Omit<Fetched, 'url'>> {
  const type = UPLOADS[name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''];
  if (!type) return Promise.resolve({ status: 'unsupported', error: 'Upload a PDF, or a text, markdown, transcript (.vtt, .srt), CSV or HTML file' });
  const body = (async function* () {
    yield bytes;
  })();
  return document(new URL(`upload:/${encodeURIComponent(name)}`), { status: 200, headers: { 'content-type': type }, body, close: () => {} }, maxBytes).then(({ url: _, ...read }) => read);
}

/**
 * A fetcher. One per server: it remembers robots.txt for a day and spaces requests to a site `gapMs` apart. `blocked`
 * is the workspace's blocked domains (a domain blocks its subdomains).
 */
export function createFetcher({
  transport = pinned,
  resolve = (host: string): Promise<Addr[]> => lookup(host, { all: true }),
  gapMs = 1000,
  maxBytes = 10 * 1_048_576,
  timeoutMs = 20_000,
}: { transport?: Transport; resolve?: (host: string) => Promise<Addr[]>; gapMs?: number; maxBytes?: number; timeoutMs?: number } = {}) {
  const next = new Map<string, number>();
  const robots = new Map<string, { at: number; txt: string }>();

  /** The address to connect to: refused when any answer is this computer or its network. */
  async function vet(host: string): Promise<Addr> {
    const family = isIP(host);
    const answers = family ? [{ address: host, family }] : await resolve(host).catch(() => []);
    if (!answers.length) throw new Error(`Couldn't find ${host}`);
    if (answers.some((a) => LOCAL.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'))) throw new Error(`${host} is on this computer or its network: not read`);
    return answers.find((a) => a.family === 4) ?? answers[0]!;
  }

  // `image`: off by default; reads one png, jpeg, webp or gif (product research's image cache) instead of a document.
  // `product`: off by default; a read HTML page also carries its meta tags and JSON-LD (product research's link preview).
  return async function get(input: string, { blocked = [] as string[], image: asImage = false, product: asProduct = false } = {}): Promise<Fetched> {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return { url: input, status: 'failed', error: "That isn't a web address" };
    }
    // One DNS answer per host per fetch: robots.txt and the page use the same checked address.
    const hosts = new Map<string, Promise<Addr>>();
    const ask = async (u: URL, headers: Record<string, string> = HEADERS) => {
      const host = u.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
      if (!hosts.has(host)) hosts.set(host, vet(host));
      const to = await hosts.get(host)!;
      // Book the slot now (two fetches at once queue up), then again from when it really went (a late timer).
      const at = Math.max(Date.now(), next.get(host) ?? 0);
      next.set(host, at + gapMs);
      if (at > Date.now()) await new Promise((ok) => setTimeout(ok, at - Date.now()));
      next.set(host, Math.max(next.get(host)!, Date.now() + gapMs));
      return transport(u, to, headers, timeoutMs);
    };
    /** The site's robots.txt ('' when it has none), or null when it can't say (5xx, 429): then nothing is read. */
    const rules = async (u: URL) => {
      const hit = robots.get(u.origin);
      if (hit && Date.now() - hit.at < DAY) return hit.txt;
      let r = new URL('/robots.txt', u);
      for (let hop = 0; ; hop++) {
        const reply = await ask(r);
        try {
          if (reply.status >= 300 && reply.status < 400 && reply.headers.location && hop < 5) {
            r = new URL(reply.headers.location, r);
            continue;
          }
          if (reply.status >= 500 || reply.status === 429) return null;
          const txt = reply.status === 200 ? ((await readBody(reply, 512_000))?.toString() ?? null) : '';
          if (txt !== null) robots.set(u.origin, { at: Date.now(), txt });
          return txt;
        } finally {
          reply.close();
        }
      }
    };

    try {
      for (let hop = 0; ; hop++) {
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return { url: url.href, status: 'failed', error: 'Only http and https pages can be read' };
        const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
        const bad = blocked.map((d) => d.toLowerCase()).find((d) => host === d || host.endsWith(`.${d}`));
        if (bad) return { url: url.href, status: 'blocked_domain', error: `${bad} is on this workspace's blocked list` };
        const txt = await rules(url);
        if (txt === null || !robotsAllows(txt, url.pathname + url.search)) return { url: url.href, status: 'blocked_robots', error: "The site's robots.txt asks tools not to read this page" };
        const reply = await ask(url, asImage ? IMAGE_HEADERS : HEADERS);
        try {
          const to = reply.status >= 300 && reply.status < 400 ? reply.headers.location : undefined;
          if (!to) return asImage ? await image(url, reply) : await document(url, reply, maxBytes, asProduct);
          if (hop === 5) return { url: url.href, status: 'failed', error: 'Too many redirects (more than 5)' };
          url = new URL(to, url);
        } finally {
          reply.close();
        }
      }
    } catch (e) {
      return { url: url.href, status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  };
}
