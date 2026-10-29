import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SA_DATASETS, SA_SOURCES, renderSourcesDoc, type SaDataset } from '@frontline/shared';
import { SYNCERS } from '../sync';

const DOC = new URL('../../../../docs/features/store-analytics-sources.md', import.meta.url);

describe('SA_SOURCES', () => {
  it('has a row for every scheduled syncer and for demo data', () => {
    for (const kind of [...Object.keys(SYNCERS), 'demo']) expect(SA_SOURCES, kind).toHaveProperty(kind);
  });

  it('gives every unsupported dataset a reason, and only supported ones are read', () => {
    for (const [kind, s] of Object.entries(SA_SOURCES))
      for (const [k, d] of Object.entries(s.datasets)) {
        if (d.support === 'unsupported') expect(d.reason, `${kind}.${k}`).toBeTruthy();
        if (d.reads) expect(d.support, `${kind}.${k}`).toBe('supported');
      }
  });

  it('matches the committed sources doc, which lists every unsupported dataset with its reason', () => {
    const doc = renderSourcesDoc();
    if (process.env.UPDATE_SOURCES_DOC) writeFileSync(DOC, doc);
    const committed = readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
    expect(committed, 'regenerate: UPDATE_SOURCES_DOC=1 pnpm exec vitest run apps/server/src/store-analytics/sources.test.ts').toBe(doc);
    expect(doc).toContain('Syncs run only while Frontline Ecom is open. There are no webhooks');
    for (const s of Object.values(SA_SOURCES))
      for (const [k, d] of Object.entries(s.datasets))
        if (d.support === 'unsupported') expect(doc).toContain(`| ${SA_DATASETS[k as SaDataset]} | unsupported |`);
  });
});
