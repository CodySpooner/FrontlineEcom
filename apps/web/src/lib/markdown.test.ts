import { describe, expect, it } from 'vitest';
import { inline, parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('reads the subset the knowledge packs use', () => {
    const md = [
      '# Ops playbook',
      '',
      '## Mission',
      'Ship on time.',
      'Refund fast.',
      '',
      '1. Check `list_orders`.',
      '2. Rank by **value**.',
      '  - nested note',
      '- bullet',
      '  | Metric | Flag |',
      '  |---|:---:|',
      '  | ROAS | −20% |',
      'After.',
    ].join('\r\n');
    expect(parseMarkdown(md)).toEqual([
      { t: 'h', level: 1, text: 'Ops playbook' },
      { t: 'h', level: 2, text: 'Mission' },
      { t: 'p', text: 'Ship on time. Refund fast.' },
      {
        t: 'list',
        items: [
          { depth: 0, marker: '1.', text: 'Check `list_orders`.' },
          { depth: 0, marker: '2.', text: 'Rank by **value**.' },
          { depth: 1, marker: '', text: 'nested note' },
          { depth: 0, marker: '', text: 'bullet' },
        ],
      },
      { t: 'table', head: ['Metric', 'Flag'], rows: [['ROAS', '−20%']] },
      { t: 'p', text: 'After.' },
    ]);
  });
});

describe('inline', () => {
  it('splits bold and code out of text', () => {
    expect(inline('Use `store_summary` for **7 and 30** days')).toEqual(['Use ', { code: 'store_summary' }, ' for ', { b: '7 and 30' }, ' days']);
    expect(inline('plain')).toEqual(['plain']);
  });
});
