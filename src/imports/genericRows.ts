/**
 * Turning a confirmed column mapping into visit rows — the step between "this column is
 * 到訪日期" and "these rows may be written".
 *
 * It reads the file again rather than the outbound preview: the preview is text for the
 * provider, and an Excel date there is a number. Every row is classified rather than
 * dropped, so a row the parser cannot settle is shown to the person instead of quietly
 * disappearing (`CLAUDE.md` 3.3). Nothing is invented: a missing date, worker, coverage or
 * building makes a row `NEEDS_REVIEW` or `INVALID`, never a default.
 */
import * as XLSX from 'xlsx';
import { acceptedAssessment, acceptedContact, acceptedCoverage, acceptedSource, assessmentLabels, contactLabels, coverageLabels, sourceLabels, supportCategoryLabels } from '../domain/presentation';
import { effectiveObservations, type Building, type ContactOutcome, type CoverageStatus, type HousingAssessment, type OutreachSnapshot, type SaveObservationInput, type SourceType, type SupportCategory } from '../domain/types';
import { findPaperLocation, floorNumber, proposeLocation, readPaperFloor } from '../domain/structure';
import type { CanonicalField } from './profiles';

export type RowStatus = 'READY' | 'NEEDS_REVIEW' | 'INVALID';

export interface RowIssue { code: string; message: string }

/**
 * A floor or unit the file names but the workspace does not have yet.
 *
 * The parser never creates it (an unattended import must not add places), and it never
 * writes the row as if the place existed. It reports the wording the file used and the
 * rows that depend on it; a person ticks it in the dialog, the existing structure edit
 * creates it, and the file is read again. A building is not offered: it needs a position
 * on the map, which a sheet never supplies and the assistant must not invent.
 */
export interface PendingPlace {
  buildingId: string;
  buildingName: string;
  /** The floor as it is, or would be, written. */
  floorLabel: string;
  /** True when the floor itself is missing, not only the unit on it. */
  newFloor: boolean;
  unitLabel: string;
  /** 1-based worksheet rows naming this place. */
  rowNumbers: number[];
}

export interface ParsedRow {
  /** 1-based worksheet row, so the person can find it in Excel. */
  rowNumber: number;
  status: RowStatus;
  issues: RowIssue[];
  /** Filled only for READY rows; the dialog adds the AI marker and the operator. */
  input?: SaveObservationInput;
  buildingName?: string;
  location?: string;
  occurredAt?: string;
  workerName?: string;
  coverage?: string;
  /** An existing record that looks like the same visit. Never merged (CLAUDE.md 3.2). */
  suspectedDuplicateOf?: string;
  /** An earlier row in the same file that looks like the same visit. */
  suspectedDuplicateOfRow?: number;
}

export interface GenericParseResult {
  rows: ParsedRow[];
  counts: Record<RowStatus, number>;
  /** Problems with the sheet as a whole, shown above the rows. */
  notes: string[];
  /** Rows the sheet contains but that were blank; reported, not counted as data. */
  blankRows: number;
  /** Floors and units the file names that the workspace does not have. Unique, in row order. */
  pending: PendingPlace[];
}

/** One cell the person or the assistant changed, before the sheet is read again. */
export interface CellOverride {
  /** 1-based worksheet row, as in `ParsedRow.rowNumber`. */
  row: number;
  /** 0-based column, as in `mapping[].columnIndex`. */
  column: number;
  value: string;
}

/** A sheet already read, so a re-parse does not decode the workbook again. */
export interface SheetMatrix {
  matrix: readonly unknown[][];
  date1904: boolean;
}

/**
 * Read the sheet the same way `parseGenericRows` does. The dialog reads it once when the
 * file is chosen; every later edit rebuilds the parse from this matrix instead of the
 * buffer (`docs/AI_ASSISTANT.md` 6.2).
 */
export function readSheetMatrix(buffer: ArrayBuffer, sheetName: string): SheetMatrix | undefined {
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(buffer, { type: 'array' }); }
  catch { return undefined; }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return undefined;
  return {
    matrix: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true }),
    date1904: !!workbook.Workbook?.WBProps?.date1904,
  };
}

