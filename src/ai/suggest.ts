/** Asking for a proposal: what to read in, a validated suggestion out.
 *
 * The rule detector runs first and column mapping is only reached when it answered
 * `UNKNOWN` or `AMBIGUOUS` (`docs/AI_ASSISTANT.md` 6). Nothing here writes data or decides
 * a business fact: the answer is a proposal a person confirms column by column, and a
 * reply that does not match the contract is discarded whole rather than partly used.
 *
 * What leaves the device is assembled here and checked once more on the server
 * (`server/aiProxy.mjs`); since phase 5 the server also writes the prompt, so this module
 * sends the data and the question, never instructions (`docs/AI_ASSISTANT.md` 5.2).
 *
 * A worksheet is read in parts (6.1). The first part carries the header and decides both
 * the mapping and whether the sheet is outreach work at all; a refusal there ends the run
 * (`docs/AI_ASSISTANT.md` 7). Later parts are checked against the first and may not quietly
 * move a field to another column — a disagreement voids the whole answer, because choosing
 * one of the two would be exactly the "take the columns that look right" that CLAUDE.md 3.1
 * forbids.
 */
import { assessmentLabels, contactLabels, coverageLabels, supportCategoryLabels } from '../domain/presentation';
import { hkDay } from '../domain/reminders';
import { CONTACT_OUTCOMES, COVERAGE_STATUSES, HOUSING_ASSESSMENTS, SUPPORT_CATEGORIES, type OutreachSnapshot } from '../domain/types';
import { FORMAT_PROFILES, type CanonicalField } from '../imports/profiles';
import { AiRequestError, callAi, type AiAssistMarker } from './client';
import { canonicalOptions, readDraft, readPatchReply, readSuggestion, type AiDraft, type AiFieldSuggestion, type AiPatchSet, type AiSuggestion, type ReadContext } from './contract';
import { chunkHeaders, chunkRows, type OutboundPreview } from './preview';
import type { DraftRequest, MappingRequest, PatchRequest } from './scope';

export interface SuggestInput {
  preview: OutboundPreview;
  /** Test seam, passed through to `callAi`. */
  fetcher?: typeof fetch;
  /** Columns the person removed from the outbound payload. */
  withheld?: readonly number[];
  /**
   * What the person typed alongside the file. Sent as a data block so the mapping can use
   * it («大廈名稱在第 3 欄»), never as instructions and never as a source of values.
   */
  context?: string;
}

export interface FileSuggestion {
  suggestion: AiSuggestion;
  /** How many requests the worksheet took; the dialog reports the same number. */
  parts: number;
  /**
   * The request that decided this sheet's mapping, written onto every record the sheet
   * produces. Each part is its own request, so this names the first one — the part that
   * also decided the sheet is outreach work at all. A later part only confirms it.
   */
  aiAssist: AiAssistMarker;
}

const no = (message: string) => new AiRequestError('schema', message);

/**
 * Reads every part of the worksheet and returns one mapping. The first part decides it;
 * a later part may omit a field (its rows may be empty there) but may not name a
 * different column for it.
 */
