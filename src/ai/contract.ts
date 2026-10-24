/** The one shape an AI column-mapping answer may take, and the check it must pass.
 *
 * A suggestion is all-or-nothing: one stray field, one unknown column name, one index
 * outside the sheet and the whole reply is thrown away with the reason shown to the
 * person. Keeping part of it would silently accept a mapping nobody reviewed, which is
 * what CLAUDE.md 3.1 forbids. Nothing here decides business facts: only "which of the
 * existing columns is which existing field".
 */
import { CONTACT_OUTCOMES, COVERAGE_STATUSES, HOUSING_ASSESSMENTS, SOURCE_TYPES, SUPPORT_CATEGORIES, type ContactOutcome, type CoverageStatus, type HousingAssessment, type SourceType, type SupportCategory } from '../domain/types';
import { FORMAT_PROFILES, type CanonicalField, type ProfileId } from '../imports/profiles';

export const CONTRACT_VERSION = 'ai-mapping-v1';

/** The AI may only name fields that already exist; this list is built from the profiles. */
const FIELD_LABELS: Partial<Record<CanonicalField, string>> = { recordedAt: '錄入時間', recordId: '記錄編號' };

export interface CanonicalOption { key: CanonicalField; label: string }

let cachedOptions: CanonicalOption[] | undefined;

/** Every canonical field, with the label the mapping preview uses. */
export function canonicalOptions(): CanonicalOption[] {
  if (cachedOptions) return cachedOptions;
  const seen = new Map<CanonicalField, string>();
  for (const profile of FORMAT_PROFILES) {
    for (const field of profile.sheet.fields) {
      if (!seen.has(field.key)) seen.set(field.key, FIELD_LABELS[field.key] ?? field.label);
    }
  }
  cachedOptions = [...seen].map(([key, label]) => ({ key, label }));
  return cachedOptions;
}

const CANONICAL = new Set<string>(FORMAT_PROFILES.flatMap(profile => profile.sheet.fields.map(field => field.key)));
const PROFILES = new Set<string>(FORMAT_PROFILES.map(profile => profile.id));

export type AiStatus = 'MATCH' | 'NO_MATCH' | 'REFUSE';

export interface AiFieldSuggestion {
  key: CanonicalField;
  /** null means "this workbook has no such column"; it is not a guess. */
  columnIndex: number | null;
  confidence: number;
  reason: string;
}

export interface AiUnmappedColumn { columnIndex: number; header: string; reason: string }

export interface AiSuggestion {
  status: AiStatus;
  sheetName?: string;
  headerRow?: number;
  profileId?: ProfileId;
  fields: AiFieldSuggestion[];
  unmappedColumns: AiUnmappedColumn[];
  warnings: string[];
}

export type AiRead = { ok: true; value: AiSuggestion } | { ok: false; reason: string };

export interface ReadContext {
  columnCount: number;
  rowCount: number;
  /** When the rule detector already decided the header row, the answer must agree with it. */
  headerRow?: number;
  /** Later parts of one sheet carry no header, and may not claim one. */
  forbidHeaderRow?: boolean;
  /** Columns the person withheld; a mapping onto one of them is a guess, so it is refused. */
  forbiddenColumns?: readonly number[];
}

const TOP_LEVEL = new Set(['status', 'sheetName', 'headerRow', 'profileId', 'fields', 'unmappedColumns', 'warnings']);
const FIELD_KEYS = new Set(['key', 'columnIndex', 'confidence', 'reason']);
const UNMAPPED_KEYS = new Set(['columnIndex', 'header', 'reason']);
const MAX_FIELDS = 60, MAX_UNMAPPED = 60, MAX_WARNINGS = 10, MAX_TEXT = 300;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | undefined => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_TEXT ? value.trim() : undefined;

/** A malformed reply is discarded whole; the caller shows this sentence and writes nothing. */
const reject = (why: string): AiRead => ({ ok: false, reason: `AI 回覆格式不正確，已整份作廢，未寫入任何資料：${why}` });

function strayKeys(value: Record<string, unknown>, allowed: Set<string>): string | undefined {
  return Object.keys(value).find(key => !allowed.has(key));
}

