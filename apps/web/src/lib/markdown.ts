// ponytail: only the markdown the knowledge packs use (#/## headings, -/1. lists one level deep, pipe tables,
// **bold**, `code`). Reach for a real parser if docs start using links, fences or emphasis.

export type ListItem = { depth: number; marker: string; text: string };
export type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'list'; items: ListItem[] }
  | { t: 'table'; head: string[]; rows: string[][] };

const cells = (line: string) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function parseMarkdown(md: string): Block[] {
  const out: Block[] = [];
  let gap = true; // a blank line ends the current paragraph
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const prev = out[out.length - 1];
    const h = /^(#{1,3}) (.*)/.exec(line);
    const li = /^(\s*)([-*]|\d+\.) (.*)/.exec(raw);
    if (!line) gap = true;
    else if (h) {
      const [, hashes = '', text = ''] = h;
      out.push({ t: 'h', level: hashes.length, text });
    } else if (line.startsWith('|')) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // header separator
      if (prev?.t === 'table') prev.rows.push(cells(line));
      else out.push({ t: 'table', head: cells(line), rows: [] });
    } else if (li) {
      const [, indent = '', marker = '', text = ''] = li;
      const item = { depth: indent.length >= 2 ? 1 : 0, marker: /\d/.test(marker) ? marker : '', text };
      if (prev?.t === 'list') prev.items.push(item);
      else out.push({ t: 'list', items: [item] });
    } else if (prev?.t === 'p' && !gap) prev.text += ` ${line}`;
    else out.push({ t: 'p', text: line });
    if (line) gap = false;
  }
  return out;
}

export function inline(text: string): (string | { b: string } | { code: string })[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter(Boolean)
    .map((s) => (/^\*\*.+\*\*$/.test(s) ? { b: s.slice(2, -2) } : /^`.+`$/.test(s) ? { code: s.slice(1, -1) } : s));
}