export async function suggestFileMapping({ preview, fetcher, withheld = [], context: contextText }: SuggestInput, onPart?: (index: number, count: number) => void): Promise<FileSuggestion> {
  const headers = chunkHeaders(preview, withheld);
  const parts = preview.chunks.length;
  let decided: AiSuggestion | undefined;
  let marker: AiAssistMarker | undefined;
  const warnings: string[] = [];

  for (let index = 0; index < parts; index++) {
    onPart?.(index + 1, parts);
    const chunk = preview.chunks[index];
    // The header is only guaranteed inside the part that contains it. The contract's row
    // index is relative to the rows actually sent, so it is rebased per part.
    const localHeader = preview.headerRow !== null && preview.headerRow >= chunk.start && preview.headerRow < chunk.end ? preview.headerRow - chunk.start : null;
    const request: MappingRequest = {
      sheetName: preview.sheetName,
      part: { index: index + 1, count: parts },
      headerRow: localHeader,
      headers: localHeader === null ? headers : undefined,
      rows: chunkRows(preview, chunk, withheld),
      columnCount: preview.columnCount,
      profileIds: FORMAT_PROFILES.map(profile => profile.id),
      fields: canonicalOptions().map(field => ({ key: field.key, label: field.label })),
      withheldColumns: withheld,
      context: contextText,
    };
    const { proposal: raw, aiAssist } = await callAi<Record<string, unknown>>('mapping', request, { fetcher });
    const context: ReadContext = {
      columnCount: preview.columnCount,
      rowCount: chunk.end - chunk.start,
      headerRow: localHeader ?? undefined,
      forbidHeaderRow: localHeader === null,
      forbiddenColumns: withheld,
    };
    const read = readSuggestion(raw, context);
    if (!read.ok) throw no(`第 ${index + 1}/${parts} 段：${read.reason}`);
    const value = read.value;
    warnings.push(...value.warnings);

    if (index === 0) {
      /*
       * The part holding the header decides whether this is an outreach sheet at all. If it
       * says no, sending the remaining parts asks the same question about the same workbook
       * again — and a payroll sheet read in 300-row slices would be paid for in full before
       * the dialog showed the refusal. Stop at the first answer instead.
       */
      if (value.status === 'REFUSE') return { suggestion: value, parts: index + 1, aiAssist };
      decided = value;
      marker = aiAssist;
      continue;
    }
    /*
     * A later part that refuses or finds nothing does not void the first part's mapping:
     * the mapping is a property of the sheet, and every row is still parsed below. It is
     * reported instead, so the person knows that part was not used to decide anything.
     */
    if (value.status !== 'MATCH') {
      warnings.push(`第 ${index + 1}/${parts} 段沒有提出欄位對應（${value.status}），該段的欄位沿用第 1 段。`);
      continue;
    }
    for (const field of value.fields) {
      const first = decided!.fields.find(item => item.key === field.key);
      if (!first || first.columnIndex === null || field.columnIndex === null) continue;
      if (first.columnIndex !== field.columnIndex) {
        const label = canonicalOptions().find(option => option.key === field.key)?.label ?? field.key;
        throw no(`第 ${index + 1}/${parts} 段把「${label}」對應到第 ${field.columnIndex + 1} 欄，與第 1 段的第 ${first.columnIndex + 1} 欄不同，已整份作廢。請只匯入其中一段，或改用人手對應。`);
      }
    }
  }

  if (!decided || !marker) throw no('沒有讀到任何內容。');
  // The contract already refused a mapping onto a withheld column, but a stub provider in
  // tests may still return one; the dialog must never show a field it did not see.
  const suggestion: AiSuggestion = {
    ...decided,
    fields: decided.fields.filter(field => field.columnIndex === null || !withheld.includes(field.columnIndex)),
    unmappedColumns: decided.unmappedColumns.filter(column => !withheld.includes(column.columnIndex)),
    warnings: [...new Set(warnings)],
  };
  if (suggestion.status === 'MATCH' && !suggestion.fields.length) throw no('AI 提出的欄位全部落在被剔除的欄，沒有可用的對應。');
  return { suggestion, parts, aiAssist: marker };
}

export interface DraftInput {
  text: string;
  snapshot: OutreachSnapshot;
  fetcher?: typeof fetch;
  /**
   * The device's Hong Kong day, for translating a relative word the note states. Passed
   * in rather than read here so a test can pin the day; the dialog lets it default.
   */
  today?: string;
}

const LOCATION_LIMIT = 400;

