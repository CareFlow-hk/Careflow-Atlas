/**
 * Which fields the dialog's column mapping table shows up front.
 *
 * The table used to list every canonical field, which made a person scroll past a dozen
 * fields the sheet never had. It now shows the ones a person must decide, the ones the AI
 * named, and the ones already mapped; the rest fold away but stay reachable — folding is
 * not dropping, and an unmapped column with content still has to be acknowledged
 * (`CLAUDE.md` 3.1).
 */
import type { CanonicalField } from '../imports/profiles';
import { GENERIC_FIELDS } from '../imports/genericRows';

/**
 * Without these the parser cannot place a row or read its visit; they are shown, badged
 * 必須, and a row missing one is never written. 覆蓋結果 is not one of them since
 * 2026-10-25: a blank cell is a visit that stated no result (CLAUDE.md §4).
 */
export const REQUIRED_FIELDS = new Set<CanonicalField>(['buildingId', 'buildingName', 'occurredAt', 'worker']);

/** Mapped often enough that it stays visible even when the AI did not name it. */
const ALWAYS_SHOWN = new Set<CanonicalField>([...REQUIRED_FIELDS, 'coverage']);

export function shownFields(
  suggested: ReadonlySet<CanonicalField>,
  columns: Partial<Record<CanonicalField, number | null>>,
): { keys: CanonicalField[]; shown: CanonicalField[]; folded: CanonicalField[] } {
  // Only fields the parser can use, plus anything the AI named that this build does not
  // know (shown rather than silently dropped). Everything else would be a mapping nobody
  // could act on.
  const keys: CanonicalField[] = [...GENERIC_FIELDS];
  for (const key of suggested) if (!keys.includes(key)) keys.push(key);
  const shown = keys.filter(key => ALWAYS_SHOWN.has(key) || suggested.has(key) || typeof columns[key] === 'number');
  return { keys, shown, folded: keys.filter(key => !shown.includes(key)) };
}
