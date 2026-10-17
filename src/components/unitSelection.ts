/** What Ctrl/Command-clicking does to the picked set. A plain click replaces it outright. */
export function nextSelection(current: readonly string[], unitId: string, additive: boolean): string[] {
  if (!additive) return [unitId];
  return current.includes(unitId) ? current.filter(id => id !== unitId) : [...current, unitId];
}

/**
 * The picked set without the ids that no longer name a unit.
 *
 * The structure can change under a selection — a unit split, a floor deleted, a batch delete
 * that took half of what was picked — and an id left behind still counts towards 已選 N 個單位
 * while naming nothing that can be acted on. The same array is returned when nothing was
 * dropped, so a caller holding it in state does not re-render for nothing.
 */
export function pruneSelection(current: string[], existing: Iterable<string>): string[] {
  const live = new Set(existing);
  return current.some(id => !live.has(id)) ? current.filter(id => live.has(id)) : current;
}

/**
 * What a key means while a set is picked, or nothing at all.
 *
 * Esc is a key people also press to get out of things, so it does not reach the set while a
 * field has the cursor or a dialog is open: there, Esc belongs to the dialog. The rule lives
 * here rather than in the listener so it can be read, and tested, on its own.
 */
export function pickerKeyAction(key: string, context: { inField: boolean; dialogOpen: boolean }): 'CLEAR' | undefined {
  if (context.inField || context.dialogOpen) return undefined;
  if (key === 'Escape') return 'CLEAR';
  return undefined;
}