export interface GenericParseInput {
  buffer: ArrayBuffer;
  sheetName: string;
  /** 1-based worksheet row the header was found on. Required: without it nothing is a column. */
  headerRow: number;
  mapping: readonly { key: CanonicalField; columnIndex: number }[];
  /**
   * Columns the sheet has that no canonical field was mapped to. Their values are not
   * dropped: each row keeps them in its note (CLAUDE.md 3.1 — nothing is silently lost).
   * The dialog lists the column names before this is used, and can leave some out.
   */
  extraColumns?: readonly { header: string; columnIndex: number }[];
  snapshot: OutreachSnapshot;
  fileName: string;
  /**
   * A building the person named in what they typed next to the file (`docs/AI_ASSISTANT.md`
   * 6.1) — 「在裕安樓」. It is used only for a row whose own 大廈 cell is empty; a row that
   * names a building keeps it. The parser does not look for it, does not create a building,
   * and the plan says how many rows relied on it.
   */
  defaultBuilding?: { id: string; name: string };
  /**
   * The floor and unit the person typed beside the file — 「在裕安樓 5 樓 B 室」. Used only
   * for a row whose own 樓層 and 單位 cells are both empty, and only when the row resolved
   * to the same building. The place goes through the ordinary location rules: an existing
   * one is used, a missing one is offered for creation, unreadable wording is refused.
   * It is the person's own sentence, not a value the assistant invented (`CLAUDE.md` §4).
   */
  defaultPlace?: { buildingId: string; floorLabel: string; unitLabel: string };
  /**
   * The sheet, already read. When given, the buffer is not decoded again; the dialog
   * re-parses on every edit and decoding a 700-row workbook each time would be wasteful.
   */
  matrix?: SheetMatrix;
  /**
   * Cells changed after the person saw the plan — edited by hand or proposed by the
   * assistant and confirmed. They are applied before any rule runs, so every check
   * (dates, options, locations, duplicates, corrections) sees the changed sheet.
   */
  overrides?: readonly CellOverride[];
  now?: string;
  /** Test seam; production uses `crypto.randomUUID`. */
  newId?: () => string;
}

/** Issue codes that make a row 'INVALID' rather than 'NEEDS_REVIEW'. */
const BLOCKING = new Set(['BUILDING', 'LOCATION', 'DATE', 'TIME', 'COVERAGE', 'CONTACT', 'ASSESSMENT', 'SOURCE', 'CATEGORY', 'DUE_DATE', 'DUPLICATE_ID', 'CORRECTION_TARGET', 'RESOLVES_TARGET', 'MISSING_ACTION', 'CORRECTION_REASON']);

const str = (value: unknown) => value == null ? '' : String(value);
const optional = (value: unknown) => str(value).trim() || undefined;
const loose = (text: string) => text.replace(/[\s\u3000·・]/g, '').toLowerCase();
const pad = (n: string | number) => String(n).padStart(2, '0');

/**
 * Reads one option cell: the label the sheet printed, the key itself, or an accepted
 * colloquial wording. `false` means it says something this system does not know; it is
 * never mapped to a nearby option. Shared with the patch contract so a value the assistant
 * proposes is judged by the same list the file is.
 */
export const readOption = <T extends string>(value: unknown, labels: Record<T, string>, accepted: Record<string, T>): T | undefined | false => {
  const raw = optional(value);
  if (!raw) return undefined;
  return (Object.keys(labels) as T[]).find(key => labels[key] === raw || key === raw) ?? accepted[raw] ?? false;
};

/** Every mapping field the parser can use, in the order the dialog lists them. */
export const GENERIC_FIELDS: CanonicalField[] = [
  'buildingId', 'buildingName', 'floor', 'unit', 'occurredAt', 'occurredTime', 'worker', 'coverage',
  'contactOutcome', 'assessment', 'sourceType', 'note', 'evidence', 'recordId', 'paperRef', 'paperLine',
  'visitId', 'followUpCategory', 'followUpAction', 'followUpAssignee', 'followUpDueDate', 'followUpTimingNote',
  'resolvesObservationId', 'correctsObservationId', 'correctionReason', 'personName', 'phone', 'address', 'addressNote', 'contactNote',
];

