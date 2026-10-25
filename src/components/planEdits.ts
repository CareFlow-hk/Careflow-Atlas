/**
 * The cells a person changed after seeing the plan — by hand, or through the chat.
 *
 * Both writers land in the same layer on purpose (`docs/AI_ASSISTANT.md` 6.2). An edit is
 * not applied to the parsed row; it is applied to the sheet, and `parseGenericRows` reads
 * the whole sheet again. That way every rule — date and option reading, location lookup,
 * missing floors and units, suspected duplicates, corrections — runs on the changed data
 * exactly as it runs on a fresh file. Editing one cell can never step around a check.
 *
 * A field the sheet has no column for (a paper sheet that never printed 覆蓋結果) is written
 * to a column of its own past the sheet's width. The parser then reads it like any other
 * column, so there is still only one set of reading rules.
 */
import { GENERIC_FIELDS, type CellOverride } from '../imports/genericRows';
import type { CanonicalField } from '../imports/profiles';

/** Who changed the cell. Shown on the row; the written record still carries only `aiAssist`. */
export type EditSource = 'person' | 'ai';

export interface PlanEdits {
  /** `cellKey` or `fieldKey` → the value the person confirmed. */
  values: Record<string, string>;
  sources: Record<string, EditSource>;
}

export const NO_EDITS: PlanEdits = { values: {}, sources: {} };

/** A cell that exists in the sheet: 1-based worksheet row, 0-based column. */
export const cellKey = (row: number, column: number) => `c:${row}:${column}`;

/** A field the sheet has no column for; it becomes a synthetic column when read. */
export const fieldKey = (row: number, field: CanonicalField) => `f:${row}:${field}`;

export type EditTarget =
  | { kind: 'cell'; row: number; column: number }
  | { kind: 'field'; row: number; field: CanonicalField };

export function readEditKey(key: string): EditTarget | undefined {
  const [kind, rowText, target] = key.split(':');
  const row = Number(rowText);
  if (!Number.isInteger(row) || row < 1 || target === undefined) return undefined;
  if (kind === 'c') {
    const column = Number(target);
    return Number.isInteger(column) && column >= 0 ? { kind: 'cell', row, column } : undefined;
  }
  if (kind === 'f' && GENERIC_FIELDS.includes(target as CanonicalField)) {
    return { kind: 'field', row, field: target as CanonicalField };
  }
  return undefined;
}

/** Past every sheet the dialog accepts (`MAX_SHEET_COLUMNS` is 64), so it never collides. */
const SYNTHETIC_BASE = 1000;

export const syntheticColumn = (field: CanonicalField) => SYNTHETIC_BASE + Math.max(0, GENERIC_FIELDS.indexOf(field));

export function withEdit(edits: PlanEdits, key: string, value: string, source: EditSource): PlanEdits {
  return { values: { ...edits.values, [key]: value }, sources: { ...edits.sources, [key]: source } };
}

export function withoutEdit(edits: PlanEdits, key: string): PlanEdits {
  const values = { ...edits.values };
  const sources = { ...edits.sources };
  delete values[key];
  delete sources[key];
  return { values, sources };
}

/** The mapping in the shape the parser takes, dropping the fields left unmapped. */
export const toMapping = (columns: Partial<Record<CanonicalField, number | null>>) =>
  (Object.entries(columns) as [CanonicalField, number | null][])
    .filter((entry): entry is [CanonicalField, number] => typeof entry[1] === 'number')
    .map(([key, columnIndex]) => ({ key, columnIndex }));

export interface PlanInput {
  mapping: { key: CanonicalField; columnIndex: number }[];
  overrides: CellOverride[];
}

/**
 * The mapping and cell edits to hand `parseGenericRows`. Fields the sheet has no column
 * for get a synthetic column only while a value for them is actually present, so clearing
 * the value leaves the field unmapped again.
 */
export function planInput(columns: Partial<Record<CanonicalField, number | null>>, edits: PlanEdits): PlanInput {
  const mapping = toMapping(columns);
  const used = new Set(mapping.map(entry => entry.columnIndex));
  const overrides: CellOverride[] = [];
  for (const [key, value] of Object.entries(edits.values)) {
    const target = readEditKey(key);
    if (!target) continue;
    if (target.kind === 'cell') {
      overrides.push({ row: target.row, column: target.column, value });
      continue;
    }
    let column = columns[target.field];
    if (typeof column !== 'number') {
      column = syntheticColumn(target.field);
      if (!used.has(column)) {
        used.add(column);
        mapping.push({ key: target.field, columnIndex: column });
      }
    }
    overrides.push({ row: target.row, column, value });
  }
  return { mapping, overrides };
}

/** How many cells each source changed, for the line above the chat. */
export function editCounts(edits: PlanEdits): Record<EditSource, number> {
  const counts: Record<EditSource, number> = { person: 0, ai: 0 };
  for (const source of Object.values(edits.sources)) counts[source]++;
  return counts;
}
