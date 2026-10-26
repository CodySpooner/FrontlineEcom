import { expect, test } from 'vitest';
import { unsafeHtml } from './index';

test('storefront HTML: structure and http(s) links pass; scripts, handlers, styles, embeds and odd schemes are refused', () => {
  expect(unsafeHtml('<h2>Why it works</h2><p>Cool <strong>skin</strong>.</p><ul><li><a href="https://x.com/a?b=1&amp;c=2" target="_blank">Guide</a></li></ul><img src="/cdn/a.png" alt="A"><!-- note -->')).toBeUndefined();
  expect(unsafeHtml('<p>Hi</p><script src="https://evil.js"></script>')).toBe('<script> is not allowed');
  expect(unsafeHtml('<IFRAME src="https://x.com">')).toBe('<iframe> is not allowed');
  expect(unsafeHtml('<svg><circle/></svg>')).toBe('<svg> is not allowed');
  expect(unsafeHtml('<img src=x onerror=alert(1)>')).toBe('the onerror attribute is not allowed');
  expect(unsafeHtml('<img title="a>b" onerror="alert(1)">')).toBe('the onerror attribute is not allowed'); // a ">" inside quotes doesn't end the tag
  expect(unsafeHtml('<p style="display:none">hidden link</p>')).toBe('the style attribute is not allowed');
  expect(unsafeHtml('<a href="javascript:alert(1)">x</a>')).toBe('javascript: links are not allowed');
  expect(unsafeHtml('<a href=" jav&#x61;script&colon;alert(1)">x</a>')).toBe('javascript: links are not allowed');
  expect(unsafeHtml("<img src='data:image/svg+xml;base64,PHN2Zz4='>")).toBe('data: links are not allowed');
  expect(unsafeHtml('<a href="mailto:hi@shop.com">Mail</a> <a href="#faq">FAQ</a>')).toBeUndefined();
});
