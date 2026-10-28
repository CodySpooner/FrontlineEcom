export type DiffPart = { op: 'same' | 'cut' | 'add'; text: string };

/** `to` against `from`, word by word (spacing ignored), as runs of words in common, cut from `from` and added in `to`. */
// ponytail: an n×m longest-common-subsequence table; a card's body (8000 characters, ~1400 words) is about 2M cells.
export function wordDiff(from: string, to: string): DiffPart[] {
  const a = from.split(/\s+/).filter(Boolean);
  const b = to.split(/\s+/).filter(Boolean);
  const w = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * w); // lcs[i * w + j]: common words of a[i..] and b[j..]
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
  }
  const out: DiffPart[] = [];
  const push = (op: DiffPart['op'], word: string) => {
    const last = out.at(-1);
    if (last?.op === op) last.text += ` ${word}`;
    else out.push({ op, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push('same', a[i++]!);
      j++;
    } else if (j === b.length || (i < a.length && lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) push('cut', a[i++]!);
    else push('add', b[j++]!);
  }
  return out;
}
