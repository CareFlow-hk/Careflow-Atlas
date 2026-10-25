import { namedBuilding, type NamedBuilding } from '../domain/buildingMentions';
import { buildReminderAdvice, buildReminders, hkDay, type ReminderAdvice, type ReminderBook, type ReminderViewer } from '../domain/reminders';
import { getOpenFollowUps, type OutreachSnapshot } from '../domain/types';

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
/**
 * 「給我行動建議」 — a follow-up to a task answer that names no list. These words alone
 * are enough: they only ever produce a reading of the workspace's own open tasks.
 */
const ADVICE_QUESTION = /(行動建議|行动建议|行動計劃|行动计划|工作計劃|工作计划|怎麼安排|怎么安排|如何安排|點樣安排|点样安排|先做什麼|先做什么|先做甚麼|優先次序|优先次序|優先處理|优先处理|誰先做|谁先做|邊個做先|誰要做|谁要做|邊個要做|哪些人做|哪些人需要|哪些人要做|負責人要做|负责人要做|我要做什麼|我要做什麼|我要做甚麼|我要做咩|我有什麼要做|下一步|接下来|接下來)/;
/** A record note in disguise: 「什麼都未談好？」 is a statement about a visit. */
const NARRATION = /什麼都|什么都/;

export function isReminderQuestion(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 120) return false;
  if (NARRATION.test(value)) return false;
  if (ADVICE_QUESTION.test(value)) return true;
  return TASK.test(value) && ENQUIRY.test(value);
}

/** How the answer should be arranged: the plain list, or an order of work. */
export type ReminderIntent = 'list' | 'advice';

/** Words that ask for a sequence or a plan, not merely a list. */
const ADVICE = /(建議|建议|行動|行动|安排|優先|优先|先做|先處理|先处理|次序|怎麼做|怎么做|如何做|計劃|计划|分派|分配|誰要|谁要|誰做|谁做|邊個做|下一步|接下來|接下来)/;

export function readReminderIntent(text: string): ReminderIntent {
  return ADVICE.test(text) ? 'advice' : 'list';
}

/**
 * Whether this message is answered here rather than by a provider.
 *
 * A file always takes the provider route, even when the note beside it reads like a
 * question: 「在裕安樓增加以下記錄，還有什麼未完成？」 is a heading for the sheet, and
 * answering it as a task list would drop the sheet. `asReminder: false` is the person's
 * own override, 「這不是提醒，改為整理成記錄」.
 */
export function shouldAnswerReminder(text: string, options: { hasFile?: boolean; asReminder?: boolean } = {}): boolean {
  if (options.hasFile || options.asReminder === false) return false;
  return isReminderQuestion(text);
}

export interface ReminderQuestion {
  /** First calendar day asked about, as an offset from today. */
  from: number;
  /** Last calendar day asked about; `null` means every open task. */
  to: number | null;
  /** How the answer should open the question back to the person. */
  label: string;
  /** The words said which days they meant; without this, today is only the default. */
  stated: boolean;
  /** The words asked for every open task (所有／全部), which also lets go of an earlier narrowing. */
  everything: boolean;
}

/**
 * Which days the question is about. No date arithmetic beyond offsets: the caller
 * supplies "today" so the answer names the same day on every device.
 */
export function readReminderQuestion(text: string, today: string = hkDay()): ReminderQuestion {
  const value = text.trim();
  if (/(所有|全部|任何|唔限|不限)/.test(value)) return { from: 0, to: null, label: '所有未完成的跟進', stated: true, everything: true };

  const span = /(\d+)\s*(天|日|個星期|个星期|星期|週|周)/.exec(value);
  if (span) {
    const count = Number(span[1]);
    const days = /星期|週|周/.test(span[2]) ? count * 7 : count;
    if (days > 0) return { from: 0, to: days - 1, label: `未來 ${days} 天`, stated: true, everything: false };
  }

  if (/(這兩天|这两日|这两天|呢兩日|呢两日|呢兩天|呢两天|這幾日|这几日)/.test(value)) return { from: 0, to: 1, label: '這兩天', stated: true, everything: false };
  if (/(本週|本周|這週|这周|今個星期|今个星期|這個星期|这个星期)/.test(value)) {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const toSunday = (7 - weekday) % 7;
    return { from: 0, to: toSunday, label: toSunday === 0 ? '今天（這個星期最後一天）' : `這個星期（還有 ${toSunday + 1} 天）`, stated: true, everything: false };
  }
  if (/(明天|明日|聽日|听日)/.test(value)) return { from: 1, to: 1, label: '明天', stated: true, everything: false };
  if (/(後天|后天)/.test(value)) return { from: 2, to: 2, label: '後天', stated: true, everything: false };
  // Saying 今天 is not the same as saying nothing: it holds the answer to today.
  if (/(今天|今日|即日|當日)/.test(value)) return { from: 0, to: 0, label: '今天', stated: true, everything: false };
  return { from: 0, to: 0, label: '今天', stated: false, everything: false };
}

// Whitespace is not part of a name; the same normalisation the building rules use.
const normal = (text: string) => text.replace(/[\s\u3000·・]/g, '').toLowerCase();

/**
 * The open tasks' assignees whose full name the text contains.
 *
 * Exact names only, and longest first so 「陳大文（兼職）」 does not also match 「陳大文」
 * (`src/domain/reminders.ts`: a similar name is not the same person). A name the person
 * did not write is never matched, so nothing here can attribute work to someone else.
 */