/** Validates one provider reply. Only an exact match against the contract survives. */
export function readSuggestion(raw: unknown, context: ReadContext): AiRead {
  if (!isObject(raw)) return reject('不是一個 JSON 物件。');
  const extra = strayKeys(raw, TOP_LEVEL);
  if (extra) return reject(`多了合約以外的欄位「${extra}」。`);

  const status = raw.status;
  if (status !== 'MATCH' && status !== 'NO_MATCH' && status !== 'REFUSE') return reject('status 不在 MATCH／NO_MATCH／REFUSE 之內。');

  if (raw.warnings !== undefined && !(Array.isArray(raw.warnings) && raw.warnings.length <= MAX_WARNINGS && raw.warnings.every(warning => typeof warning === 'string' && warning.length <= MAX_TEXT))) {
    return reject('warnings 必須是最多 10 句短文字。');
  }
  const warnings = (raw.warnings as string[] | undefined) ?? [];

  if (status === 'REFUSE') {
    if (raw.fields !== undefined && !(Array.isArray(raw.fields) && raw.fields.length === 0)) return reject('REFUSE 不應附帶欄位建議。');
    if (raw.unmappedColumns !== undefined && !(Array.isArray(raw.unmappedColumns) && raw.unmappedColumns.length === 0)) return reject('REFUSE 不應附帶欄位清單。');
    return { ok: true, value: { status, fields: [], unmappedColumns: [], warnings } };
  }

  if (raw.headerRow !== undefined) {
    if (!Number.isInteger(raw.headerRow) || (raw.headerRow as number) < 0 || (raw.headerRow as number) >= context.rowCount) return reject('headerRow 超出送出的樣本範圍。');
    if (context.forbidHeaderRow) return reject('這一段不含表頭，不應提出 headerRow。');
    if (context.headerRow !== undefined && raw.headerRow !== context.headerRow) return reject('AI 選的表頭行與系統識別的不同。');
  }
  if (raw.profileId !== undefined && !(typeof raw.profileId === 'string' && PROFILES.has(raw.profileId))) return reject('profileId 不在候選格式之內。');
  if (raw.sheetName !== undefined && (typeof raw.sheetName !== 'string' || raw.sheetName.length > MAX_TEXT)) return reject('sheetName 不是文字。');

  if (!Array.isArray(raw.fields)) return reject('缺少 fields 陣列。');
  if (raw.fields.length > MAX_FIELDS) return reject('fields 太多項。');
  if (status === 'MATCH' && raw.fields.length === 0) return reject('MATCH 郤沒有提出任何欄位。');

  const fields: AiFieldSuggestion[] = [];
  const seenFields = new Set<string>(), seenColumns = new Map<number, string>();
  for (const entry of raw.fields) {
    if (!isObject(entry)) return reject('fields 內有一項不是物件。');
    const stray = strayKeys(entry, FIELD_KEYS);
    if (stray) return reject(`fields 內多了合約以外的欄位「${stray}」。`);
    if (typeof entry.key !== 'string' || !CANONICAL.has(entry.key)) return reject(`不認識欄位代號「${String(entry.key)}」。`);
    if (seenFields.has(entry.key)) return reject(`欄位「${entry.key}」出現多於一次。`);
    seenFields.add(entry.key);
    const columnIndex = entry.columnIndex;
    if (columnIndex !== null && !(Number.isInteger(columnIndex) && (columnIndex as number) >= 0 && (columnIndex as number) < context.columnCount)) {
      return reject(`欄位「${entry.key}」的欄索引超出範圍。`);
    }
    if (typeof columnIndex === 'number' && context.forbiddenColumns?.includes(columnIndex)) {
      return reject(`欄位「${entry.key}」被對應到使用者剔除的第 ${columnIndex + 1} 欄，而該欄內容沒有送出。`);
    }
    if (typeof columnIndex === 'number') {
      const taken = seenColumns.get(columnIndex);
      if (taken) return reject(`第 ${columnIndex + 1} 欄被「${taken}」與「${entry.key}」同時使用。`);
      seenColumns.set(columnIndex, entry.key);
    }
    if (typeof entry.confidence !== 'number' || !Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) return reject(`欄位「${entry.key}」的信心值不是 0 至 1。`);
    const reason = textOf(entry.reason);
    if (!reason) return reject(`欄位「${entry.key}」缺少理由。`);
    fields.push({ key: entry.key as CanonicalField, columnIndex: columnIndex as number | null, confidence: entry.confidence, reason });
  }

  const unmappedColumns: AiUnmappedColumn[] = [];
  if (raw.unmappedColumns !== undefined) {
    if (!Array.isArray(raw.unmappedColumns) || raw.unmappedColumns.length > MAX_UNMAPPED) return reject('unmappedColumns 必須是陣列。');
    const seenIndex = new Set<number>();
    for (const entry of raw.unmappedColumns) {
      if (!isObject(entry)) return reject('unmappedColumns 內有一項不是物件。');
      const stray = strayKeys(entry, UNMAPPED_KEYS);
      if (stray) return reject(`unmappedColumns 內多了合約以外的欄位「${stray}」。`);
      const index = entry.columnIndex;
      if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= context.columnCount) return reject('unmappedColumns 的欄索引超出範圍。');
      if (seenIndex.has(index as number)) return reject('unmappedColumns 有重複的欄索引。');
      seenIndex.add(index as number);
      if (seenColumns.has(index as number)) return reject(`第 ${(index as number) + 1} 欄同時被對應與列為未對應。`);
      if (typeof entry.header !== 'string' || entry.header.length > MAX_TEXT) return reject('unmappedColumns 的表頭不是文字。');
      const reason = textOf(entry.reason);
      if (!reason) return reject('unmappedColumns 缺少理由。');
      unmappedColumns.push({ columnIndex: index as number, header: entry.header, reason });
    }
  }

  return {
    ok: true,
    value: {
      status,
      sheetName: typeof raw.sheetName === 'string' ? raw.sheetName : undefined,
      headerRow: typeof raw.headerRow === 'number' ? raw.headerRow : undefined,
      profileId: raw.profileId as ProfileId | undefined,
      fields, unmappedColumns, warnings,
    },
  };
}

