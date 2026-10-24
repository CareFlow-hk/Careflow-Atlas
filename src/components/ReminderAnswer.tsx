import { AlertTriangle, ChevronRight } from 'lucide-react';
import { addDays, reminderBucketLabels, reminderBuckets, type ReminderBook, type ReminderTask } from '../domain/reminders';

/**
 * The reminder answer itself, shared by the reminder dialog and the assistant.
 *
 * It reports what the workspace records and nothing more: the date each task carries, who
 * it is assigned to, and — when there is none — that the date is missing. A `timingNote`
 * is quoted as 原話 and never presented as a deadline (`CLAUDE.md` 4).
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

function whenText(task: ReminderTask): string {
  if (task.dueDate === undefined) return '未填確定日期';
  if (task.bucket === 'TODAY') return '今天到期';
  if (task.daysAway !== undefined && task.daysAway < 0) return `到期 ${monthDay(task.dueDate)}（已逾期 ${-task.daysAway} 天）`;
  return `到期 ${monthDay(task.dueDate)}${task.daysAway === 1 ? '（明天）' : ''}`;
}

export function ReminderAnswer({ book, onOpenTask }: { book: ReminderBook; onOpenTask?: (task: ReminderTask) => void }) {
  const total = book.tasks.length;
  const counted = reminderBuckets
    .filter(bucket => book.counts[bucket] > 0)
    .map(bucket => `${reminderBucketLabels[bucket]} ${book.counts[bucket]} 項`)
    .join('、');
  const opening = book.to === null ? `${rangeText(book)}共 ${total} 項` : `${rangeText(book)}有 ${total} 項未完成跟進`;
  const hiddenTotal = book.hidden.others + book.hidden.unassigned;

  return <section className="cf-reminder">
    <p className="cf-reminder__summary" role="status">
      {total ? <><strong>{opening}</strong>{counted ? `：${counted}。` : '。'}</> : <><strong>{rangeText(book)}沒有{book.ownOnly ? '指派給你的' : ''}未完成跟進。</strong></>}
    </p>
    {total > 0 && book.ownOnly && <p className="cf-reminder__note">只列出指派給你的任務。</p>}

    {reminderBuckets.map(bucket => {
      const tasks = book.tasks.filter(task => task.bucket === bucket);
      if (!tasks.length) return null;
      return <div className="cf-reminder__group" key={bucket}>
        <h4>{reminderBucketLabels[bucket]}<span>{tasks.length}</span></h4>
        <ul>{tasks.map(task => <li key={task.observationId} className={`cf-reminder__task is-${bucket.toLowerCase()}`}>
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
        </li>)}</ul>
      </div>;
    })}

    {hiddenTotal > 0 && <p className="cf-reminder__hidden">
      <AlertTriangle size={14} />另有 {book.hidden.others} 項指派給其他同事、{book.hidden.unassigned} 項未填負責人。員工帳號只回覆自己的任務；管理員可以看到全部。
    </p>}
  </section>;
}
