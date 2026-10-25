import type { ReactNode } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { addDays, reminderBucketLabels, reminderBuckets, reminderBuildings, type ReminderAdvice, type ReminderAdviceOwner, type ReminderBook, type ReminderTask } from '../domain/reminders';

/**
 * The reminder answer itself, shared by the assistant's task answer and its advice view.
 *
 * The screen opens with the概况 — how many are overdue, how many are due today — and each
 * group starts folded, so a long list never fills the box before the person has decided
 * what to look at. Every group opens on one click.
 *
 * It reports what the workspace records and nothing more: the date each task carries, who
 * it is assigned to, and — when there is none — that the date is missing. A `timingNote`
 * is quoted as 原話 and never presented as a deadline (`CLAUDE.md` 4).
 *
 * The advice view is the same facts in the order of work, grouped by the person the record
 * names. It is not written by a model: the order comes from the due dates the records
 * already carry, so nothing here can invent a date or hand unassigned work to someone.
 */

const monthDay = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

const relativeDay = (offset: number) => offset === 0 ? '今天' : offset === 1 ? '明天' : offset === 2 ? '後天' : `${offset} 天後`;

function rangeText(book: ReminderBook): string {
  if (book.to === null) return '所有未完成的跟進';
  const first = addDays(book.today, book.from);
  const last = addDays(book.today, book.to);
  if (book.from === book.to) return `${relativeDay(book.from)}（${monthDay(first)}）`;
  if (book.from === 0) return `未來 ${book.to + 1} 天（${monthDay(first)}至${monthDay(last)}）`;
  return `${relativeDay(book.from)}至${monthDay(last)}`;
}

/** The days, and what the question narrowed the list to, said before the numbers. */
function headingText(book: ReminderBook): string {
  const narrowed = [book.buildingName, book.assignee].filter(Boolean).join(' · ');
  const range = rangeText(book);
  return narrowed ? `${narrowed}：${range}` : range;
}

function whenText(task: ReminderTask): string {
  if (task.dueDate === undefined) return '未填確定日期';
  if (task.bucket === 'TODAY') return '今天到期';
  if (task.daysAway !== undefined && task.daysAway < 0) return `到期 ${monthDay(task.dueDate)}（已逾期 ${-task.daysAway} 天）`;
  return `到期 ${monthDay(task.dueDate)}${task.daysAway === 1 ? '（明天）' : ''}`;
}

function TaskItem({ task, book, onOpenTask }: { task: ReminderTask; book: ReminderBook; onOpenTask?: (task: ReminderTask) => void }) {
  return <li className={`cf-reminder__task is-${task.bucket.toLowerCase()}`}>
    <div className="cf-reminder__where">
      <strong>{task.buildingName}{task.place ? ` · ${task.place}` : ''}</strong>
      <p>{task.action}</p>
    </div>
    <div className="cf-reminder__meta">
      <span>{whenText(task)}</span>
      {task.assignee
        ? <span className="cf-reminder__who">{book.ownOnly ? '指派給你' : `指派給 ${task.assignee}`}</span>
        : <span className="cf-reminder__who is-none">未填負責人</span>}
      {onOpenTask && <button type="button" className="cf-reminder__open" onClick={() => onOpenTask(task)}>查看<ChevronRight size={13} /></button>}
    </div>
    {task.timingNote && <small className="cf-reminder__spoken">時間原話：「{task.timingNote}」沒有換算成日期。</small>}
  </li>;
}

/** The overview: the numbers first, so the list itself can stay folded. */
function Overview({ book, tasks, extra }: { book: ReminderBook; tasks: readonly ReminderTask[]; extra?: string }) {
  const total = tasks.length;
  return <section className="cf-reminder__overview">
    <p className="cf-reminder__headline" role="status">
      {total
        ? <><strong>{headingText(book)}有 {total} 項未完成</strong>{extra ? `，${extra}` : '。'}</>
        : <><strong>{headingText(book)}沒有{book.ownOnly ? '指派給你的' : ''}未完成跟進。</strong></>}
    </p>
    {total > 0 && <ul className="cf-reminder__stats">
      {reminderBuckets.map(bucket => {
        const count = tasks.filter(task => task.bucket === bucket).length;
        return count > 0 && <li key={bucket} className={`is-${bucket.toLowerCase()}`}>
          <strong>{count}</strong><span>{reminderBucketLabels[bucket]}</span>
        </li>;
      })}
    </ul>}
  </section>;
}

function BuildingsLine({ buildings }: { buildings: readonly { name: string; count: number }[] }) {
  if (!buildings.length) return null;
  return <p className="cf-reminder__note">涉及 {buildings.length} 幢大廈：{buildings.map(item => `${item.name} ${item.count} 項`).join('、')}。</p>;
}

