import { describe, expect, it } from 'vitest';
import { isReminderQuestion, readReminderQuestion } from './reminderQuery';

/*
 * Only an actual question is answered from the workspace. A visit note that mentions
 * 跟進 must still be read as a note, or the person's words would be swallowed by a list
 * they did not ask for.
 */
describe('which messages are task questions', () => {
  it('recognises the question people actually type', () => {
    expect(isReminderQuestion('今天還有什麼未完成的跟進任務嗎？')).toBe(true);
    expect(isReminderQuestion('有什么跟进要做')).toBe(true);
    expect(isReminderQuestion('有哪些任務未完成？')).toBe(true);
    expect(isReminderQuestion('待跟進的清單')).toBe(true);
  });

  it('leaves a visit note alone', () => {
    expect(isReminderQuestion('10月9日，3樓 A 室拍門無人應門，下星期再跟進。')).toBe(false);
    expect(isReminderQuestion('下週再跟進，什麼都未談好？')).toBe(false);
    expect(isReminderQuestion('今天拍門無人應門')).toBe(false);
  });
});

describe('which days the question is about', () => {
  const today = '2026-10-24'; // a Saturday

  it('defaults to today', () => {
    expect(readReminderQuestion('今天還有什麼未完成的跟進嗎？', today)).toEqual({ from: 0, to: 0, label: '今天' });
    expect(readReminderQuestion('有沒有未完成的跟進？', today)).toEqual({ from: 0, to: 0, label: '今天' });
  });

  it('reads tomorrow and the day after as single days', () => {
    expect(readReminderQuestion('明天要跟進什麼？', today)).toEqual({ from: 1, to: 1, label: '明天' });
    expect(readReminderQuestion('後天有什麼任務？', today)).toEqual({ from: 2, to: 2, label: '後天' });
  });

  it('reads a number of days as today onwards', () => {
    expect(readReminderQuestion('未來 7 天有什麼跟進？', today)).toEqual({ from: 0, to: 6, label: '未來 7 天' });
    expect(readReminderQuestion('未來 2 星期的跟進', today)).toEqual({ from: 0, to: 13, label: '未來 14 天' });
  });

  it('reads 本週 as up to Sunday, without counting the next week', () => {
    expect(readReminderQuestion('本週有哪些跟進？', today)).toEqual({ from: 0, to: 1, label: '這個星期（還有 2 天）' });
    expect(readReminderQuestion('本週有哪些跟進？', '2026-10-20')).toEqual({ from: 0, to: 5, label: '這個星期（還有 6 天）' });
    // Sunday is the last day of the week, so nothing is left after it.
    expect(readReminderQuestion('本週有哪些跟進？', '2026-10-25')).toEqual({ from: 0, to: 0, label: '今天（這個星期最後一天）' });
  });

  it('reads 「全部」 as no upper bound', () => {
    expect(readReminderQuestion('所有未完成的跟進', today)).toEqual({ from: 0, to: null, label: '所有未完成的跟進' });
  });
});
