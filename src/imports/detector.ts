/** Rule-driven candidate-format detection for W0.
 *
 * Deliberately narrow: it recognises the profiles in `profiles.ts` and refuses
 * everything else with a reason. It answers "which column is what" and never
 * "who is this person", so it cannot create identities, floors or coordinates.
 * Scores are rule weights, not calibrated probabilities — never show them as an
 * accuracy claim.
 */
import * as XLSX from 'xlsx';
import { readWorkbook } from '../data/readWorkbook';
import {
  DETECTOR_VERSION, FORMAT_PROFILES, normalizeHeader, profileById,
  type CanonicalField, type DetectionStatus, type FieldSpec, type FieldStatus,
  type FormatProfile, type ProfileId,
} from './profiles';

/** Rows scanned for a header before giving up. */
const HEADER_SCAN_LIMIT = 25;
/** Data rows sampled per column when checking value shape. */
const VALUE_SAMPLE_LIMIT = 20;

export interface DetectedField {
  key: CanonicalField;
  label: string;
  required: boolean;
  kind: FieldSpec['kind'];
  status: FieldStatus;
  /** Set only when the mapping resolved to a single column. */
  columnIndex?: number;
  sourceHeader?: string;
  /** Every column that plausibly belongs to this field, for AMBIGUOUS review. */
  candidates: { columnIndex: number; sourceHeader: string }[];
  basis: string;
  /** Set when the person in charge decided this field, so the preview can show it. */
  overridden?: 'column' | 'ignored';
}

export interface UnmatchedColumn {
  columnIndex: number;
  sourceHeader: string;
  hasData: boolean;
  /** Set when this column is one of a field's candidates: it is already on offer, not lost. */
  candidateFor?: CanonicalField;
}
export interface DetectionIssue { code: string; message: string; severity: 'error' | 'warning'; field?: CanonicalField }

export interface DetectionResult {
  detectorVersion: string;
  profileId?: ProfileId;
  profileLabel?: string;
  profileKind?: FormatProfile['kind'];
  profileDescription?: string;
  sheetName?: string;
  /** Zero-based index of the row the headers were read from. */
  headerRow?: number;
  /** Raw header cells of that row, in sheet order; the mapping table lists these. */
  headers: string[];
  status: DetectionStatus;
  /** Rule weight, not a success probability. */
  score: number;
  fields: DetectedField[];
  unmatchedColumns: UnmatchedColumn[];
  issues: DetectionIssue[];
  /** Overrides the person in charge applied, echoed back for the audit trail. */
  appliedOverrides: string[];
}

/** Corrections made in the mapping preview. `null` means "explicitly unknown". */
export interface MappingOverride {
  profileId?: ProfileId;
  columns?: Partial<Record<CanonicalField, number | null>>;
}

interface SheetMatrix { name: string; matrix: unknown[][] }
interface RowEvaluation {
  row: number;
  fields: DetectedField[];
  /** Fields resolved to a single column (KNOWN or CANDIDATE). */
  matched: number;
  /** Fields that found at least one column, ambiguity included. Drives the threshold gate. */
  explained: number;
  /** Required fields resolved to a single column. */
  requiredMapped: number;
  /** Sheet columns claimed by a mapping or offered as candidates. */
  claimed: Set<number>;
  /** Non-empty header cells on the evaluated row. */
  headerColumns: number;
}

function readSheets(buffer: ArrayBuffer): SheetMatrix[] {
  const workbook = readWorkbook(buffer);
  return workbook.SheetNames.map((name) => ({
    name,
    matrix: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: '', blankrows: true }),
  }));
}

const text = (value: unknown): string => value === undefined || value === null ? '' : String(value).trim();
const isBlank = (value: unknown): boolean => text(value) === '';

function parseDateLike(value: unknown): boolean {
  if (typeof value === 'number') return value > 0 && value < 200000;
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text(value));
}

function parseTimeLike(value: unknown): boolean {
  if (typeof value === 'number') return value >= 0 && value < 1;
  return /^([01]?\d|2[0-3]):[0-5]\d/.test(text(value));
}

