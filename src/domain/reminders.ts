import { getOpenFollowUps, type OutreachSnapshot, type SupportCategory } from './types';

/**
 * Open follow-up tasks, read locally so a reminder answer never needs the network
 * (`docs/AI_ASSISTANT.md` 8).
 *
 * Follow-up text and due dates are encrypted before they reach the server, so a reminder
 * computed there would mean decrypting them there — which is the promise we do not break.
 * This module is browser-free and calls nothing but `getOpenFollowUps`, which already
 * reads effective records: a withdrawn task or one a later record resolved is not open.
 *
 * Two rules decide what looks like a deadline:
 * - only `dueDate` is a deadline; an empty one is 未排期, never inferred from `timingNote`
 *   (`CLAUDE.md` 4 缺失就是缺失), and `timingNote` is only ever quoted as 原話;
 * - an employee sees the tasks assigned to them by exact name. Tasks assigned to someone
 *   else, or to nobody, are counted and said out loud, never quietly attributed to them.
 */

export type ReminderBucket = 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'LATER' | 'UNSCHEDULED';

/** Display order: the most urgent first, undated last. */
export const reminderBuckets: readonly ReminderBucket[] = ['OVERDUE', 'TODAY', 'UPCOMING', 'LATER', 'UNSCHEDULED'];

export const reminderBucketLabels: Record<ReminderBucket, string> = {
  OVERDUE: '已逾期',
  TODAY: '今天到期',
  UPCOMING: '即將到期',
  LATER: '之後到期',
  UNSCHEDULED: '未排期',
};

/** How many days ahead count as 即將到期, unless the person asked for another window. */
export const DEFAULT_REMINDER_WINDOW = 3;

export interface ReminderTask {
  observationId: string;
  buildingId: string;
  /** The building's name now, or a plain note when it is no longer in the workspace. */
  buildingName: string;
  floorId?: string;
  floorLabel?: string;
  unitId?: string;
  /** The unit or floor label as the workspace writes it. Absent for a whole-building task. */
  place?: string;
  action: string;
  category?: SupportCategory;
  assignee?: string;
  /** The original words about timing. Quoted, never read as a date. */
  timingNote?: string;
  dueDate?: string;
  /** Whole days from today to `dueDate`; negative when overdue. Absent when unscheduled. */
  daysAway?: number;
  bucket: ReminderBucket;
}

export interface ReminderViewer {
  name: string;
  /** `MEMBER` sees only their own tasks; an admin or a demo session sees every open task. */
  role?: 'ADMIN' | 'MEMBER';
}

export interface ReminderOptions {
  /** The moment "today" is read at; Hong Kong time decides the calendar day. */
  now?: Date | string;
  viewer?: ReminderViewer;
  /** Days from today that still count as 即將到期. */
  windowDays?: number;
  /** First calendar day asked about, as an offset from today. 0 = today. */
  from?: number;
  /** Last calendar day asked about; `null` means no upper bound. */
  to?: number | null;
}

export interface ReminderBook {
  today: string;
  windowDays: number;
  from: number;
  to: number | null;
  tasks: ReminderTask[];
  counts: Record<ReminderBucket, number>;
  /** Open tasks this viewer may not see, counted rather than dropped in silence. */
  hidden: { others: number; unassigned: number };
  /** True when the list was narrowed to the signed-in employee. */
  ownOnly: boolean;
  /** Listed tasks that name the viewer. */
  mine: number;
}

const DAY = 86_400_000;

/** The Hong Kong calendar day of a moment, as `YYYY-MM-DD`. */
export function hkDay(now: Date | string = new Date()): string {
  const date = typeof now === 'string' ? new Date(now) : now;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Calendar days from one `YYYY-MM-DD` to another; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

export function buildReminders(snapshot: OutreachSnapshot, options: ReminderOptions = {}): ReminderBook {
  const today = hkDay(options.now ?? new Date());
  const windowDays = Math.max(1, Math.floor(options.windowDays ?? DEFAULT_REMINDER_WINDOW));
  const from = Math.floor(options.from ?? 0);
  const to = options.to === null ? null : Math.max(from, Math.floor(options.to ?? from));
  const viewer = options.viewer;
  const ownOnly = viewer?.role === 'MEMBER';
  const viewerName = viewer?.name.trim() ?? '';

  const buildings = new Map(snapshot.buildings.map(building => [building.id, building]));
  const floors = new Map(snapshot.floors.map(floor => [floor.id, floor]));
  const units = new Map(snapshot.units.map(unit => [unit.id, unit]));

  const hidden = { others: 0, unassigned: 0 };
  const tasks: ReminderTask[] = [];

  for (const task of getOpenFollowUps(snapshot)) {
    const assignee = task.assignee?.trim() || undefined;
    if (ownOnly && assignee !== viewerName) {
      if (assignee) hidden.others += 1; else hidden.unassigned += 1;
      continue;
    }
    const daysAway = task.dueDate ? daysBetween(today, task.dueDate) : undefined;
    if (daysAway === undefined) {
      // A task with no date is still a task today, but it is not an answer to "明天".
      if (from !== 0 && to !== null) continue;
    } else if (daysAway < 0) {
      // Overdue work belongs to "today" and to "everything", not to a day still ahead.
      if (from !== 0) continue;
    } else if (daysAway < from || (to !== null && daysAway > to)) continue;

    const unit = task.unitId ? units.get(task.unitId) : undefined;
    const floor = task.floorId ? floors.get(task.floorId) : undefined;
    const bucket: ReminderBucket = daysAway === undefined ? 'UNSCHEDULED'
      : daysAway < 0 ? 'OVERDUE'
      : daysAway === 0 ? 'TODAY'
      : daysAway <= windowDays ? 'UPCOMING'
      : 'LATER';
    tasks.push({
      observationId: task.observationId,
      buildingId: task.buildingId,
      buildingName: buildings.get(task.buildingId)?.name ?? '（大廈已不在工作區）',
      floorId: task.floorId,
      floorLabel: floor?.label,
      unitId: task.unitId,
      place: unit?.label ?? floor?.label,
      action: task.action,
      category: task.category,
      assignee,
      timingNote: task.timingNote,
      dueDate: task.dueDate,
      daysAway,
      bucket,
    });
  }

  const rank = new Map(reminderBuckets.map((bucket, index) => [bucket, index]));
  tasks.sort((left, right) =>
    (rank.get(left.bucket)! - rank.get(right.bucket)!)
    || (left.daysAway ?? 0) - (right.daysAway ?? 0)
    || left.buildingName.localeCompare(right.buildingName, 'zh-HK')
    || left.action.localeCompare(right.action, 'zh-HK'));

  const counts = { OVERDUE: 0, TODAY: 0, UPCOMING: 0, LATER: 0, UNSCHEDULED: 0 };
  tasks.forEach(task => { counts[task.bucket] += 1; });

  return {
    today, windowDays, from, to, tasks, counts, hidden, ownOnly,
    mine: viewerName ? tasks.filter(task => task.assignee === viewerName).length : 0,
  };
}
