/** What Ctrl/Command-clicking does to the picked set. A plain click replaces it outright. */
export function nextSelection(current: readonly string[], unitId: string, additive: boolean): string[] {
  if (!additive) return [unitId];
  return current.includes(unitId) ? current.filter(id => id !== unitId) : [...current, unitId];
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