/** `match` upgrades a candidate; `mismatch` demotes a presumed mapping. */
function sampleVerdict(kind: FieldSpec['kind'], values: unknown[], choices?: string[]): 'match' | 'mismatch' | 'unknown' {
  const filled = values.filter((value) => !isBlank(value));
  if (!kind || kind === 'text' || kind === 'id' || filled.length === 0) return 'unknown';
  const ok = (value: unknown) => kind === 'date' ? parseDateLike(value)
    : kind === 'time' ? parseTimeLike(value)
      : kind === 'enum' ? (choices ?? []).includes(text(value))
        : true;
  const hits = filled.filter(ok).length;
  if (hits === filled.length) return 'match';
  if (hits === 0) return 'mismatch';
  return 'unknown';
}

/** Evaluates one candidate header row against one profile. */
function evaluateRow(matrix: unknown[][], row: number, profile: FormatProfile): RowEvaluation {
  const headerCells = matrix[row] ?? [];
  const normalized = headerCells.map((cell) => normalizeHeader(cell));
  const fields: DetectedField[] = [];
  let matched = 0;
  let explained = 0;
  let requiredMapped = 0;
  const claimed = new Set<number>();

  for (const spec of profile.sheet.fields) {
    const aliases = spec.aliases.map(normalizeHeader).filter(Boolean);
    const exact: number[] = [];
    const partial: number[] = [];
    normalized.forEach((cell, index) => {
      if (cell.length < 2) return;
      if (aliases.includes(cell)) { exact.push(index); return; }
      // Forward containment only: "大廈編號" may carry the "大廈" alias, but a
      // short header like "id" must never pull in an alias such as "floorid".
      if (aliases.some((alias) => alias.length >= 2 && cell.includes(alias))) partial.push(index);
    });

    const pick = (index: number) => ({ columnIndex: index, sourceHeader: text(headerCells[index]) });
    const asCandidates = (indexes: number[]) => indexes.map((index) => ({ columnIndex: index, sourceHeader: text(headerCells[index]) }));
    const field: DetectedField = { key: spec.key, label: spec.label, required: !!spec.required, kind: spec.kind, status: 'UNKNOWN', candidates: [], basis: '表頭沒有對應欄位' };

    if (exact.length === 1) { Object.assign(field, pick(exact[0]), { status: 'KNOWN' as FieldStatus, basis: '表頭別名完全符合' }); }
    else if (exact.length > 1) { field.status = 'AMBIGUOUS'; field.candidates = asCandidates(exact); field.basis = `有 ${exact.length} 欄表頭同時符合，需負責人選擇`; }
    else if (partial.length === 1) { Object.assign(field, pick(partial[0]), { status: 'CANDIDATE' as FieldStatus, basis: '表頭部分符合，需人工確認' }); }
    else if (partial.length > 1) { field.status = 'AMBIGUOUS'; field.candidates = asCandidates(partial); field.basis = `有 ${partial.length} 欄表頭部分符合，需負責人選擇`; }

    if (field.columnIndex !== undefined && field.kind) {
      const values = matrix.slice(row + 1, row + 1 + VALUE_SAMPLE_LIMIT).map((line) => line?.[field.columnIndex!]);
      const verdict = sampleVerdict(field.kind, values, spec.choices);
      if (verdict === 'match' && field.status === 'CANDIDATE') { field.status = 'KNOWN'; field.basis = `表頭部分符合，列值符合${labelKind(field.kind)}格式`; }
      else if (verdict === 'mismatch' && field.status === 'KNOWN') { field.status = 'CANDIDATE'; field.basis = `表頭符合，但列值不符合${labelKind(field.kind)}格式，需人工確認`; }
    }

    if (field.status === 'KNOWN' || field.status === 'CANDIDATE') {
      matched += 1;
      if (field.required) requiredMapped += 1;
    }
    if (field.columnIndex !== undefined) claimed.add(field.columnIndex);
    for (const candidate of field.candidates) claimed.add(candidate.columnIndex);
    if (field.columnIndex !== undefined || field.candidates.length) explained += 1;
    fields.push(field);
  }
  return { row, fields, matched, explained, requiredMapped, claimed, headerColumns: headerCells.filter((cell) => !isBlank(cell)).length };
}

