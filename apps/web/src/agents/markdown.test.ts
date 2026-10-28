import { expect, test } from 'vitest';
import type { AgentEvent } from '@frontline/shared';
import { activitySteps, activitySummary } from './activity';
import { renderReply } from './markdown';

const href = (id: string) => `/knowledge?card=${id}&ws=glow`;

test('raw HTML stays text, and only web links survive (opening outside the app)', () => {
  const { html } = renderReply('<img src=x onerror=alert(1)> [docs](https://example.com) [bad](javascript:alert(1)) [app](/settings)', href);
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>');
  expect(html).not.toMatch(/href="javascript/i); // markdown-it leaves it as plain text
  expect(html).not.toContain('href="/settings"');
  expect(html).toContain('bad');
  expect(renderReply('![x](https://example.com/a.png)', href).html).not.toContain('<img');
});

test('citations number in order of first use and reuse their number; evidence tags render', () => {
  const { html, cites } = renderReply('Gift angle [kb:c-2] [measured]. Winter angle [kb:c-9] [research]. Again [kb:c-2] [hypothesis]', href);
  expect(cites).toEqual(['c-2', 'c-9']);
  expect([...html.matchAll(/href="\/knowledge\?card=([\w-]+)&amp;ws=glow">(\d)</g)].map((m) => `${m[1]}=${m[2]}`)).toEqual(['c-2=1', 'c-9=2', 'c-2=1']);
  expect(html).toMatch(/>Measured<\/span>[^]*>Research<\/span>[^]*>Hypothesis<\/span>/);
});

test('tables, fences, emphasis, nested lists and quotes render', () => {
  const { html } = renderReply('| Angle | Budget |\n|---|---|\n| Gift | $600 |\n\n```\ncode\n```\n\n*em* and **bold**\n\n- a\n  - b\n\n> quote', href);
  for (const tag of ['<table>', '<td>$600</td>', '<pre><code>code', '<em>em</em>', '<strong>bold</strong>', '<ul>\n<li>b</li>', '<blockquote>']) expect(html).toContain(tag);
});

test('activity: one sentence per real event, its outcome as the icon; the summary times the work', () => {
  const events: AgentEvent[] = [
    { type: 'tool_call', id: '1', name: 'metrics_timeseries', input: { days: 14 } },
    { type: 'tool_result', id: '1', output: 'csv', isError: false },
    { type: 'tool_call', id: '2', name: 'mcp__meta_ads__get_insights', input: {} },
    { type: 'tool_result', id: '2', output: 'nope', isError: true },
    { type: 'tool_call', id: '3', name: 'WebSearch', input: { query: 'led mask claims' } },
    { type: 'text_delta', text: 'Thinking out loud' },
  ];
  expect(activitySteps(events)).toEqual([
    { icon: 'done', text: 'Read 14 days of store metrics' },
    { icon: 'failed', text: 'get_insights (Meta Ads)' },
    { icon: 'running', text: 'Searched the web for "led mask claims"' },
  ]);
  expect(activitySummary({ status: 'done', createdAt: '2026-10-28T10:00:00Z', startedAt: '2026-10-28T10:00:00Z', endedAt: '2026-10-28T10:03:12Z' }, 5)).toBe('Worked for 3m 12s · 5 steps');
  expect(activitySummary({ status: 'running', createdAt: '2026-10-28T10:00:00Z' }, 1)).toBe('Working · 1 step');
});
