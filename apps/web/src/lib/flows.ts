import type { FlowDraft, FlowMessage } from '@frontline/shared';

export const CHANNEL = { email: 'Email', sms: 'SMS' };

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** The wait before a step, as the owner would set it in Klaviyo or Shopify Email. */
export const delayLabel = (h: number) => (h === 0 ? 'Right away' : `Wait ${h % 24 === 0 ? plural(h / 24, 'day') : plural(h, 'hour')}`);

/** One message ready to paste. */
export const messageText = (m: FlowMessage) =>
  [m.subject && `Subject: ${m.subject}`, m.preview && `Preview: ${m.preview}`].filter(Boolean).join('\n') + (m.subject || m.preview ? '\n\n' : '') + m.body + (m.offer ? `\n\nOffer: ${m.offer}` : '');

/** The whole flow: name, trigger, then every step with its wait. */
export const flowText = (f: FlowDraft) =>
  [`${f.name}`, `Trigger: ${f.trigger}`, ...f.messages.flatMap((m, i) => ['', `Step ${i + 1} · ${CHANNEL[m.channel]} · ${delayLabel(m.delayHours)}`, messageText(m)])].join('\n');
