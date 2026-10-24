/** Asking the provider for a proposal: prompt in, validated suggestion out.
 *
 * The rule detector runs first and column mapping is only reached when it answered
 * `UNKNOWN` or `AMBIGUOUS` (`docs/AI_ASSISTANT.md` 6). Nothing here writes data or decides
 * a business fact: the answer is a proposal a person confirms column by column, and a
 * reply that does not match the contract is discarded whole rather than partly used.
 *
 * A worksheet is read in parts (6.1). The first part carries the header and decides the
 * mapping; later parts are checked against it and may not quietly move a field to another
 * column — a disagreement voids the whole answer, because choosing one of the two would be
 * exactly the "take the columns that look right" that CLAUDE.md 3.1 forbids.
 */
import { assessmentLabels, contactLabels, coverageLabels, supportCategoryLabels } from '../domain/presentation';
import { CONTACT_OUTCOMES, COVERAGE_STATUSES, HOUSING_ASSESSMENTS, SUPPORT_CATEGORIES, type OutreachSnapshot } from '../domain/types';
import { FORMAT_PROFILES, type CanonicalField } from '../imports/profiles';
import { AiRequestError, callProvider } from './client';
import { canonicalOptions, readDraft, readSuggestion, type AiDraft, type AiFieldSuggestion, type AiSuggestion, type ReadContext } from './contract';
import type { AiCredential } from './credential';
import { chunkHeaders, chunkRows, type OutboundPreview } from './preview';
import { providerSpec } from './providers';
import { draftPrompt, mappingPrompt } from './scope';

export interface SuggestInput {
  preview: OutboundPreview;
  credential: AiCredential;
  /** Test seam, passed through to `callProvider`. */
  fetcher?: typeof fetch;
  /** Columns the person removed from the outbound payload. */
  withheld?: readonly number[];
}

export interface FileSuggestion {
  suggestion: AiSuggestion;
  /** How many requests the worksheet took; the dialog reports the same number. */
  parts: number;
}

const no = (message: string) => new AiRequestError('schema', message);

/**
 * Reads every part of the worksheet and returns one mapping. The first part decides it;
 * a later part may omit a field (its rows may be empty there) but may not name a
 * different column for it.
 */
export async function suggestFileMapping({ preview, credential, fetcher, withheld = [] }: SuggestInput, onPart?: (index: number, count: number) => void): Promise<FileSuggestion> {
  const spec = providerSpec(credential.provider);
  if (!spec?.browserDirect) throw new AiRequestError('network', '尚未開放這個供應商由瀏覽器直接呼叫。');
  const headers = chunkHeaders(preview, withheld);
  const parts = preview.chunks.length;
  let decided: AiSuggestion | undefined;
  const warnings: string[] = [];

  for (let index = 0; index < parts; index++) {
    onPart?.(index + 1, parts);
    const chunk = preview.chunks[index];
    // The header is only guaranteed inside the part that contains it. The contract's row
    // index is relative to the rows actually sent, so it is rebased per part.
    const localHeader = preview.headerRow !== null && preview.headerRow >= chunk.start && preview.headerRow < chunk.end ? preview.headerRow - chunk.start : null;
    const prompt = mappingPrompt({
      sheetName: preview.sheetName,
      part: { index: index + 1, count: parts },
      headerRow: localHeader,
      headers: localHeader === null ? headers : undefined,
      rows: chunkRows(preview, chunk, withheld),
      columnCount: preview.columnCount,
      profileIds: FORMAT_PROFILES.map(profile => profile.id),
      fields: canonicalOptions().map(field => ({ key: field.key, label: field.label })),
      withheldColumns: withheld,
    });
    const raw = await callProvider(spec, { model: credential.model, key: credential.key, prompt, fetcher });
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

    if (index === 0) { decided = value; continue; }
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

  if (!decided) throw no('沒有讀到任何內容。');
  // The contract already refused a mapping onto a withheld column, but a stub provider in
  // tests may still return one; the dialog must never show a field it did not see.
  const suggestion: AiSuggestion = {
    ...decided,
    fields: decided.fields.filter(field => field.columnIndex === null || !withheld.includes(field.columnIndex)),
    unmappedColumns: decided.unmappedColumns.filter(column => !withheld.includes(column.columnIndex)),
    warnings: [...new Set(warnings)],
  };
  if (suggestion.status === 'MATCH' && !suggestion.fields.length) throw no('AI 提出的欄位全部落在被剔除的欄，沒有可用的對應。');
  return { suggestion, parts };
}

export interface DraftInput {
  text: string;
  snapshot: OutreachSnapshot;
  credential: AiCredential;
  fetcher?: typeof fetch;
}

const LOCATION_LIMIT = 400;

/** Turns a note into one proposed visit. Never writes; the dialog shows the blanks. */
export async function suggestDraft({ text, snapshot, credential, fetcher }: DraftInput): Promise<AiDraft> {
  const spec = providerSpec(credential.provider);
  if (!spec?.browserDirect) throw new AiRequestError('network', '尚未開放這個供應商由瀏覽器直接呼叫。');
  const floorOf = new Map(snapshot.floors.map(floor => [floor.id, floor]));
  const locations = snapshot.units
    .filter(unit => !unit.parentUnitId)
    .slice(0, LOCATION_LIMIT)
    .map(unit => ({ buildingId: unit.buildingId, floorLabel: floorOf.get(unit.floorId)?.label ?? '', unitLabel: unit.label }));
  const prompt = draftPrompt({
    text,
    buildings: snapshot.buildings.map(building => ({ id: building.id, name: building.name })),
    locations,
    coverage: COVERAGE_STATUSES.map(key => ({ key, label: coverageLabels[key] })),
    contacts: CONTACT_OUTCOMES.map(key => ({ key, label: contactLabels[key] })),
    assessments: HOUSING_ASSESSMENTS.map(key => ({ key, label: assessmentLabels[key] })),
    categories: SUPPORT_CATEGORIES.map(key => ({ key, label: supportCategoryLabels[key] })),
  });
  const raw = await callProvider(spec, { model: credential.model, key: credential.key, prompt, fetcher });
  const read = readDraft(raw, { text, buildingIds: new Set(snapshot.buildings.map(building => building.id)) });
  if (!read.ok) throw no(read.reason);
  if (snapshot.units.length > LOCATION_LIMIT) read.value.warnings.push(`單位清單超過 ${LOCATION_LIMIT} 個，只提供前 ${LOCATION_LIMIT} 個；未列出的位置請人手填寫。`);
  return read.value;
}

export type { AiFieldSuggestion };
export type { CanonicalField };