function labelKind(kind: NonNullable<FieldSpec['kind']>): string {
  return { text: '文字', id: '編號', date: '日期', time: '時間', enum: '選項' }[kind];
}

/** Ranks one (profile, sheet, header row) candidate against the others.
 *
 * The score is a rule weight, not a calibrated probability. Its job is only to
 * order candidates, and it must not reward a wide profile for columns it does
 * not actually explain: a bare count would let the 22-field archival format win
 * on a six-column sheet it barely covers. So the count is scaled by how much of
 * the profile the sheet accounts for, and columns the profile leaves unexplained
 * are subtracted.
 */
function rank(profile: FormatProfile, evaluation: RowEvaluation, hint: boolean, named: boolean): number {
  const profileFields = profile.sheet.fields.length || 1;
  const coverage = evaluation.explained / profileFields;
  const unexplained = Math.max(0, evaluation.headerColumns - evaluation.claimed.size);
  const score = evaluation.explained * coverage * 10
    + evaluation.requiredMapped * 3
    + (hint ? 2 : 0)
    + (named ? 4 : 0)
    - unexplained;
  return Math.round(score * 100) / 100;
}

/** Picks the best (profile, sheet, header row), then classifies the result. */
export function detectWorkbook(buffer: ArrayBuffer, override: MappingOverride = {}): DetectionResult {
  const sheets = readSheets(buffer);
  const profiles = override.profileId ? FORMAT_PROFILES.filter((profile) => profile.id === override.profileId) : FORMAT_PROFILES;
  let best: { profile: FormatProfile; sheet: SheetMatrix; evaluation: RowEvaluation; score: number } | undefined;

  for (const profile of profiles) {
    for (const sheet of sheets) {
      const sheetKey = normalizeHeader(sheet.name);
      // Containment, not equality: the hint "探訪" must still catch "探訪記錄".
      const hint = profile.sheetHints.some((name) => { const key = normalizeHeader(name); return key.length >= 2 && (sheetKey.includes(key) || key.includes(sheetKey)); });
      const named = profile.sheet.names.some((name) => normalizeHeader(name) === sheetKey);
      let localBest: { evaluation: RowEvaluation; score: number } | undefined;
      for (let row = 0; row < Math.min(HEADER_SCAN_LIMIT, sheet.matrix.length); row += 1) {
        const evaluation = evaluateRow(sheet.matrix, row, profile);
        if (evaluation.explained === 0) continue;
        const score = rank(profile, evaluation, hint, named);
        if (!localBest || score > localBest.score) localBest = { evaluation, score };
      }
      if (localBest && (!best || localBest.score > best.score)) best = { profile, sheet, evaluation: localBest.evaluation, score: localBest.score };
    }
  }

  if (!best) {
    return {
      detectorVersion: DETECTOR_VERSION, status: 'UNKNOWN', score: 0, fields: [], headers: [], unmatchedColumns: [],
      appliedOverrides: [], issues: [{
        code: 'FORMAT_NOT_RECOGNIZED', severity: 'error',
        message: '未能識別此活頁簿。第一版只支援已列出的候選格式；請整理表頭後再試，或改用人工對應。圖片、PDF 及掃描件暫不支援。',
      }],
    };
  }

  return finalize(best.profile, best.sheet, best.evaluation, best.score, override);
}