export function parseGenericRows(input: GenericParseInput): GenericParseResult {
  const now = input.now ?? new Date().toISOString();
  const newId = input.newId ?? (() => globalThis.crypto.randomUUID());
  const notes: string[] = [];
  const column = new Map(input.mapping.map(entry => [entry.key, entry.columnIndex]));
  const mappedIndexes = new Set(input.mapping.map(entry => entry.columnIndex));
  const at = (values: readonly unknown[], key: CanonicalField) => {
    const index = column.get(key);
    return index === undefined ? undefined : values[index];
  };
  if (!column.has('buildingId') && !column.has('buildingName') && !input.defaultBuilding) notes.push('未對應「大廈」欄，任何一行都無法寫入。請回到欄位核對，指出哪一欄是大廈。');
  if (!column.has('occurredAt')) notes.push('未對應「到訪日期」欄，任何一行都需要人補日期。');

  let matrix: readonly unknown[][];
  let date1904 = false;
  if (input.matrix) {
    matrix = input.matrix.matrix;
    date1904 = input.matrix.date1904;
  } else {
    let workbook: XLSX.WorkBook;
    try { workbook = XLSX.read(input.buffer, { type: 'array' }); }
    catch { return { rows: [], counts: { READY: 0, NEEDS_REVIEW: 0, INVALID: 0 }, notes: ['讀不到這個檔案。'], blankRows: 0, pending: [] }; }
    const sheet = workbook.Sheets[input.sheetName];
    if (!sheet) return { rows: [], counts: { READY: 0, NEEDS_REVIEW: 0, INVALID: 0 }, notes: [`找不到工作表「${input.sheetName}」。`], blankRows: 0, pending: [] };
    matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true });
    date1904 = !!workbook.Workbook?.WBProps?.date1904;
  }

  // Edits are applied per row before anything is read, so a hand edit and an assistant
  // edit take exactly the same path through the parser.
  const edits = new Map<number, Map<number, string>>();
  for (const edit of input.overrides ?? []) {
    const row = edits.get(edit.row) ?? new Map<number, string>();
    row.set(edit.column, edit.value);
    edits.set(edit.row, row);
  }
  const withOverrides = (values: readonly unknown[], cells: Map<number, string>): unknown[] => {
    const copy = values.slice();
    for (const [column, value] of cells) copy[column] = value;
    return copy;
  };
  const readDay = (value: unknown): string | undefined | false => {
    if (value == null || str(value).trim() === '') return undefined;
    let day = str(value).trim();
    if (typeof value === 'number') {
      const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
      if (!parsed) return false;
      return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
    }
    // A cell may hold a date and a time together; only the day part is read here.
    day = day.replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
    const year = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(day);
    if (year) return `${year[1]}-${pad(year[2])}-${pad(year[3])}`;
    const chinese = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(day);
    if (chinese) return `${chinese[1]}-${pad(chinese[2])}-${pad(chinese[3])}`;
    // 9/10/2026 is either day order; it is not guessed.
    return false;
  };
  const readTime = (value: unknown): string | undefined | false => {
    if (value == null || str(value).trim() === '') return undefined;
    if (typeof value === 'number' && value >= 0 && value < 1) {
      const seconds = Math.round(value * 86400);
      return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}`;
    }
    const text = str(value).trim();
    const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(text);
    return match ? `${pad(match[1])}:${match[2]}` : false;
  };

  const buildings = input.snapshot.buildings;
  const resolveBuilding = (values: readonly unknown[]): { building: Building } | { error: string } => {
    const byId = optional(at(values, 'buildingId')), byName = optional(at(values, 'buildingName'));
    const tryMatch = (text: string) => {
      const exactId = buildings.filter(building => building.id === text);
      const exactName = buildings.filter(building => building.name === text);
      const looseMatch = buildings.filter(building => loose(building.id) === loose(text) || loose(building.name) === loose(text));
      const found = exactId.length ? exactId : exactName.length ? exactName : looseMatch;
      return found.length === 1 ? found[0] : found.length ? 'AMBIGUOUS' as const : undefined;
    };
    for (const text of [byId, byName]) {
      if (!text) continue;
      const found = tryMatch(text);
      if (found === 'AMBIGUOUS') return { error: `「${text}」同時符合多幢大廈，請把大廈編號寫清楚。` } as const;
      if (found) return { building: found } as const;
    }
    const named = byId ?? byName;
    if (named) return { error: `找不到大廈「${named}」。新大廈要請人先在地圖新增；AI 不會代為建立。` } as const;
    // Only an empty cell takes the fallback; a row that names a building, right or wrong,
    // keeps its own wording so a typo is reported rather than papered over.
    const fallback = input.defaultBuilding && buildings.find(building => building.id === input.defaultBuilding!.id);
    if (fallback) return { building: fallback } as const;
    return { error: '未填大廈。' } as const;
  };

  /** A missing place, offered for creation; otherwise the wording nobody can act on. */
  type Missing = { floorLabel: string; newFloor: boolean; unitLabel: string; key: string };
  const propose = (buildingId: string, floorText: string | undefined, unitText: string | undefined, newFloor: boolean): Missing | undefined => {
    if (!unitText || !floorText) return undefined;
    // Same reading rules as the photo path: only a numeric floor and a lettered unit are
    // proposed; anything else stays refused rather than guessed (CLAUDE.md §4).
    const proposal = proposeLocation(input.snapshot, buildingId, floorText, unitText);
    if (!proposal) return undefined;
    // 「9F / A室」 and 「9樓 / 9F A室」 are two spellings of one place: dedupe by what would
    // be created, not by how the sheet happens to write it.
    const applied = proposal.apply(input.snapshot);
    const unit = 'error' in applied ? undefined : applied.snapshot.units.find(item => item.id === applied.unitId);
    return { floorLabel: floorText, newFloor, unitLabel: unitText, key: `${buildingId}|${unit?.floorId ?? floorText}|${loose(unit?.label ?? unitText)}` };
  };
  const missingText = (buildingName: string, missing: Missing) => {
    const where = `「${buildingName} ${missing.floorLabel} ${missing.unitLabel}」`;
    const what = missing.newFloor ? `「${missing.floorLabel}」這一層與「${missing.unitLabel}」這個單位` : `「${missing.unitLabel}」這個單位`;
    return `原表寫的是${where}，系統還沒有${what}。在下面勾選建立後再核對；未建立前這一筆不會寫入。`;
  };

  const resolveLocation = (buildingId: string, floorText?: string, unitText?: string): { floorId?: string; unitId?: string } | { error: string; missing?: Missing } | undefined => {
    if (!floorText && !unitText) return undefined;
    const floors = input.snapshot.floors.filter(floor => floor.buildingId === buildingId);
    const units = input.snapshot.units.filter(unit => unit.buildingId === buildingId);
    const buildingName = input.snapshot.buildings.find(b => b.id === buildingId)?.name ?? buildingId;
    // A sheet may write 「5」 or 「5樓」 for the floor the workspace labels 「5F」: the floor
    // number is the identity, the label is only one spelling of it (CLAUDE.md §4). An exact
    // label still wins; a number two floors share is ambiguous and is not guessed.
    const exact = floorText ? floors.filter(floor => floor.id === floorText || loose(floor.label) === loose(floorText)) : [];
    const number = readPaperFloor(floorText);
    const byNumber = floorText && !exact.length && number !== undefined ? floors.filter(floor => floorNumber(floor.label) === number) : [];
    const matchFloor = exact.length ? exact : byNumber;
    if (floorText && matchFloor.length !== 1) {
      if (matchFloor.length) return { error: `樓層「${floorText}」對應到多層，請寫清楚。` } as const;
      const missing = propose(buildingId, floorText, unitText, true);
      if (missing) return { error: missingText(buildingName, missing), missing } as const;
      return { error: `在「${buildingName}」找不到樓層「${floorText}」。` } as const;
    }
    const floor = matchFloor[0];
    if (floorText && !unitText) return { error: `只填了樓層「${floorText}」，未填單位。整幢的記錄請把樓層、單位都留空。` } as const;
    const pool = floor ? units.filter(unit => unit.floorId === floor.id) : units;
    const unitLabel = unitText!;
    const matches = floor
      ? pool.filter(unit => unit.id === unitLabel || loose(unit.label) === loose(unitLabel) || loose(unit.label).endsWith(loose(unitLabel)) || loose(unit.label.slice(floor.label.length)) === loose(unitLabel))
      : pool.filter(unit => unit.id === unitLabel || loose(unit.label) === loose(unitLabel));
    if (matches.length === 1) return { floorId: matches[0].floorId, unitId: matches[0].id } as const;
    if (matches.length > 1) return { error: `單位「${unitLabel}」在這一層有多個寫法相同的格子，請寫清楚。` } as const;
    // Paper wording ("1樓 A室", "3/F B室") is read by the same rules the sheet import uses.
    const paper = findPaperLocation(input.snapshot, buildingId, floorText, unitLabel);
    if (paper) {
      const unit = units.find(item => item.id === paper)!;
      return { floorId: unit.floorId, unitId: unit.id } as const;
    }
    const missing = propose(buildingId, floor?.label ?? floorText, unitLabel, false);
    if (missing) return { error: missingText(buildingName, missing), missing } as const;
    return { error: `找不到樓層「${floorText}」的單位「${unitLabel}」。位置不肯定時可把兩格留空，寫在備註。` } as const;
  };

  const live = effectiveObservations(input.snapshot);
  const rows: ParsedRow[] = [];
  /** Places the file names that are not there yet, gathered across rows. */
  const pending = new Map<string, PendingPlace>();
  let blankRows = 0;
  /** Rows that got their building from what the person typed, not from the sheet. */
  let defaultRows = 0;
  /** Rows that got their floor/unit from what the person typed, not from the sheet. */
  let defaultPlaceRows = 0;

  for (let index = input.headerRow; index < matrix.length; index++) {
    const original = matrix[index] ?? [];
    const cells = edits.get(index + 1);
    const values = cells ? withOverrides(original, cells) : original;
    if (!values.some(value => optional(value))) { blankRows++; continue; }
    const rowNumber = index + 1;
    const issues: RowIssue[] = [];
    const parsed: ParsedRow = { rowNumber, status: 'READY', issues };

    const building = resolveBuilding(values);
    let buildingId = '';
    if ('error' in building) issues.push({ code: 'BUILDING', message: building.error });
    else {
      buildingId = building.building.id;
      parsed.buildingName = building.building.name;
      if (input.defaultBuilding && !optional(at(values, 'buildingId')) && !optional(at(values, 'buildingName'))) defaultRows++;
    }

    const day = readDay(at(values, 'occurredAt'));
    if (day === false) issues.push({ code: 'DATE', message: '「到訪日期」看不懂是哪一天。請用 Excel 日期，或寫成 2026-10-09；不知道就留空。' });
    if (day === undefined) issues.push({ code: 'MISSING_DATE', message: '未填到訪日期。系統不會替你補日期。' });

    const time = readTime(at(values, 'occurredTime'));
    if (time === false) issues.push({ code: 'TIME', message: '「到訪時間」看不懂。請寫成 24 小時制，例如 19:05；不知道就留空。' });

    const workerName = optional(at(values, 'worker'));
    if (!workerName) issues.push({ code: 'MISSING_WORKER', message: '未填工作員（紙本上落樓的同事，不是入 Excel 的人）。' });

    const coverage = readOption<CoverageStatus>(at(values, 'coverage'), coverageLabels, acceptedCoverage);
    if (!coverage) issues.push({ code: 'MISSING_COVERAGE', message: '未填覆蓋結果。' });
    if (coverage === false) issues.push({ code: 'COVERAGE', message: '「覆蓋結果」不是可選的寫法。' });

    const contactOutcome = readOption<ContactOutcome>(at(values, 'contactOutcome'), contactLabels, acceptedContact);
    if (contactOutcome === false) issues.push({ code: 'CONTACT', message: '「接觸結果」不是可選的寫法。' });
    const assessment = readOption<HousingAssessment>(at(values, 'assessment'), assessmentLabels, acceptedAssessment);
    if (assessment === undefined) issues.push({ code: 'MISSING_ASSESSMENT', message: '未填住房判斷。' });
    if (assessment === false) issues.push({ code: 'ASSESSMENT', message: '「住房判斷」不是可選的寫法。' });
    const sourceType = readOption<SourceType>(at(values, 'sourceType'), sourceLabels, acceptedSource);
    if (sourceType === undefined) issues.push({ code: 'MISSING_SOURCE', message: '未填資料來源。' });
    if (sourceType === false) issues.push({ code: 'SOURCE', message: '「資料來源」不是可選的寫法。' });
    const category = readOption<SupportCategory>(at(values, 'followUpCategory'), supportCategoryLabels, {} as Record<string, SupportCategory>);
    if (category === false) issues.push({ code: 'CATEGORY', message: '「跟進類別」不是可選的寫法。' });

    const action = optional(at(values, 'followUpAction'));
    const dueDay = readDay(at(values, 'followUpDueDate'));
    if (dueDay === false) issues.push({ code: 'DUE_DATE', message: '「確定跟進日期」看不懂是哪一天；不知道就留空。' });
    const followBits = [category, optional(at(values, 'followUpAssignee')), dueDay, optional(at(values, 'followUpTimingNote'))].filter(Boolean);
    if (!action && followBits.length) issues.push({ code: 'MISSING_ACTION', message: '填了跟進資料，但沒寫「跟進行動」。請寫明要做什麼。' });
    if (action && dueDay && typeof dueDay === 'string' && day && typeof day === 'string' && dueDay < day) issues.push({ code: 'DUE_BEFORE_VISIT', message: '「確定跟進日期」早於到訪日期，請核對。' });

    // A mark on the sheet page says 「this file is 5樓 B室」; it is applied only where both
    // cells are empty and the building is the one that sentence named. A row that names
    // its own floor or unit keeps it, even if it disagrees with the note.
    const ownFloor = optional(at(values, 'floor')), ownUnit = optional(at(values, 'unit'));
    const fallbackPlace = input.defaultPlace && buildingId === input.defaultPlace.buildingId && !ownFloor && !ownUnit
      ? input.defaultPlace : undefined;
    if (fallbackPlace) defaultPlaceRows++;
    const floorText = ownFloor ?? fallbackPlace?.floorLabel, unitText = ownUnit ?? fallbackPlace?.unitLabel;
    let location: { floorId?: string; unitId?: string } | undefined;
    let waiting: Missing | undefined;
    if (buildingId) {
      const resolved = resolveLocation(buildingId, floorText, unitText);
      if (resolved && 'error' in resolved) {
        issues.push({ code: 'LOCATION', message: resolved.error });
        waiting = resolved.missing;
        if (waiting) {
          const buildingName = parsed.buildingName ?? buildingId;
          const known = pending.get(waiting.key);
          if (known) known.rowNumbers.push(rowNumber);
          else pending.set(waiting.key, {
            buildingId, buildingName, floorLabel: waiting.floorLabel, newFloor: waiting.newFloor, unitLabel: waiting.unitLabel, rowNumbers: [rowNumber],
          });
        }
      } else location = resolved;
    }
    // Say where the record will land in the workspace's own wording, not the sheet's
    // spelling: 「5 B」 becomes 「5F B室」 once the row is resolved.
    const floorFixed = location?.floorId ? input.snapshot.floors.find(item => item.id === location!.floorId)?.label : undefined;
    const unitFixed = location?.unitId ? input.snapshot.units.find(item => item.id === location!.unitId)?.label : undefined;
    parsed.location = floorFixed || unitFixed
      ? [floorFixed, unitFixed].filter(Boolean).join(' ')
      : floorText || unitText ? [floorText, unitText].filter(Boolean).join(' ') : undefined;

    const correctsObservationId = optional(at(values, 'correctsObservationId'));
    const correctionReason = optional(at(values, 'correctionReason'));
    if (correctsObservationId) {
      if (!input.snapshot.observations.some(item => item.id === correctsObservationId)) issues.push({ code: 'CORRECTION_TARGET', message: `更正原記錄「${correctsObservationId}」不在資料裡。` });
      if (!correctionReason) issues.push({ code: 'CORRECTION_REASON', message: '更正記錄要寫「更正原因」。' });
    }
    const resolvesObservationId = optional(at(values, 'resolvesObservationId'));
    if (resolvesObservationId && !input.snapshot.observations.some(item => item.id === resolvesObservationId)) issues.push({ code: 'RESOLVES_TARGET', message: `結束跟進編號「${resolvesObservationId}」不在資料裡。` });

    const paperRef = optional(at(values, 'paperRef')), paperLine = optional(at(values, 'paperLine'));
    const recordId = optional(at(values, 'recordId')) ?? (paperRef && paperLine && buildingId ? `paper:${encodeURIComponent(paperRef)}:${encodeURIComponent(paperLine)}:${buildingId}` : undefined);
    if (recordId && input.snapshot.observations.some(item => item.id === recordId)) issues.push({ code: 'DUPLICATE_ID', message: `記錄編號「${recordId}」已經存在。` });

    parsed.occurredAt = typeof day === 'string' ? (typeof time === 'string' ? `${day}T${time}:00+08:00` : day) : undefined;
    parsed.workerName = workerName;
    parsed.coverage = typeof coverage === 'string' ? coverageLabels[coverage] : undefined;

    if (issues.length) {
      // A missing place waits for a person to create it, so it does not finish the row off
      // as unusable; every other unreadable value still does (CLAUDE.md 3.3).
      const blocking = issues.some(issue => BLOCKING.has(issue.code) && !(issue.code === 'LOCATION' && waiting));
      parsed.status = blocking ? 'INVALID' : 'NEEDS_REVIEW';
      rows.push(parsed);
      continue;
    }

    // Columns nobody mapped are not dropped: their values are kept, word for word, in the
    // row's note, each labelled with the column it came from.
    const extras = (input.extraColumns ?? [])
      .filter(entry => !mappedIndexes.has(entry.columnIndex))
      .map(entry => ({ header: entry.header, value: optional(values[entry.columnIndex]) }))
      .filter(entry => entry.value)
      .map(entry => `${entry.header ? `原表「${entry.header}」` : '原表未命名欄'}：${entry.value}`);
    const note = [optional(at(values, 'note')), ...extras].filter(Boolean).join('；') || undefined;
    const evidence = str(at(values, 'evidence')).split('\n').map(line => line.trim()).filter(Boolean);
    const visitId = optional(at(values, 'visitId')) ?? `ai-visit:${newId()}`;
    const occurredAt = parsed.occurredAt!;
    const input_: SaveObservationInput = {
      id: recordId ?? `ai:${newId()}`,
      visitId,
      buildingId,
      floorId: location?.floorId,
      unitId: location?.unitId,
      occurredAt,
      recordedAt: now,
      workerName: workerName!,
      coverage: coverage as CoverageStatus,
      contactOutcome: contactOutcome || undefined,
      assessment: assessment || undefined,
      sourceType: sourceType || undefined,
      evidence,
      note,
      paperRef, paperLine,
      importSource: { file: input.fileName, sheet: input.sheetName, row: rowNumber },
      resolvesObservationId,
      correctsObservationId,
      correctionReason,
      followUp: action ? { action, status: 'OPEN', category: category || undefined, assignee: optional(at(values, 'followUpAssignee')), dueDate: typeof dueDay === 'string' ? dueDay : undefined, timingNote: optional(at(values, 'followUpTimingNote')) } : undefined,
    };
    parsed.input = input_;

    // Suspected duplicates: same place, same day, same coverage and worker as a live
    // record or an earlier row. Shown for a person to check; never merged (CLAUDE.md 3.2).
    const sameVisit = { buildingId, occurredAt, workerName, coverage, place: input_.unitId ?? input_.floorId ?? '' };
    const place = (item: { unitId?: string; floorId?: string }) => item.unitId ?? item.floorId ?? '';
    const twin = live.find(item => item.buildingId === sameVisit.buildingId && item.occurredAt === sameVisit.occurredAt && item.workerName === sameVisit.workerName && item.coverage === sameVisit.coverage && place(item) === sameVisit.place);
    if (twin) parsed.suspectedDuplicateOf = twin.id;
    else {
      const twinRow = rows.find(row => row.input && row.input.buildingId === sameVisit.buildingId && row.input.occurredAt === sameVisit.occurredAt && row.input.workerName === sameVisit.workerName && row.input.coverage === sameVisit.coverage && place(row.input) === sameVisit.place);
      if (twinRow) parsed.suspectedDuplicateOfRow = twinRow.rowNumber;
    }

    rows.push(parsed);
  }

  // Say out loud where the building came from. A person reading the plan can see the name
  // on every line, but not that it was their own sentence rather than the sheet's.
  if (defaultRows && input.defaultBuilding) {
    notes.push(`${defaultRows} 行沒有填大廈，都按你在補充說明寫的「${input.defaultBuilding.name}」處理。要改就改上面的文字再上傳。`);
  }
  if (defaultPlaceRows && input.defaultPlace) {
    notes.push(`${defaultPlaceRows} 行沒有填樓層／單位，都按你在補充說明寫的「${input.defaultPlace.floorLabel} ${input.defaultPlace.unitLabel}」處理。要改就改上面的文字再上傳。`);
  }

  const counts = { READY: 0, NEEDS_REVIEW: 0, INVALID: 0 };
  for (const row of rows) counts[row.status]++;
  return { rows, counts, notes, blankRows, pending: [...pending.values()] };
}
