import { describe, expect, it } from 'vitest';
import { CLOSED, searchBox, showsNothing, type SearchBox } from './searchBox';

const fuMun = { id: 'als-1', name: '福滿大廈', address: '香港 · 中西區 · 第三街 56', lng: 114.14196, lat: 22.28554 };
const typed = (words: string): SearchBox => searchBox(CLOSED, { kind: 'typed', words });

describe('the search box under the add-building panel', () => {
  it('says nothing before a search has finished', () => {
    expect(showsNothing(CLOSED)).toBe(false);
    expect(showsNothing(searchBox(typed('福滿'), { kind: 'asked' }))).toBe(false);
  });

  it('says 「找不到」 only when a finished search came back empty', () => {
    expect(showsNothing(searchBox(searchBox(typed('不存在'), { kind: 'asked' }), { kind: 'found', results: [] }))).toBe(true);
    expect(showsNothing(searchBox(searchBox(typed('福滿'), { kind: 'asked' }), { kind: 'found', results: [fuMun] }))).toBe(false);
  });

  it('stops saying 「找不到」 once a result is chosen', () => {
    // The reported bug: choosing a result emptied the list but left the empty-search flag up,
    // so the panel denied the building one line under the name it had just filled in.
    const empty = searchBox(searchBox(typed('福滿'), { kind: 'asked' }), { kind: 'found', results: [fuMun] });
    const chosen = searchBox(empty, { kind: 'chosen' });
    expect(chosen.results).toEqual([]);
    expect(showsNothing(chosen)).toBe(false);
  });

  it('stops saying 「找不到」 once the person types again', () => {
    const nothing = searchBox(searchBox(typed('不存在'), { kind: 'asked' }), { kind: 'found', results: [] });
    expect(showsNothing(searchBox(nothing, { kind: 'typed', words: '不存在的地方' }))).toBe(false);
  });

  it('reports a failure in its own words rather than as an empty list', () => {
    const failed = searchBox(searchBox(typed('福滿'), { kind: 'asked' }), { kind: 'failed', message: '地址服務回應逾時，請再試一次。' });
    expect(failed.problem).toBe('地址服務回應逾時，請再試一次。');
    expect(failed.searching).toBe(false);
    // A failure is not 「找不到」: the same silence would hide a broken service.
    expect(showsNothing(failed)).toBe(false);
  });

  it('is busy between asking and answering, and not before or after', () => {
    const asked = searchBox(typed('福滿'), { kind: 'asked' });
    expect(asked.searching).toBe(true);
    expect(searchBox(asked, { kind: 'found', results: [fuMun] }).searching).toBe(false);
    expect(searchBox(asked, { kind: 'failed', message: 'x' }).searching).toBe(false);
  });
});
