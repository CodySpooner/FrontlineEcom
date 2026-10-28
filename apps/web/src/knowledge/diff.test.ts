import { describe, expect, it } from 'vitest';
import { wordDiff } from './diff';

describe('word diff', () => {
  it('marks the words cut from the first text and added in the second, keeping the ones in common', () => {
    expect(wordDiff('Pawsome ads open on the dog', 'Ads open on the problem')).toEqual([
      { op: 'cut', text: 'Pawsome ads' },
      { op: 'add', text: 'Ads' },
      { op: 'same', text: 'open on the' },
      { op: 'cut', text: 'dog' },
      { op: 'add', text: 'problem' },
    ]);
  });

  it('ignores spacing; an unchanged text is one run, and an empty side is all cut or all added', () => {
    expect(wordDiff('Open  on\nthe problem ', 'Open on the problem')).toEqual([{ op: 'same', text: 'Open on the problem' }]);
    expect(wordDiff('', 'New words')).toEqual([{ op: 'add', text: 'New words' }]);
    expect(wordDiff('Old words', ' ')).toEqual([{ op: 'cut', text: 'Old words' }]);
    expect(wordDiff('', '')).toEqual([]);
  });
});
