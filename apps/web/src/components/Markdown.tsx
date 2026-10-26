import { Fragment } from 'react';
import { inline, parseMarkdown } from '../lib/markdown';
import { cx, Table } from './ui';

function Inline({ text }: { text: string }) {
  return inline(text).map((s, i) =>
    typeof s === 'string' ? (
      <Fragment key={i}>{s}</Fragment>
    ) : 'b' in s ? (
      <strong key={i} className="font-semibold text-text">
        {s.b}
      </strong>
    ) : (
      <code key={i} className="rounded bg-panel-2 px-1 py-0.5 font-mono text-[12px] text-text">
        {s.code}
      </code>
    ),
  );
}

/** Renders the knowledge packs' markdown (see lib/markdown for the subset). */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="grid max-w-[75ch] gap-3 text-[13px] leading-relaxed text-text-2">
      {parseMarkdown(text).map((b, i) =>
        b.t === 'h' ? (
          b.level === 1 ? (
            <h2 key={i} className="font-display text-lg font-semibold text-text">
              {b.text}
            </h2>
          ) : (
            <h3 key={i} className="mt-2 text-[14px] font-semibold text-text">
              {b.text}
            </h3>
          )
        ) : b.t === 'p' ? (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        ) : b.t === 'list' ? (
          <ul key={i} className="grid gap-1">
            {b.items.map((it, j) => (
              <li key={j} className={cx('flex gap-2', it.depth > 0 && 'pl-6')}>
                <span aria-hidden className="w-5 shrink-0 text-right text-muted tabular-nums">
                  {it.marker || '•'}
                </span>
                <span className="min-w-0">
                  <Inline text={it.text} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Table key={i} className="text-[12px]">
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k}>
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        ),
      )}
    </div>
  );
}
