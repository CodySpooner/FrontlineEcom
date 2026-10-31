// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SA_METRICS, type SaInsight, type SaRule } from '@frontline/shared';
import { renderApp } from '../test-utils';
import { FindingCard } from './FindingCard';

const RULES: SaRule[] = [
  { id: 'ads_contribution@1', name: 'Ad spend up, contribution down', when: 'Ad spend rose 10% or more', minSample: 'Both periods', datasets: ['ad_spend'], metrics: ['ad_spend', 'contribution_after_ads'] },
  { id: 'source_health@1', name: 'Stale or failed source', when: 'A source fails', minSample: 'None', datasets: [], metrics: [] },
];
const ADS: SaInsight = {
  rule: 'ads_contribution@1', kind: 'business', tone: 'warn', title: 'Ad spend up 20.0% while contribution after ads fell 3.2%', detail: 'Ad spend $420 vs $350 · contribution $1,210 vs $1,250',
  evidence: { ad_spend: 420 }, target: { kind: 'metric', id: 'contribution_after_ads' },
};
const card = () => screen.getByRole('region', { name: 'Finding' });

afterEach(cleanup);

describe('FindingCard (SA-77)', () => {
  it('a rule insight: the rule, Observed, what was seen, its metric definitions, the limitation and Investigate', () => {
    const onClick = vi.fn();
    renderApp(<FindingCard insight={ADS} rules={RULES} investigate={{ onClick, title: 'Chart contribution after ads' }} />);
    const c = within(card());
    expect(c.getByText('Rule · Ad spend up, contribution down')).toBeTruthy();
    expect(c.getByText('Observed')).toBeTruthy();
    expect(c.getByRole('heading', { name: ADS.title })).toBeTruthy();
    expect(c.getByText(ADS.detail)).toBeTruthy();
    for (const id of ['ad_spend', 'contribution_after_ads'] as const) {
      const chip = c.getByText(`${SA_METRICS[id].label} v1`);
      expect(document.getElementById(chip.getAttribute('aria-describedby')!)!.textContent).toBe(SA_METRICS[id].formula); // opens its definition
    }
    expect(c.getByText("What a fixed rule observed in this store's data, not why it happened.")).toBeTruthy();
    fireEvent.click(c.getByRole('button', { name: 'Investigate' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(card().textContent).not.toMatch(/score|confidence/i);
  });

  it('data health says so; Investigate can be a link; a target with no screen has no button', () => {
    const health: SaInsight = { rule: 'source_health@1', kind: 'data_health', tone: 'red', title: 'Meta Ads sync failing', detail: 'ad spend · 401', evidence: {}, target: { kind: 'sources' } };
    renderApp(<FindingCard insight={health} rules={RULES} investigate={{ to: '/orders' }} />);
    const c = within(card());
    expect(c.getByText('Data health')).toBeTruthy();
    expect(c.getByText('Rules that read this source are held back until it syncs again.')).toBeTruthy();
    expect(c.getByRole('link', { name: 'Investigate' }).getAttribute('href')).toBe('/orders');
    cleanup();
    renderApp(<FindingCard insight={{ ...ADS, target: { kind: 'listings', channel: 'tiktok_shop' } }} rules={RULES} />);
    expect(within(card()).queryByRole('button')).toBeNull();
    expect(within(card()).queryByRole('link')).toBeNull();
  });

  it('no insight: the Rule card fallback with How flags work (Q14)', () => {
    renderApp(<FindingCard rules={RULES} />);
    const c = within(card());
    expect(c.getByRole('heading', { name: 'No flags right now' })).toBeTruthy();
    expect(c.getByText('None of the 2 rules found anything in this period.')).toBeTruthy();
    expect(c.queryByText('Observed')).toBeNull();
    fireEvent.click(c.getByRole('button', { name: 'How flags work' }));
    expect(within(screen.getByRole('dialog', { name: 'How flags work' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('has no confidence or score field', () => {
    // @ts-expect-error a finding is what was observed: no score
    void (<FindingCard rules={RULES} score={0.9} />);
    // @ts-expect-error …and no confidence
    void (<FindingCard rules={RULES} confidence="high" />);
  });
});
