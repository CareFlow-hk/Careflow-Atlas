import { addDays } from './reminders';

/**
 * The calendar dates a note's *relative* day words can mean, given the device's Hong Kong
 * date (`CLAUDE.md` 4, revised 2026-10-24).
 *
 * The rule this replaces said a date had to appear in the note digit for digit, so
 * 「今日去咗…」 and 「下星期三再嚟」 could never fill a date and the person had to retype
 * what they had just said. The rule now draws the line somewhere else, and this module is
 * that line:
 *
 * - a **stated** relative day is translated, not invented — 「今日」 means the day the note
 *   was written, 「下星期三」 means the Wednesday of the following week;
 * - a day the note does not mention is still never produced: this function only answers
 *   "which dates does this text actually name", and the contract refuses anything else;
 * - the writing is kept closed. Only the words below count; a bare 「星期三」 does not,
 *   because whether it means this week or next is exactly the kind of guess that
 *   `CLAUDE.md` 4 forbids, and the person can say 「下星期三」 instead.
 *
 * The list is deliberately short and bilingual-safe (Traditional, Simplified and the
 * Cantonese forms that appear in paper notes). Adding a word is a behaviour change and
 * needs its own test.
 */

/** Longer alternatives first: 「大後日」 must win over 「後日」, 「大前日」 over 「前日」. */
const RELATIVE = /大後日|大後天|大前天|大前日|後日|後天|后天|聽日|聽天|明日|明天|今日|今天|今晚|今朝|今早|尋日|昨日|琴日|昨天|前日|前天/g;

const OFFSET: Record<string, number> = {
  大後日: 3, 大後天: 3,
  後日: 2, 後天: 2, 后天: 2,
  聽日: 1, 聽天: 1, 明日: 1, 明天: 1,
  今日: 0, 今天: 0, 今晚: 0, 今朝: 0, 今早: 0,
  尋日: -1, 昨日: -1, 琴日: -1, 昨天: -1,
  前日: -2, 前天: -2,
  大前日: -3, 大前天: -3,
};

/** 「下星期三」「下個禮拜日」「下週三」 — the following ISO week's named day. */
const NEXT_WEEK = /下(?:個)?(?:星期|禮拜|礼拜|週|周)([一二三四五六日天])/g;
/** 「今個星期三」「今週三」 — this ISO week's named day. */
const THIS_WEEK = /(?:今個|今)(?:星期|禮拜|礼拜|週|周)([一二三四五六日天])/g;

const WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

/** ISO weekday: Monday is 1, Sunday is 7. */
function isoWeekday(day: string): number {
  const value = new Date(`${day}T00:00:00Z`).getUTCDay();
  return value === 0 ? 7 : value;
}

/** Monday of the week after the one holding `day`. */
const nextMonday = (day: string) => addDays(day, 8 - isoWeekday(day));

/**
 * Every concrete date `text` names through a relative word, as `YYYY-MM-DD`.
 *
 * Returns an empty set when the text names none — the caller must then refuse any date
 * the reply proposes rather than treat "no relative word" as permission.
 */
export function resolveRelativeDay(text: string, today: string): Set<string> {
  const days = new Set<string>();
  for (const match of text.matchAll(RELATIVE)) {
    const offset = OFFSET[match[0]];
    if (offset !== undefined) days.add(addDays(today, offset));
  }
  for (const match of text.matchAll(THIS_WEEK)) {
    const weekday = WEEKDAY[match[1]];
    if (weekday !== undefined) days.add(addDays(today, weekday - isoWeekday(today)));
  }
  for (const match of text.matchAll(NEXT_WEEK)) {
    const weekday = WEEKDAY[match[1]];
    if (weekday !== undefined) days.add(addDays(nextMonday(today), weekday - 1));
  }
  return days;
}