export function assigneesNamedIn(snapshot: OutreachSnapshot, text: string): string[] {
  const haystack = normal(text);
  if (!haystack) return [];
  const names = [...new Set(getOpenFollowUps(snapshot).map(task => task.assignee?.trim()).filter((name): name is string => !!name))];
  const hits = names.filter(name => normal(name).length > 0 && haystack.includes(normal(name)));
  return hits.filter(name => !hits.some(other =>
    other !== name && normal(other) !== normal(name) && normal(other).includes(normal(name))));
}

/** Everything a question asks for: the days, and the building or person it narrowed to. */
export interface ReminderScope extends ReminderQuestion {
  building?: NamedBuilding;
  /** The one assignee the text names; absent when it names none or more than one. */
  assignee?: string;
  /** Names or people the text mentioned but that cannot be narrowed to one, said out loud. */
  ambiguous: string[];
}

/**
 * Reads a question against the workspace: which days, and — when the person wrote one —
 * which building or which owner. A name is only used when it appears literally and picks
 * out exactly one thing; two names in one sentence is not a choice the system may make.
 */
export function readReminderScope(snapshot: OutreachSnapshot, text: string, today: string = hkDay()): ReminderScope {
  const question = readReminderQuestion(text, today);
  const { building, names } = namedBuilding(snapshot.buildings, text);
  const people = assigneesNamedIn(snapshot, text);
  const assignee = people.length === 1 ? people[0] : undefined;
  /*
   * 「陳大文要做什麼？」 names a person but no day: the person is the narrowing, so it is
   * answered with all of their open work. Keeping the default 「今天」 there hid next
   * week's task without the question ever saying today (2026-10-25). A day the text does
   * name (「陳大文明天要做什麼？」) still wins over this.
   */
  const widened = !question.stated && !!(building || assignee) ? { to: null as number | null, label: '所有未完成的跟進' } : {};
  return {
    ...question,
    ...widened,
    building,
    assignee,
    ambiguous: [...names, ...(people.length > 1 ? people : [])],
  };
}

/**
 * What a message in the task screen is taken to mean. A follow-up there is a question, so
 * a bare 「明天呢？」 or a name the workspace knows is enough; it only ever produces a
 * reading of the workspace's own open tasks and never writes anything.
 */
export function looksLikeTaskFollowUp(snapshot: OutreachSnapshot, text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 120) return false;
  if (isReminderQuestion(value)) return true;
  if (assigneesNamedIn(snapshot, value).length > 0) return true;
  if (namedBuilding(snapshot.buildings, value).building) return true;
  // 「明天呢？」「今日嘅跟進」: a day word plus something that makes it a question.
  const day = /(今天|今日|明天|明日|聽日|听日|後天|后天|本週|本周|這兩天|这两日|所有|全部)/;
  return day.test(value) && /[?？]|呢|嗎|吗|什麼|什么|哪些|邊|哪|如何|點|怎么|怎麼/.test(value);
}

/** A narrowing of the previous question, kept while later questions name nobody new. */
export interface ReminderNarrow {
  buildingId?: string;
  assignee?: string;
}

export interface ReminderAnswerResult {
  book: ReminderBook;
  /** Present only when the question asked for an order of work rather than a list. */
  advice?: ReminderAdvice;
  scope: ReminderScope;
}

/**
 * The one reading every task question goes through, whether it was typed into the box or
 * asked again inside the answer.
 *
 * `keep` carries the narrowing of the question before it, so 「陳大文要做什麼？」 followed by
 * 「明天呢？」 still asks about 陳大文. A question that names a building or a person always
 * wins over what was kept; naming nobody keeps the previous narrowing rather than quietly
 * widening the list.
 */
export function reminderAnswer(
  snapshot: OutreachSnapshot,
  text: string,
  options: { viewer?: ReminderViewer; now?: Date | string; keep?: ReminderNarrow } = {},
): ReminderAnswerResult {
  const scope = readReminderScope(snapshot, text, options.now === undefined ? hkDay() : hkDay(options.now));
  const intent = readReminderIntent(text);
  /*
   * An order of work is advice about the whole backlog, not about one day: with no day
   * named, the steps 「今天先做」／「明天」／「之後」 need every open task to be filled in.
   * Reading only today gave an advice view whose later steps could never appear.
   */
  const wantsAll = intent === 'advice' && !scope.stated;
  /* 「所有未完成的跟進」 is a question about everything: it lets go of the narrowing kept
   * from the question before it, which would otherwise still hide the rest. */
  const keep = scope.everything ? undefined : options.keep;
  const book = buildReminders(snapshot, {
    now: options.now,
    viewer: options.viewer,
    from: wantsAll ? 0 : scope.from,
    to: wantsAll ? null : scope.to,
    buildingId: scope.building?.id ?? keep?.buildingId,
    assignee: scope.assignee ?? keep?.assignee,
  });
  return { book, advice: intent === 'advice' ? buildReminderAdvice(book) : undefined, scope };
}

/**
 * The list a question gets, from the words alone. Kept for callers that only need the
 * book; `reminderAnswer` is the same reading and is what the dialog uses.
 */
export function reminderBook(snapshot: OutreachSnapshot, text: string, viewer?: ReminderViewer, now?: Date | string): ReminderBook {
  return reminderAnswer(snapshot, text, { viewer, now }).book;
}
