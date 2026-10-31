// Limits Frontline sets (ST-24b, decision 10): read-only on Usage & Limits, each said from the constant that enforces it,
// never retyped.
import { AD_LIMITS, APPROVAL_INPUT_CHARS, PRICE_STEP, RESEARCH_TURNS, RUN_TURNS } from '@frontline/agents';
import { CREDITS, type FrontlineLimit } from '@frontline/shared';
import { CAPS } from '../product-research/caps';

/** KB-25's request guard (`app.ts` kbGuard) on the Knowledge and Product Research APIs. */
export const GUARD = { changesPerMinute: 300, startsPerMinute: 10 } as const;

const pct = (share: number) => `${Math.round(share * 100)}%`;

export function frontlineLimits(): FrontlineLimit[] {
  const credits = Object.entries(CREDITS).filter(([, n]) => n > 0);
  return [
    { label: 'An ad budget raise', value: `at most ${pct(AD_LIMITS.raiseStep)} a step` },
    { label: "A campaign's next budget change", value: `${AD_LIMITS.settleDays} days after the last` },
    { label: 'A TikTok campaign daily budget', value: `more than $${AD_LIMITS.tiktokMinUsd}` },
    { label: 'A price test', value: `within ±${pct(PRICE_STEP)} a step` },
    { label: 'Claude steps per run', value: `${RUN_TURNS} (${RESEARCH_TURNS} in Knowledge research)` },
    { label: 'Tool input an approval shows', value: `${APPROVAL_INPUT_CHARS.toLocaleString('en-US')} characters at most` },
    { label: 'Higgsfield credits per render', value: credits.map(([kind, n]) => `${kind} ${n}`).join(' · ') },
    { label: 'Knowledge and Product Research changes', value: `${GUARD.changesPerMinute} a minute, ${GUARD.startsPerMinute} of them starting agent runs` },
    { label: 'CJ search pages per query', value: `${CAPS.cj.pagesPerQueryPerDay} a day` },
    { label: 'CJ catalog calls', value: `${CAPS.cj.ingestionCallsPerDay} a day` },
    { label: 'CJ watch calls', value: `${CAPS.cj.watchCallsPerDay} a day` },
    { label: 'CJ other-supplier calls per search', value: `${CAPS.cj.altSupplierCallsPerSearch}` },
  ];
}
