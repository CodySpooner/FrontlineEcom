import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { PageDraft, PageDraftStatus } from '@frontline/shared';

// Store Developer drafts for the Store Builder. Status is derived from the latest `store.publish_page` approval for
// the draft, so it can't drift from the approvals table.

export type NewPageDraft = Omit<PageDraft, 'id' | 'status' | 'approvalId' | 'createdAt' | 'publishedAt'>;

const SELECT = `SELECT d.*, a.id AS approval_id, a.status AS approval_status FROM page_drafts d
  LEFT JOIN approvals a ON a.id = (
    SELECT id FROM approvals WHERE json_extract(action_json, '$.kind') = 'store.publish_page' AND json_extract(action_json, '$.payload.draftId') = d.id
    ORDER BY created_at DESC, rowid DESC LIMIT 1)`;

const TAGS = new Set('h1 h2 h3 h4 h5 h6 p br hr ul ol li strong b em i u s small sup sub span div blockquote a img figure figcaption table caption thead tbody tfoot tr th td'.split(' '));
const ATTRS = new Set('href src alt title width height colspan rowspan target rel class id loading'.split(' '));
// Whitespace is HTML's (tab, LF, FF, CR, space), not JS's \s: a browser keeps U+00A0 and other Unicode spaces inside a
// name or value, so treating them as separators would read a different tag than the browser does.
const TAG = /<(\/?)([a-zA-Z][^\t\n\f\r />]*)/y;
// Comments end where a browser ends them: "<!--" at its first "-->" or "--!>" ("<!-->" and "<!--->" at once), and "<!x",
// "<?x", "</ x" (bogus comments, doctypes) at the next ">", even one that would sit inside a quoted value in a tag.
const COMMENT = /<!--(?:-?>|[^]*?(?:--!?>|$))|<(?:!|\?|\/(?![a-zA-Z>]))[^>]*>?/y;

/**
 * Why `html` can't go on a storefront, or undefined when it's clean: structural tags only, no scripts, handlers,
 * styles or embeds, links only to http(s)/mailto/tel. The owner previews drafts sandboxed, where none of that shows.
 */
// ponytail: an allowlist that refuses, not a sanitizer; a parser (e.g. parse5) if legit pages start getting refused.
export function unsafeHtml(html: string): string | undefined {
  // Tags are read the way a browser's tokenizer reads them: a quote opens a value only right after "=" (one inside a name
  // or an unquoted value is just a character), so the scan ends each tag at the same ">" the browser does and no
  // markup hides inside what only looks like a quoted value. End tags' attributes count too (browsers parse, then drop them).
  let i = 0;
  const at = (re: RegExp) => ((re.lastIndex = i), re.exec(html)?.[0] ?? ''); // sticky: matches at i, no copies
  while ((i = html.indexOf('<', i)) !== -1) {
    const comment = at(COMMENT);
    if (comment) {
      i += comment.length;
      continue;
    }
    const open = ((TAG.lastIndex = i), TAG.exec(html));
    if (!open) {
      i++;
      continue;
    }
    const tag = open[2]!.toLowerCase();
    if (!TAGS.has(tag)) return `<${tag}> is not allowed`;
    i += open[0].length;
    for (;;) {
      i += at(/[\t\n\f\r /]*/y).length;
      if (i >= html.length || html[i] === '>') break;
      const attr = at(/[^][^\t\n\f\r />=]*/y); // a name may start with "=" and hold quotes
      i += attr.length;
      i += at(/[\t\n\f\r ]*/y).length;
      let value = '';
      if (html[i] === '=') {
        i += at(/=[\t\n\f\r ]*/y).length;
        const q = html[i];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, i + 1);
          value = html.slice(i + 1, end === -1 ? undefined : end);
          i = end === -1 ? html.length : end + 1;
        } else {
          value = at(/[^\t\n\f\r >]*/y);
          i += value.length;
        }
      }
      if (open[1]) continue;
      const a = attr.toLowerCase();
      if (!ATTRS.has(a)) return `the ${a} attribute is not allowed`;
      if (a !== 'href' && a !== 'src') continue;
      const url = value
        .replace(/&#(x?)([0-9a-f]+);?/gi, (_, x: string, n: string) => String.fromCharCode(parseInt(n, x ? 16 : 10)))
        .replace(/&colon;/gi, ':')
        .replace(/[\s\u0000-\u001f]+/g, '')
        .toLowerCase();
      // Any colon before the first / ? # must end an allowed scheme: what we can't decode (&Tab; …) can't make one.
      const scheme = /^([^/?#:]*):/.exec(url)?.[1];
      if (scheme !== undefined && !['http', 'https', 'mailto', 'tel'].includes(scheme)) return `${scheme}: links are not allowed`;
    }
  }
  return undefined;
}

export function savePageDraft(db: DatabaseSync, d: NewPageDraft, now = new Date()): PageDraft {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO page_drafts (id, store_id, agent_id, run_id, kind, product_id, title, html, seo_title, seo_description, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, d.storeId, d.agentId, d.runId ?? null, d.kind, d.productId ?? null, d.title, d.html, d.seoTitle ?? null, d.seoDescription ?? null, d.notes, now.toISOString());
  return getPageDraft(db, id)!;
}

export function getPageDraft(db: DatabaseSync, id: string): PageDraft | undefined {
  const r = db.prepare(`${SELECT} WHERE d.id = ?`).get(id);
  return r ? toDraft(r) : undefined;
}

/** Newest first. */
export function listPageDrafts(db: DatabaseSync, q: { storeIds?: string[]; status?: PageDraftStatus; limit?: number } = {}): PageDraft[] {
  const ids = q.storeIds?.length ? q.storeIds : undefined;
  return db
    .prepare(`${SELECT} ${ids ? `WHERE d.store_id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY d.created_at DESC, d.rowid DESC LIMIT ?`)
    .all(...(ids ?? []), q.status ? 1000 : (q.limit ?? 100))
    .map(toDraft)
    .filter((d) => !q.status || d.status === q.status)
    .slice(0, q.limit ?? 100);
}

export const markPublished = (db: DatabaseSync, id: string, now = new Date()) =>
  db.prepare('UPDATE page_drafts SET published_at = ? WHERE id = ? AND published_at IS NULL').run(now.toISOString(), id).changes > 0;

export const deletePageDraft = (db: DatabaseSync, id: string) => db.prepare('DELETE FROM page_drafts WHERE id = ?').run(id).changes > 0;

function toDraft(r: Record<string, unknown>): PageDraft {
  const opt = (k: string) => (r[k] == null ? undefined : String(r[k]));
  const [runId, productId, seoTitle, seoDescription, approvalId, publishedAt] = ['run_id', 'product_id', 'seo_title', 'seo_description', 'approval_id', 'published_at'].map(opt);
  const status: PageDraftStatus = publishedAt
    ? 'published'
    : r.approval_status === 'pending' ? 'pending'
    : r.approval_status === 'approved' ? 'approved'
    : r.approval_status === 'denied' ? 'rejected'
    : 'draft';
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    agentId: String(r.agent_id),
    ...(runId ? { runId } : {}),
    kind: r.kind as PageDraft['kind'],
    ...(productId ? { productId } : {}),
    title: String(r.title),
    html: String(r.html),
    ...(seoTitle ? { seoTitle } : {}),
    ...(seoDescription ? { seoDescription } : {}),
    notes: String(r.notes),
    status,
    ...(approvalId ? { approvalId } : {}),
    createdAt: String(r.created_at),
    ...(publishedAt ? { publishedAt } : {}),
  };
}
