import { describe, expect, it } from 'vitest';
import { viewOf, webHref, withParams, wsFrom } from './url';

const p = (s: string) => new URLSearchParams(s);

describe('the Knowledge page URL', () => {
  it('opens the artboard by default, and a legacy ?tab= or ?doc= link on the Library', () => {
    expect(viewOf(p(''))).toBe('artboard');
    expect(viewOf(p('view=relationships'))).toBe('relationships');
    expect(viewOf(p('view=nope'))).toBe('artboard');
    expect(viewOf(p('tab=memory'))).toBe('library');
    expect(viewOf(p('doc=ad_strategist'))).toBe('library');
    expect(viewOf(p('view=research&tab=memory'))).toBe('research');
  });

  it('takes ?ws= when it names General or a store, else the one store picked in the store filter, else General', () => {
    const stores = ['peak', 'zen'];
    expect(wsFrom(p('ws=zen'), 'artboard', stores, [])).toBe('zen');
    expect(wsFrom(p('ws=general'), 'artboard', stores, ['peak'])).toBe('general');
    expect(wsFrom(p('ws=gone'), 'artboard', stores, ['peak'])).toBe('peak');
    expect(wsFrom(p(''), 'artboard', stores, ['peak', 'zen'])).toBe('general');
    expect(wsFrom(p(''), 'artboard', stores, [])).toBe('general');
    // "All workspaces" is for the Research Center and the Library (search), not a board.
    expect(wsFrom(p('ws=all'), 'research', stores, [])).toBe('all');
    expect(wsFrom(p('ws=all'), 'library', stores, [])).toBe('all');
    expect(wsFrom(p('ws=all'), 'artboard', stores, [])).toBe('general');
    expect(wsFrom(p('ws=all'), 'relationships', stores, [])).toBe('general');
    // Stores still loading: trust the link.
    expect(wsFrom(p('ws=zen'), 'artboard', undefined, [])).toBe('zen');
  });

  it('changes some keys and keeps the rest', () => {
    expect(withParams(p('view=library&tab=memory&doc=x'), { tab: undefined, doc: 'y' }).toString()).toBe('view=library&doc=y');
  });

  it("links a source only to a web address: an agent's page could name anything", () => {
    expect(webHref('https://a.test/x')).toBe('https://a.test/x');
    expect(webHref('HTTP://a.test')).toBe('HTTP://a.test');
    expect(webHref('javascript:alert(1)')).toBeUndefined();
    expect(webHref(' javascript:alert(1)')).toBeUndefined();
    expect(webHref('file:///C:/Windows/notepad.exe')).toBeUndefined();
    expect(webHref('upload:/brief.pdf')).toBeUndefined();
    expect(webHref(undefined)).toBeUndefined();
  });
});
