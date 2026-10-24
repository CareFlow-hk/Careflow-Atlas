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

/** Without these the parser cannot place a row or read its visit; they are always shown. */
export const REQUIRED_FIELDS = new Set<CanonicalField>(['buildingId', 'buildingName', 'occurredAt', 'worker', 'coverage']);

export function shownFields(
  suggested: ReadonlySet<CanonicalField>,
  columns: Partial<Record<CanonicalField, number | null>>,
): { keys: CanonicalField[]; shown: CanonicalField[]; folded: CanonicalField[] } {
  // Only fields the parser can use, plus anything the AI named that this build does not
  // know (shown rather than silently dropped). Everything else would be a mapping nobody
  // could act on.
  const keys: CanonicalField[] = [...GENERIC_FIELDS];
  for (const key of suggested) if (!keys.includes(key)) keys.push(key);
  const shown = keys.filter(key => REQUIRED_FIELDS.has(key) || suggested.has(key) || typeof columns[key] === 'number');
  return { keys, shown, folded: keys.filter(key => !shown.includes(key)) };
}