/** Turns a note into one proposed visit. Never writes; the dialog shows the blanks. */
export async function suggestDraft({ text, snapshot, fetcher, today = hkDay() }: DraftInput): Promise<{ draft: AiDraft; aiAssist: AiAssistMarker }> {
  const floorOf = new Map(snapshot.floors.map(floor => [floor.id, floor]));
  const locations = snapshot.units
    .filter(unit => !unit.parentUnitId)
    .slice(0, LOCATION_LIMIT)
    .map(unit => ({ buildingId: unit.buildingId, floorLabel: floorOf.get(unit.floorId)?.label ?? '', unitLabel: unit.label }));
  const request: DraftRequest = {
    text,
    today,
    buildings: snapshot.buildings.map(building => ({ id: building.id, name: building.name })),
    locations,
    coverage: COVERAGE_STATUSES.map(key => ({ key, label: coverageLabels[key] })),
    contacts: CONTACT_OUTCOMES.map(key => ({ key, label: contactLabels[key] })),
    assessments: HOUSING_ASSESSMENTS.map(key => ({ key, label: assessmentLabels[key] })),
    categories: SUPPORT_CATEGORIES.map(key => ({ key, label: supportCategoryLabels[key] })),
  };
  const { proposal, aiAssist } = await callAi<Record<string, unknown>>('draft', request, { fetcher });
  const read = readDraft(proposal, { text, today, buildingIds: new Set(snapshot.buildings.map(building => building.id)) });
  if (!read.ok) throw no(read.reason);
  if (snapshot.units.length > LOCATION_LIMIT) read.value.warnings.push(`單位清單超過 ${LOCATION_LIMIT} 個，只提供前 ${LOCATION_LIMIT} 個；未列出的位置請人手填寫。`);
  return { draft: read.value, aiAssist };
}

export type { AiFieldSuggestion };
export type { CanonicalField };

export interface PatchInput {
  text: string;
  preview: OutboundPreview;
  columns: Partial<Record<CanonicalField, number | null>>;
  /** 1-based worksheet rows the person can change — the rows the plan lists. */
  rows: readonly number[];
  /** Personal columns; they are absent from the request and cannot be patched. */
  withheld?: readonly number[];
  fetcher?: typeof fetch;
  today?: string;
}

/** Enough rows to work through a sheet by hand, few enough to keep one request bounded. */
export const PATCH_ROW_LIMIT = 500;

/**
 * Asks the assistant to change cells of the plan already on screen. Only rows in the plan
 * are sent, withheld columns are absent, and the reply is checked cell by cell; a reply
 * that names a row or a column outside what was sent loses the whole answer.
 */
export async function suggestPatches({
  text, preview, columns, rows, withheld = [], fetcher, today = hkDay(),
}: PatchInput): Promise<AiPatchSet> {
  const hidden = new Set(withheld);
  const labels = new Map(canonicalOptions().map(option => [option.key, option.label]));
  const fieldOfColumn = new Map<number, CanonicalField>();
  for (const [field, column] of Object.entries(columns) as [CanonicalField, number | null][]) {
    if (typeof column === 'number') fieldOfColumn.set(column, field);
  }
  const payloadColumns = preview.headers
    .map((header, columnIndex) => ({ columnIndex, header, field: fieldOfColumn.get(columnIndex) ?? null }))
    .filter(column => !hidden.has(column.columnIndex))
    .map(column => ({ ...column, label: column.field ? labels.get(column.field) ?? column.field : null }));

  const byNumber = new Map(preview.rowNumbers.map((number, index) => [number, preview.rows[index]]));
  const chosen = rows.slice(0, PATCH_ROW_LIMIT);
  const payloadRows = chosen.map(row => ({
    row,
    values: payloadColumns.map(column => byNumber.get(row)?.[column.columnIndex] ?? ''),
  }));

  const request: PatchRequest = {
    text, today,
    sheetName: preview.sheetName,
    columns: payloadColumns,
    rows: payloadRows,
    omitted: rows.length - chosen.length,
    coverage: COVERAGE_STATUSES.map(key => ({ key, label: coverageLabels[key] })),
    contacts: CONTACT_OUTCOMES.map(key => ({ key, label: contactLabels[key] })),
    assessments: HOUSING_ASSESSMENTS.map(key => ({ key, label: assessmentLabels[key] })),
    categories: SUPPORT_CATEGORIES.map(key => ({ key, label: supportCategoryLabels[key] })),
  };
  const { proposal } = await callAi<Record<string, unknown>>('patch', request, { fetcher });
  const read = readPatchReply(proposal, {
    text, today, rows: chosen, columnCount: preview.columnCount, columns,
    readOnlyColumns: withheld,
  });
  if (!read.ok) throw no(read.reason);
  if (rows.length > chosen.length) read.value.warnings.push(`表格有 ${rows.length} 行，這次只把前 ${PATCH_ROW_LIMIT} 行送交 AI；後面的行請分幾次處理。`);
  return read.value;
}
