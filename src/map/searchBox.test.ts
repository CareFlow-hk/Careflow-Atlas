import { describe, expect, it } from 'vitest';
import { CLOSED, searchBox, showsNothing, type SearchBox } from './searchBox';

const fuMun = { id: 'als-1', name: '福滿大廈', address: '香港 · 中西區 · 第三街 56', lng: 114.14196, lat: 22.28554 };
const typed = (words: string): SearchBox => searchBox(CLOSED, { kind: 'typed', words });

describe('responses belong to the submitted search, not the current input', () => {
  it.each(['found', 'failed'] as const)('ignores a late %s after the input changes', kind => {
    const pending = searchBox(typed('不存在'), { kind: 'asked', requestId: 1 });
    const changed = searchBox(pending, { kind: 'typed', words: '第三街100號' });
    expect(changed.searching).toBe(false);
    const late = kind === 'found'
      ? searchBox(changed, { kind, requestId: 1, results: [] })
      : searchBox(changed, { kind, requestId: 1, message: '舊查詢逾時' });
    expect(late).toEqual(changed);
    expect(showsNothing(late)).toBe(false);
  });

  it('clears old choices and errors as soon as the person types', () => {
    const asked = searchBox(typed('福滿'), { kind: 'asked', requestId: 1 });
    const found = searchBox(asked, { kind: 'found', requestId: 1, results: [fuMun] });
    expect(searchBox(found, { kind: 'typed', words: '第三街' }).results).toEqual([]);
    const failed = searchBox(asked, { kind: 'failed', requestId: 1, message: '逾時' });
    expect(searchBox(failed, { kind: 'typed', words: '第三街' }).problem).toBeUndefined();
  });

  it('ignores an older request even after the same words are submitted again', () => {
    const first = searchBox(typed('福滿'), { kind: 'asked', requestId: 1 });
    const edited = searchBox(first, { kind: 'typed', words: '福滿' });
    const second = searchBox(edited, { kind: 'asked', requestId: 2 });
    expect(searchBox(second, { kind: 'found', requestId: 1, results: [] })).toEqual(second);
    expect(searchBox(second, { kind: 'failed', requestId: 1, message: '舊查詢逾時' })).toEqual(second);
    const found = searchBox(second, { kind: 'found', requestId: 2, results: [fuMun] });
    expect(found.results).toEqual([fuMun]);
    expect(found.searching).toBe(false);
  });

  it('does not reopen the result list after a result has been chosen', () => {
    const asked = searchBox(typed('福滿'), { kind: 'asked', requestId: 1 });
    const found = searchBox(asked, { kind: 'found', requestId: 1, results: [fuMun] });
    const chosen = searchBox(found, { kind: 'chosen' });
    expect(searchBox(chosen, { kind: 'found', requestId: 1, results: [] })).toEqual(chosen);
  });
});

describe('the search box under the add-building panel', () => {
  it('says nothing before a search has finished', () => {
    expect(showsNothing(CLOSED)).toBe(false);
    expect(showsNothing(searchBox(typed('福滿'), { kind: 'asked', requestId: 1 }))).toBe(false);
  });

  it('says 「找不到」 only when a finished search came back empty', () => {
    expect(showsNothing(searchBox(searchBox(typed('不存在'), { kind: 'asked', requestId: 1 }), { kind: 'found', requestId: 1, results: [] }))).toBe(true);
    expect(showsNothing(searchBox(searchBox(typed('福滿'), { kind: 'asked', requestId: 1 }), { kind: 'found', requestId: 1, results: [fuMun] }))).toBe(false);
  });

  it('stops saying 「找不到」 once a result is chosen', () => {
    // The reported bug: choosing a result emptied the list but left the empty-search flag up,
    // so the panel denied the building one line under the name it had just filled in.
    const empty = searchBox(searchBox(typed('福滿'), { kind: 'asked', requestId: 1 }), { kind: 'found', requestId: 1, results: [fuMun] });
    const chosen = searchBox(empty, { kind: 'chosen' });
    expect(chosen.results).toEqual([]);
    expect(showsNothing(chosen)).toBe(false);
  });

  it('stops saying 「找不到」 once the person types again', () => {
    const nothing = searchBox(searchBox(typed('不存在'), { kind: 'asked', requestId: 1 }), { kind: 'found', requestId: 1, results: [] });
    expect(showsNothing(searchBox(nothing, { kind: 'typed', words: '不存在的地方' }))).toBe(false);
  });

  it('reports a failure in its own words rather than as an empty list', () => {
    const failed = searchBox(searchBox(typed('福滿'), { kind: 'asked', requestId: 1 }), { kind: 'failed', requestId: 1, message: '地址服務回應逾時，請再試一次。' });
    expect(failed.problem).toBe('地址服務回應逾時，請再試一次。');
    expect(failed.searching).toBe(false);
    // A failure is not 「找不到」: the same silence would hide a broken service.
    expect(showsNothing(failed)).toBe(false);
  });

  it('is busy between asking and answering, and not before or after', () => {
    const asked = searchBox(typed('福滿'), { kind: 'asked', requestId: 1 });
    expect(asked.searching).toBe(true);
    expect(searchBox(asked, { kind: 'found', requestId: 1, results: [fuMun] }).searching).toBe(false);
    expect(searchBox(asked, { kind: 'failed', requestId: 1, message: 'x' }).searching).toBe(false);
  });
});