function finalize(profile: FormatProfile, sheet: SheetMatrix, evaluation: RowEvaluation, score: number, override: MappingOverride): DetectionResult {
  const width = sheet.matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const headerCells = Array.from({ length: width }, (_, index) => sheet.matrix[evaluation.row]?.[index] ?? '');
  const fields = evaluation.fields.map((field) => ({ ...field, candidates: [...field.candidates] }));
  const appliedOverrides: string[] = [];

  for (const field of fields) {
    const forced = override.columns?.[field.key];
    if (forced === undefined) continue;
    if (forced === null) {
      appliedOverrides.push(field.label);
      field.status = 'UNKNOWN'; field.columnIndex = undefined; field.sourceHeader = undefined; field.candidates = [];
      field.basis = '負責人標示為未知／忽略'; field.overridden = 'ignored';
      continue;
    }
    if (!Number.isInteger(forced) || forced < 0 || forced >= headerCells.length) continue;
    appliedOverrides.push(field.label);
    field.status = 'KNOWN'; field.columnIndex = forced; field.sourceHeader = text(headerCells[forced]);
    field.candidates = []; field.basis = '負責人指定欄位'; field.overridden = 'column';
  }

  const columnUsers = new Map<number, DetectedField[]>();
  for (const field of fields) if (field.columnIndex !== undefined) columnUsers.set(field.columnIndex, [...columnUsers.get(field.columnIndex) ?? [], field]);
  for (const users of columnUsers.values()) if (users.length > 1) for (const field of users) {
    field.status = 'AMBIGUOUS'; field.basis = '同一欄被多個欄位使用，請核對對應。';
  }
  const claimed = new Set(fields.map((field) => field.columnIndex).filter((index): index is number => index !== undefined));
  const candidateFor = new Map<number, CanonicalField>();
  for (const field of fields) for (const candidate of field.candidates) candidateFor.set(candidate.columnIndex, field.key);
  const headers = Array.from({ length: width }, (_, index) => text(headerCells[index]));
  const unmatchedColumns: UnmatchedColumn[] = headers
    .map((sourceHeader, index) => ({ columnIndex: index, sourceHeader, candidateFor: candidateFor.get(index),
      hasData: sheet.matrix.slice(evaluation.row + 1).some(line => !isBlank(line[index])) }))
    .filter(column => !claimed.has(column.columnIndex) && (column.sourceHeader !== '' || column.hasData));

  // Counted after the person in charge's corrections, and counting ambiguity:
  // a field with several candidate columns is recognised, not absent — it just
  // still needs a decision, which the required-field check below reports.
  const explained = fields.filter((field) => field.columnIndex !== undefined || field.candidates.length > 0).length;
  const required = fields.filter((field) => field.required);
  const requiredResolved = required.filter((field) => field.status === 'KNOWN' || field.status === 'CANDIDATE');
  const issues: DetectionIssue[] = [];

  let status: DetectionStatus;
  if (explained < profile.minMatchedFields) {
    status = 'UNKNOWN';
    issues.push({ code: 'BELOW_THRESHOLD', severity: 'error', message: `只識別到 ${explained} 個欄位，未達此格式的最低要求（${profile.minMatchedFields} 個）。不會依猜測匯入，請整理表頭或改用人手對應。` });
  } else if (requiredResolved.length < required.length) {
    status = 'AMBIGUOUS';
    for (const field of required) {
      if (field.status === 'KNOWN' || field.status === 'CANDIDATE') continue;
      issues.push({
        code: field.status === 'AMBIGUOUS' ? 'REQUIRED_FIELD_AMBIGUOUS' : 'REQUIRED_FIELD_MISSING', severity: 'error', field: field.key,
        message: field.status === 'AMBIGUOUS' ? `關鍵欄位「${field.label}」有多個可能欄位，請在對應表選擇。` : `缺少關鍵欄位「${field.label}」，請在對應表指定或補齊原表。`,
      });
    }
  } else if (fields.some(field => field.status === 'AMBIGUOUS')) {
    status = 'AMBIGUOUS';
  } else if (fields.some((field) => field.status === 'CANDIDATE')) {
    status = 'CANDIDATE';
  } else {
    status = 'KNOWN';
  }

  for (const column of unmatchedColumns.filter((column) => column.hasData && !column.candidateFor)) {
    issues.push({ code: 'UNMATCHED_COLUMN', severity: 'warning', message: `第 ${column.columnIndex + 1} 欄「${column.sourceHeader}」未能對應，且有內容；不會靜默丟棄，請確認是否需要對應。` });
  }
  if (profile.kind === 'template') {
    issues.push({ code: 'TEMPLATE_PROFILE', severity: 'warning', message: `「${profile.label}」是推測格式，未取得機構原表驗證，且第一版沒有對應解析器；只作候選顯示，不會寫入資料。` });
  }

  return {
    detectorVersion: DETECTOR_VERSION, profileId: profile.id, profileLabel: profile.label, profileKind: profile.kind,
    profileDescription: profile.description, sheetName: sheet.name, headerRow: evaluation.row, status, score,
    headers, fields, unmatchedColumns, issues, appliedOverrides,
  };
}

