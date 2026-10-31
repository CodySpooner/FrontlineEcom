import { AD_LIMITS, APPROVAL_INPUT_CHARS, PRICE_STEP, RESEARCH_TURNS, RUN_TURNS } from '@frontline/agents';
import { CREDITS, type FrontlineLimit } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { CAPS } from '../product-research/caps';
import { GUARD } from './limits';

// Settings → Usage & Limits → Limits Frontline sets (ST-24b, decision 10): every value shown is the constant the code enforces.
test('the limits Frontline sets are said from the constants that enforce them, never retyped', async () => {
  const shown = (await (await createApp(openDb()).request('/api/config/limits')).json()) as FrontlineLimit[];
  const value = (label: string) => shown.find((l) => l.label === label)?.value;
  expect(value('An ad budget raise')).toBe(`at most ${AD_LIMITS.raiseStep * 100}% a step`);
  expect(value("A campaign's next budget change")).toBe(`${AD_LIMITS.settleDays} days after the last`);
  expect(value('A TikTok campaign daily budget')).toBe(`more than $${AD_LIMITS.tiktokMinUsd}`);
  expect(value('A price test')).toBe(`within ±${PRICE_STEP * 100}% a step`);
  expect(value('Claude steps per run')).toBe(`${RUN_TURNS} (${RESEARCH_TURNS} in Knowledge research)`);
  expect(value('Tool input an approval shows')).toBe(`${APPROVAL_INPUT_CHARS.toLocaleString('en-US')} characters at most`);
  expect(value('Higgsfield credits per render')).toBe(`image ${CREDITS.image} · video ${CREDITS.video} · ugc ${CREDITS.ugc}`);
  expect(value('Knowledge and Product Research changes')).toBe(`${GUARD.changesPerMinute} a minute, ${GUARD.startsPerMinute} of them starting agent runs`);
  expect(value('CJ search pages per query')).toBe(`${CAPS.cj.pagesPerQueryPerDay} a day`);
  expect(value('CJ catalog calls')).toBe(`${CAPS.cj.ingestionCallsPerDay} a day`);
  expect(value('CJ watch calls')).toBe(`${CAPS.cj.watchCallsPerDay} a day`);
  expect(value('CJ other-supplier calls per search')).toBe(`${CAPS.cj.altSupplierCallsPerSearch}`);
  expect(shown).toHaveLength(12);
  // Today's values, as decision 10 lists them: a constant changed on purpose updates this line too.
  expect([AD_LIMITS.raiseStep, AD_LIMITS.settleDays, AD_LIMITS.tiktokMinUsd, PRICE_STEP, RUN_TURNS, RESEARCH_TURNS, APPROVAL_INPUT_CHARS, GUARD.changesPerMinute, GUARD.startsPerMinute]).toEqual([0.3, 3, 50, 0.3, 40, 30, 2000, 300, 10]);
});