function HiddenLine({ book }: { book: ReminderBook }) {
  const hiddenTotal = book.hidden.others + book.hidden.unassigned;
  if (!hiddenTotal) return null;
  return <p className="cf-reminder__hidden">
    <AlertTriangle size={14} />另有 {book.hidden.others} 項指派給其他同事、{book.hidden.unassigned} 項未填負責人。員工帳號只回覆自己的任務；管理員可以看到全部。
  </p>;
}

/**
 * One folded group. Native `<details>` so it opens with a click or the keyboard, and its
 * content is still in the page for a screen reader once opened.
 */
function FoldedGroup({ title, count, hint, children }: { title: string; count: number; hint?: string; children: ReactNode }) {
  return <details className="cf-reminder__group">
    <summary>
      <span className="cf-reminder__group-name">{title}</span>
      {hint && <span className="cf-reminder__group-hint">{hint}</span>}
      <b>{count}</b>
    </summary>
    {children}
  </details>;
}

export function ReminderAnswer({ book, onOpenTask }: { book: ReminderBook; onOpenTask?: (task: ReminderTask) => void }) {
  const total = book.tasks.length;
  const buildings = reminderBuildings(book.tasks);

  return <div className="cf-reminder">
    <Overview book={book} tasks={book.tasks} />
    {total > 0 && <>
      <BuildingsLine buildings={buildings} />
      {book.ownOnly && <p className="cf-reminder__note">只列出指派給你的任務。點一下分類展開。</p>}
      {reminderBuckets.map(bucket => {
        const tasks = book.tasks.filter(task => task.bucket === bucket);
        if (!tasks.length) return null;
        return <FoldedGroup key={bucket} title={reminderBucketLabels[bucket]} count={tasks.length}>
          <ul>{tasks.map(task => <TaskItem key={task.observationId} task={task} book={book} onOpenTask={onOpenTask} />)}</ul>
        </FoldedGroup>;
      })}
    </>}

    <HiddenLine book={book} />
  </div>;
}

function OwnerSteps({ owner, book, onOpenTask }: { owner: ReminderAdviceOwner; book: ReminderBook; onOpenTask?: (task: ReminderTask) => void }) {
  return <>
    {owner.steps.map(step => <div className="cf-reminder__step" key={step.label}>
      <h5>{step.label}<span>{step.tasks.length}</span></h5>
      <ul>{step.tasks.map(task => <TaskItem key={task.observationId} task={task} book={book} onOpenTask={onOpenTask} />)}</ul>
    </div>)}
  </>;
}

/**
 * The same list as an order of work: one folded group per person the records name, each
 * opened into 「今天先做 → 明天 → 之後 → 未排期」. An employee sees only their own sequence;
 * an administrator sees every owner. Tasks nobody owns are listed apart and said out loud,
 * because the system does not assign work.
 */
export function ReminderAdviceView({ book, advice, onOpenTask }: { book: ReminderBook; advice: ReminderAdvice; onOpenTask?: (task: ReminderTask) => void }) {
  const total = advice.total;
  const own = book.ownOnly ? advice.owners[0] : undefined;
  const extra = advice.owners.length ? `分屬 ${advice.owners.length} 位負責人` : undefined;

  return <div className="cf-reminder cf-reminder--advice">
    <Overview book={book} tasks={book.tasks} extra={extra} />
    {total > 0 && <>
      <BuildingsLine buildings={advice.buildings} />
      <p className="cf-reminder__note">先後次序只看記錄上的到期日：已逾期或今天到期的最先，然後是明天、之後；未填日期的留在「未排期」，不會被排到某一天。這份次序在這部裝置排出，沒有送交 AI。點一下負責人展開。</p>

      {own
        ? <FoldedGroup title="你的次序" count={own.total}>
          <OwnerSteps owner={own} book={book} onOpenTask={onOpenTask} />
        </FoldedGroup>
        : advice.owners.map(owner => <FoldedGroup key={owner.assignee} title={owner.name} count={owner.total}>
          <OwnerSteps owner={owner} book={book} onOpenTask={onOpenTask} />
        </FoldedGroup>)}

      {advice.unassigned.length > 0 && <FoldedGroup title="未填負責人" count={advice.unassigned.length} hint="系統不會替你分派">
        <p className="cf-reminder__note">這些任務沒有指定負責人，系統不會替你分派給任何人。</p>
        <ul>{advice.unassigned.map(task => <TaskItem key={task.observationId} task={task} book={book} onOpenTask={onOpenTask} />)}</ul>
      </FoldedGroup>}
    </>}

    <HiddenLine book={book} />
  </div>;
}
