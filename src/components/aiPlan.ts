/**
 * What the assistant is about to do, said as actions a person can read.
 *
 * The dialog used to walk through the columns and then through every row; the same work is
 * now one list — 「在裕安樓 · 5F B室 新增 1 筆到訪記錄」 — read once and confirmed once
 * (`docs/AI_ASSISTANT.md` 6.1). This module builds that list and decides what goes in it,
 * so the rules stay testable without a browser:
 *
 * - a row is writable when the parser produced something to save and it does not look like
 *   a repeat — a suspected repeat is never written automatically (`CLAUDE.md` 3.2);
 * - a floor or unit is created only when it makes one of those rows writable. Offering a
 *   place nothing needs would be an action without a purpose, and creating one is the
 *   strongest thing this dialog can do.
 */
import type { GenericParseResult, ParsedRow, PendingPlace } from '../imports/genericRows';

const loose = (text: string) => text.replace(/[\s\u3000·・]/g, '').toLowerCase();

export const placeKey = (place: PendingPlace) => `${place.buildingId}|${loose(place.floorLabel)}|${loose(place.unitLabel)}`;

export interface PlanAction {
  key: string;
  kind: 'place' | 'record';
  /** One sentence saying what will happen, and where. */
  sentence: string;
  /** The facts behind it: worksheet row, date, worker, or why it is offered at all. */
  detail: string;
  /** The worksheet row it comes from; for a place, the first row naming it. */
  rowNumber: number;
  /** Set on place actions so the dialog can match them to the place it creates. */
  placeKey?: string;
}

export function placeAction(place: PendingPlace): PlanAction {
  const added = place.newFloor ? `「${place.floorLabel}」這一層與「${place.unitLabel}」` : `「${place.unitLabel}」`;
  return {
    key: `place:${placeKey(place)}`,
    kind: 'place',
    sentence: `在「${place.buildingName}」新增${added}`,
    detail: `工作區原本沒有；建好之後第 ${place.rowNumbers.join('、')} 行才能寫入`,
    rowNumber: place.rowNumbers[0],
    placeKey: placeKey(place),
  };
}

export function recordAction(row: ParsedRow): PlanAction {
  const where = row.buildingName ? `${row.buildingName}${row.location ? ` · ${row.location}` : '（整幢）'}` : '未知大廈';
  const facts = [row.occurredAt, row.workerName, row.coverage].filter(Boolean).join(' · ');
  return {
    key: `row:${row.rowNumber}`,
    kind: 'record',
    sentence: `在「${where}」新增 1 筆到訪記錄`,
    detail: [`第 ${row.rowNumber} 行`, facts].filter(Boolean).join('；'),
    rowNumber: row.rowNumber,
  };
}

/**
 * The rows that will be written. A row waiting only for its floor/unit is included — the
 * plan creates that place first; a row that is also missing a date, a worker or the
 * coverage result is not, because creating the place would not make it writable.
 *
 * A row that looks like a repeat of a live record or of an earlier row stays out: content
 * that looks the same is not proof of anything, so it is left for a person to check rather
 * than merged or written behind their back.
 */
export function plannedRows(result: GenericParseResult, chosen: ReadonlySet<string>): ParsedRow[] {
  const waiting = new Set<number>();
  for (const place of result.pending) {
    if (!chosen.has(placeKey(place))) continue;
    for (const rowNumber of place.rowNumbers) waiting.add(rowNumber);
  }
  return result.rows.filter(row => !row.suspectedDuplicateOf && !row.suspectedDuplicateOfRow && (
    row.input || (waiting.has(row.rowNumber) && row.issues.length > 0 && row.issues.every(issue => issue.code === 'LOCATION' || issue.code === 'LOCATION_REVIEW'))
  ));
}

/**
 * The floors and units worth creating: those that turn a row into something writable.
 * Run with every place ticked — the plan is confirmed as a whole, so nothing else can be
 * left half-ticked — and keep only the places whose rows survived.
 */
export function placesToCreate(result: GenericParseResult): PendingPlace[] {
  const all = new Set(result.pending.map(placeKey));
  const writable = new Set(plannedRows(result, all).map(row => row.rowNumber));
  return result.pending.filter(place => place.rowNumbers.some(rowNumber => writable.has(rowNumber)));
}

/** Every action the plan will run, in the order it runs them: places first, then rows. */
export function planActions(places: readonly PendingPlace[], rows: readonly ParsedRow[]): PlanAction[] {
  return [...places.map(placeAction), ...rows.map(recordAction)];
}