/** Fields the chosen format marks as required, for the preview's "still missing" line. */
export function requiredFields(profileId?: ProfileId): CanonicalField[] {
  const profile = FORMAT_PROFILES.find(candidate => candidate.id === profileId);
  return profile ? profile.sheet.fields.filter(field => field.required).map(field => field.key) : [];
}

/* ---------------------------------------------------------------------------------------
 * The draft contract: a note (typed, pasted, or one line of paper) becomes one proposed
 * visit. It is deliberately a different shape from a column mapping — a draft names
 * values, so the check is about where those values came from. A date or time whose digits
 * are not in the note is refused whole: that is the difference between "read the note"
 * and "guess", and the latter is exactly what CLAUDE.md 3.1 and section 4 forbid.
 * ------------------------------------------------------------------------------------- */

export interface AiDraftFollowUp {
  action: string;
  category?: SupportCategory;
  assignee?: string;
  dueDate?: string;
  timingNote?: string;
}

export interface AiDraft {
  status: 'DRAFT' | 'REFUSE';
  buildingId?: string;
  floorLabel?: string;
  unitLabel?: string;
  occurredDate?: string;
  occurredTime?: string;
  workerName?: string;
  coverage?: CoverageStatus;
  contactOutcome?: ContactOutcome;
  assessment?: HousingAssessment;
  sourceType?: SourceType;
  note?: string;
  followUp?: AiDraftFollowUp;
  /** What the note did not say. The dialog shows these as blanks, never fills them. */
  missing: string[];
  warnings: string[];
}

export type DraftRead = { ok: true; value: AiDraft } | { ok: false; reason: string };

export interface DraftContext {
  /** The note as typed; every date and time in the reply must appear in it. */
  text: string;
  buildingIds: ReadonlySet<string>;
}

const DRAFT_TOP = new Set(['status', 'buildingId', 'floorLabel', 'unitLabel', 'occurredDate', 'occurredTime', 'workerName', 'coverage', 'contactOutcome', 'assessment', 'sourceType', 'note', 'followUp', 'missing', 'warnings']);
const FOLLOW_KEYS = new Set(['action', 'category', 'assignee', 'dueDate', 'timingNote']);
const MAX_NOTE = 2000, MAX_MISSING = 12, MAX_NAME = 120;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

const dayIsReal = (day: string): boolean => {
  const match = DAY.exec(day);
  if (!match) return false;
  const value = new Date(`${day}T00:00:00Z`);
  return value.getUTCFullYear() === Number(match[1]) && value.getUTCMonth() + 1 === Number(match[2]) && value.getUTCDate() === Number(match[3]);
};
const digitsIn = (text: string, ...values: string[]) => values.every(value => text.includes(value));

const draftReject = (why: string): DraftRead => ({ ok: false, reason: `AI 回覆格式不正確，已整份作廢，未寫入任何資料：${why}` });

function shortText(value: unknown, limit = MAX_NAME): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit ? value.trim() : undefined;
}

