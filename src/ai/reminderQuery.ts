import { hkDay } from '../domain/reminders';

/**
 * Recognises the one kind of message the assistant answers from the workspace itself
 * instead of a provider: a question about open follow-up work.
 *
 * The answer costs nothing and sends nothing: follow-up text is encrypted on this device,
 * and it stays there. That is also why this path runs even when no AI key is available —
 * turning the assistant off must not take away the person's own task list.
 *
 * The test is deliberately narrow. A note that merely mentions follow-up work is not a
 * question; a question the test misses falls back to an ordinary draft, and one it
 * catches by mistake can be sent back with 「改為整理成記錄」.
 */

/** 「還有什麼跟進？」 — the words that make the message a question about tasks. */
const TASK = /(跟進|跟进|待辦|待办|任務|任务|提醒|未完成|未處理|未处理)/;
/** Words that ask for a list, or a bare question mark. */
const ENQUIRY = /[?？]|嗎|吗|呢|哪些|哪幾|哪几|多少|幾項|几项|幾件|几件|幾單|几单|列出|清單|清单|列表|什麼|什么|有沒有|有没有|有冇|仲有|還有|还有/;
/** A record note in disguise: 「什麼都未談好？」 is a statement about a visit. */
const NARRATION = /什麼都|什么都/;

export function isReminderQuestion(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 120) return false;
  if (!TASK.test(value) || NARRATION.test(value)) return false;
  return ENQUIRY.test(value);
}

export interface ReminderQuestion {
  /** First calendar day asked about, as an offset from today. */
  from: number;
  /** Last calendar day asked about; `null` means every open task. */
  to: number | null;
  /** How the answer should open the question back to the person. */
  label: string;
}

/**
 * Which days the question is about. No date arithmetic beyond offsets: the caller
 * supplies "today" so the answer names the same day on every device.
 */
export function readReminderQuestion(text: string, today: string = hkDay()): ReminderQuestion {
  const value = text.trim();
  if (/(所有|全部|任何|唔限|不限)/.test(value)) return { from: 0, to: null, label: '所有未完成的跟進' };

  const span = /(\d+)\s*(天|日|個星期|个星期|星期|週|周)/.exec(value);
  if (span) {
    const count = Number(span[1]);
    const days = /星期|週|周/.test(span[2]) ? count * 7 : count;
    if (days > 0) return { from: 0, to: days - 1, label: `未來 ${days} 天` };
  }

  if (/(本週|本周|這週|这周|今個星期|今个星期|這個星期|这个星期)/.test(value)) {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const toSunday = (7 - weekday) % 7;
    return { from: 0, to: toSunday, label: toSunday === 0 ? '今天（這個星期最後一天）' : `這個星期（還有 ${toSunday + 1} 天）` };
  }
  if (/(明天|明日|聽日|听日)/.test(value)) return { from: 1, to: 1, label: '明天' };
  if (/(後天|后天)/.test(value)) return { from: 2, to: 2, label: '後天' };
  return { from: 0, to: 0, label: '今天' };
}
