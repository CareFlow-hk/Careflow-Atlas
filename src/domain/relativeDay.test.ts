import { describe, expect, it } from 'vitest';
import { resolveRelativeDay } from './relativeDay';

// 2026-10-24 is a Saturday, so the following Monday is 10-26 and that week's Wednesday
// is 10-28. Every case below is pinned to this one day rather than to "now".
const today = '2026-10-24';
const days = (text: string) => [...resolveRelativeDay(text, today)].sort();

describe('the days a note names relatively', () => {
  it('translates the ordinary day words, including the Cantonese spellings', () => {
    expect(days('今日去咗 3樓')).toEqual(['2026-10-24']);
    expect(days('今天去咗 3樓')).toEqual(['2026-10-24']);
    expect(days('尋日去咗 3樓')).toEqual(['2026-10-23']);
    expect(days('琴日去咗 3樓')).toEqual(['2026-10-23']);
    expect(days('聽日去 3樓')).toEqual(['2026-10-25']);
    expect(days('後日去 3樓')).toEqual(['2026-10-26']);
    expect(days('前日去 3樓')).toEqual(['2026-10-22']);
  });

  it('reads a longer word as itself, not as the word inside it', () => {
    // 「大後日」 must not also count as 「後日」, or a reply could name two days.
    expect(days('大後日去 3樓')).toEqual(['2026-10-27']);
    expect(days('大前日去 3樓')).toEqual(['2026-10-21']);
  });

  it('reads a named weekday in next week, counting Monday as the first day', () => {
    expect(days('下星期三再嚟')).toEqual(['2026-10-28']);
    expect(days('下個星期一再嚟')).toEqual(['2026-10-26']);
    expect(days('下星期四再嚟')).toEqual(['2026-10-29']);
    expect(days('下星期日再嚟')).toEqual(['2026-11-01']);
    expect(days('下週三再嚟')).toEqual(['2026-10-28']);
  });

  it('reads a named weekday in this week only when the note says so', () => {
    expect(days('今個星期三去過')).toEqual(['2026-10-21']);
  });

  it('says nothing for a bare weekday, because this week or next is a guess', () => {
    expect(days('星期三再嚟')).toEqual([]);
    expect(days('3樓 A 室無人應門')).toEqual([]);
    expect(days('')).toEqual([]);
  });

  it('returns several days when the note names several', () => {
    expect(days('今日去過，下星期三再嚟')).toEqual(['2026-10-24', '2026-10-28']);
  });
});