/** Validates one draft reply against the note it came from. */
export function readDraft(raw: unknown, context: DraftContext): DraftRead {
  if (!isObject(raw)) return draftReject('不是一個 JSON 物件。');
  const extra = strayKeys(raw, DRAFT_TOP);
  if (extra) return draftReject(`多了合約以外的欄位「${extra}」。`);
  if (raw.status !== 'DRAFT' && raw.status !== 'REFUSE') return draftReject('status 不在 DRAFT／REFUSE 之內。');

  const readList = (value: unknown, limit: number): string[] | undefined => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > limit || !value.every(item => typeof item === 'string' && item.length <= MAX_NAME)) return undefined;
    return value.map(item => item.trim()).filter(Boolean);
  };
  const missing = readList(raw.missing, MAX_MISSING), warnings = readList(raw.warnings, 10);
  if (!missing || !warnings) return draftReject('missing／warnings 必須是短文字陣列。');

  if (raw.status === 'REFUSE') {
    const carried = ['buildingId', 'occurredDate', 'occurredTime', 'coverage', 'note', 'followUp'].filter(key => raw[key] != null);
    if (carried.length) return draftReject('REFUSE 不應附帶草稿內容。');
    return { ok: true, value: { status: 'REFUSE', missing, warnings } };
  }

  const text = context.text;
  const optionalDay = (value: unknown): string | undefined | false => {
    if (value == null) return undefined;
    if (typeof value !== 'string' || !dayIsReal(value)) return false;
    const [, y, m, d] = DAY.exec(value)!;
    return digitsIn(text, y, m, d) ? value : false;
  };

  const occurredDate = optionalDay(raw.occurredDate);
  if (occurredDate === false) return draftReject('occurredDate 不是在文字裡寫出、又真實存在的日期。');

  let occurredTime: string | undefined;
  if (raw.occurredTime != null) {
    if (typeof raw.occurredTime !== 'string' || !CLOCK.test(raw.occurredTime)) return draftReject('occurredTime 不是 24 小時制時刻。');
    const [, hh, mm] = CLOCK.exec(raw.occurredTime)!;
    if (!digitsIn(text, hh, mm)) return draftReject(`occurredTime「${raw.occurredTime}」不是文字裡寫出的時刻。`);
    occurredTime = raw.occurredTime;
  }

  if (raw.buildingId != null && !(typeof raw.buildingId === 'string' && context.buildingIds.has(raw.buildingId))) return draftReject('buildingId 不在既有大廈清單內。');
  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined | false => {
    if (value == null) return undefined;
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : false;
  };
  const coverage = pick(raw.coverage, COVERAGE_STATUSES);
  const contactOutcome = pick(raw.contactOutcome, CONTACT_OUTCOMES);
  const assessment = pick(raw.assessment, HOUSING_ASSESSMENTS);
  const sourceType = pick(raw.sourceType, SOURCE_TYPES);
  if (coverage === false) return draftReject('coverage 不在可選代號內。');
  if (contactOutcome === false) return draftReject('contactOutcome 不在可選代號內。');
  if (assessment === false) return draftReject('assessment 不在可選代號內。');
  if (sourceType === false) return draftReject('sourceType 不在可選代號內。');

  let followUp: AiDraftFollowUp | undefined;
  if (raw.followUp != null) {
    if (!isObject(raw.followUp)) return draftReject('followUp 不是物件。');
    const stray = strayKeys(raw.followUp, FOLLOW_KEYS);
    if (stray) return draftReject(`followUp 內多了合約以外的欄位「${stray}」。`);
    const action = shortText(raw.followUp.action);
    if (!action) return draftReject('followUp 缺少 action。');
    let category: SupportCategory | undefined;
    if (raw.followUp.category != null) {
      if (typeof raw.followUp.category !== 'string' || !SUPPORT_CATEGORIES.includes(raw.followUp.category as SupportCategory)) return draftReject('followUp.category 不在可選代號內。');
      category = raw.followUp.category as SupportCategory;
    }
    const dueDate = optionalDay(raw.followUp.dueDate);
    if (dueDate === false) return draftReject('followUp.dueDate 不是在文字裡寫出、又真實存在的日期。');
    followUp = { action, category, assignee: raw.followUp.assignee == null ? undefined : shortText(raw.followUp.assignee), dueDate, timingNote: raw.followUp.timingNote == null ? undefined : shortText(raw.followUp.timingNote) };
  }

  const note = raw.note == null ? undefined : shortText(raw.note, MAX_NOTE);
  if (raw.note != null && !note) return draftReject('note 不是文字。');

  return {
    ok: true,
    value: {
      status: 'DRAFT',
      buildingId: raw.buildingId == null ? undefined : raw.buildingId as string,
      floorLabel: raw.floorLabel == null ? undefined : shortText(raw.floorLabel),
      unitLabel: raw.unitLabel == null ? undefined : shortText(raw.unitLabel),
      occurredDate, occurredTime,
      workerName: raw.workerName == null ? undefined : shortText(raw.workerName),
      coverage, contactOutcome, assessment, sourceType, note, followUp,
      missing, warnings,
    },
  };
}

