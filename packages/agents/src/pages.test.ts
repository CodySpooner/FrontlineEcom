import { expect, test } from 'vitest';
import { unsafeHtml } from './index';

test('storefront HTML: structure and http(s) links pass; scripts, handlers, styles, embeds and odd schemes are refused', () => {
  expect(unsafeHtml('<h2>Why it works</h2><p>Cool <strong>skin</strong>.</p><ul><li><a href="https://x.com/a?b=1&amp;c=2" target="_blank">Guide</a></li></ul><img src="/cdn/a.png" alt="A"><!-- note -->')).toBeUndefined();
  expect(unsafeHtml('<p>Hi</p><script src="https://evil.js"></script>')).toBe('<script> is not allowed');
  expect(unsafeHtml('<IFRAME src="https://x.com">')).toBe('<iframe> is not allowed');
  expect(unsafeHtml('<svg><circle/></svg>')).toBe('<svg> is not allowed');
  expect(unsafeHtml('<img src=x onerror=alert(1)>')).toBe('the onerror attribute is not allowed');
  expect(unsafeHtml('<img title="a>b" onerror="alert(1)">')).toBe('the onerror attribute is not allowed'); // a ">" inside quotes doesn't end the tag
  // A quote inside an unquoted value or a name is a plain character to a browser: the tag ends at the next ">", and
  // what follows is markup, even when a later quote makes it look like the inside of a value.
  expect(unsafeHtml(`<a title=x">"title="<img src=x onerror=alert(1)>">`)).toBe('the onerror attribute is not allowed');
  expect(unsafeHtml(`</a x"><img src=x onerror=alert(1)>">`)).toBe('the onerror attribute is not allowed');
  expect(unsafeHtml(`<p title=a'b>'<img src=x onerror=alert(1)>'`)).toBe('the onerror attribute is not allowed');
  expect(unsafeHtml(`<p title = "a > b" class=intro>Hi</p></p>`)).toBeUndefined();
  expect(unsafeHtml(`<a href = 'javascript:alert(1)'>x</a>`)).toBe('javascript: links are not allowed');
  expect(unsafeHtml(`<a/href=javascript:alert(1)>x</a>`)).toBe('javascript: links are not allowed');
  expect(unsafeHtml(`<img src=/a.png/onerror=alert(1)>`)).toBeUndefined(); // one unquoted value, as a browser reads it
  expect(unsafeHtml('<p style="display:none">hidden link</p>')).toBe('the style attribute is not allowed');
  // Only tab, LF, FF, CR and space split a tag for a browser: U+00A0 / U+3000 stay inside the name or value.
  expect(unsafeHtml('<p\u00a0title="x onclick=alert(1) y">x</p>')).toBe('<p\u00a0title="x> is not allowed');
  expect(unsafeHtml('<p title=\u00a0"x onclick=alert(1) y">x</p>')).toBe('the onclick attribute is not allowed');
  expect(unsafeHtml('<img src=x\u3000onerror=alert(1)>')).toBeUndefined(); // one unquoted value, as a browser reads it
  expect(unsafeHtml('<p class="a"\tid=b\nalt=c>Hi</p>')).toBeUndefined();
  // A comment, doctype or bogus comment ends where a browser ends it, so what follows is markup even when it looks
  // like the inside of a quoted value; markup inside a comment is just comment.
  for (const start of ['<!--', '<!-- x --!', '<?', '</ ', '<!x', '<!DOCTYPE "']) {
    const end = start.startsWith('<!--') ? '-->' : '>';
    expect(unsafeHtml(`${start}<p title="${end}<img src=x onerror=alert(1)>">`)).toBe('the onerror attribute is not allowed');
  }
  expect(unsafeHtml('<!-- <script>x</script> --><p>ok</p><!--><!---><!---->')).toBeUndefined();
  expect(unsafeHtml('<a href="javascript:alert(1)">x</a>')).toBe('javascript: links are not allowed');
  expect(unsafeHtml('<a href=" jav&#x61;script&colon;alert(1)">x</a>')).toBe('javascript: links are not allowed');
  expect(unsafeHtml("<img src='data:image/svg+xml;base64,PHN2Zz4='>")).toBe('data: links are not allowed');
  // Browsers turn &Tab; / &NewLine; into whitespace the URL parser drops: java<tab>script: is still javascript:.
  expect(unsafeHtml('<a href="java&Tab;script:alert(1)">x</a>')).toBe('java&tab;script: links are not allowed');
  expect(unsafeHtml('<a href="java&NewLine;script&colon;alert(1)">x</a>')).toBe('java&newline;script: links are not allowed');
  expect(unsafeHtml('<a href="/collections/all?sort=a:z">All</a> <a href="tel:+15550100">Call</a>')).toBeUndefined();
  expect(unsafeHtml('<a href="mailto:hi@shop.com">Mail</a> <a href="#faq">FAQ</a>')).toBeUndefined();
});
