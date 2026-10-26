import { describe, expect, it } from 'vitest';
import type { FlowDraft } from '@frontline/shared';
import { delayLabel, flowText, messageText } from './flows';

describe('delayLabel', () => {
  it('says the wait before a step', () => {
    expect([0, 1, 5, 24, 48, 36].map(delayLabel)).toEqual(['Right away', 'Wait 1 hour', 'Wait 5 hours', 'Wait 1 day', 'Wait 2 days', 'Wait 36 hours']);
  });
});

describe('flowText', () => {
  it('lays a flow out for pasting into an email tool', () => {
    const f: FlowDraft = {
      id: 'f1',
      storeId: 's',
      agentId: 's:email_sms',
      name: 'Checkout abandonment',
      trigger: 'Checkout started, no order within 1 hour',
      notes: 'n',
      createdAt: '2026-10-26T00:00:00Z',
      messages: [
        { delayHours: 1, channel: 'email', subject: 'Forgot something?', preview: 'Your cart is waiting', body: 'Hi there' },
        { delayHours: 24, channel: 'sms', body: 'Still thinking? 10% off: SAVE10', offer: '10% code SAVE10' },
      ],
    };
    expect(messageText(f.messages[0]!)).toBe('Subject: Forgot something?\nPreview: Your cart is waiting\n\nHi there');
    expect(flowText(f)).toBe(
      [
        'Checkout abandonment',
        'Trigger: Checkout started, no order within 1 hour',
        '',
        'Step 1 · Email · Wait 1 hour',
        'Subject: Forgot something?\nPreview: Your cart is waiting\n\nHi there',
        '',
        'Step 2 · SMS · Wait 1 day',
        'Still thinking? 10% off: SAVE10\n\nOffer: 10% code SAVE10',
      ].join('\n'),
    );
  });
});