/** Re-runs detection with the person in charge's corrections; the preview version changes. */
export function remapWorkbook(buffer: ArrayBuffer, override: MappingOverride): DetectionResult {
  return detectWorkbook(buffer, override);
}

/** Why the merge must stay blocked, or undefined when the recognition is good enough.
 *
 * A refused recognition has no column mapping to show, so there is nothing for a
 * person to correct inside the sheet — guessing a format here is exactly what W0
 * forbids. An ambiguous required field is the opposite case: the mapping is known,
 * one decision is missing, and the preview's mapping table is where it is made.
 */
export function recognitionBlocker(result?: DetectionResult): string | undefined {
  if (!result) return undefined;
  if (result.profileKind === 'template') return '此推測格式只供預覽，尚未支援匯入。請使用工作台範本。';
  if (result.status === 'UNKNOWN') return '未能識別這份活頁簿的格式，不會依猜測匯入。請整理表頭，或在下方改用其他候選格式並人手對應。';
  if (result.status === 'AMBIGUOUS') return '仍有關鍵欄位未確定對應，請在下方對應表中為每一項選擇欄位，再確認合併。';
  if (result.fields.some(field => field.status === 'CANDIDATE' || field.status === 'AMBIGUOUS')) return '仍有欄位需要人工確認。請核對原表，整理後重新載入。';
  return undefined;
}

/** The value the mapping table's select uses for "this column is not in the sheet".
 *
 * A `<select>` cannot carry `null`, and an empty string already means "no decision",
 * so the explicit null needs a value of its own.
 */
export const IGNORED_COLUMN = '__ignored__';

/** Translates one mapping-table choice into the correction the detector understands.
 *
 * Returns undefined for "no decision", so a caller never re-runs recognition for an
 * unchanged row. The null-versus-absent distinction is the part worth pinning down:
 * `{ worker: null }` is a decision that the sheet has no such column, while a missing
 * key leaves the automatic mapping alone.
 */
export function columnChoice(key: CanonicalField, value: string): MappingOverride | undefined {
  if (value === '') return undefined;
  return { columns: { [key]: value === IGNORED_COLUMN ? null : Number(value) } };
}

/** Folds one correction from the mapping table into everything decided so far.
 *
 * Corrections accumulate: fixing a second column must not silently undo the first.
 * They are dropped only when the format actually changes, because a column index
 * only means something inside one profile's field list. `effectiveProfileId` is the
 * format the preview is showing right now, not the one that was forced — picking the
 * profile the detector already chose is not a change and must not discard the work.
 * `profileId` is read with `in`, so an explicit `undefined` means "back to
 * automatic" rather than "unchanged".
 */
export function mergeOverride(previous: MappingOverride, change: MappingOverride, effectiveProfileId?: ProfileId): MappingOverride {
  const switching = 'profileId' in change && change.profileId !== effectiveProfileId;
  return {
    profileId: 'profileId' in change ? change.profileId : previous.profileId,
    columns: switching ? { ...change.columns } : { ...previous.columns, ...change.columns },
  };
}

/** Fields the preview must ask a human about before anything could be committed. */
export function fieldsNeedingReview(result: DetectionResult): DetectedField[] {
  return result.fields.filter((field) => field.status === 'AMBIGUOUS' || field.status === 'UNKNOWN' || (field.required && field.status === 'CANDIDATE'));
}

export function profileOptions(): { id: ProfileId; label: string; kind: FormatProfile['kind'] }[] {
  return FORMAT_PROFILES.map((profile) => ({ id: profile.id, label: profile.label, kind: profile.kind }));
}

export { profileById };
