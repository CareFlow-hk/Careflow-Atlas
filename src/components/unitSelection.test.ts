import { describe, expect, it } from 'vitest';
import { nextSelection, pickerKeyAction, pruneSelection } from './unitSelection';

/*
 * The picked set behind Ctrl/Command-clicking the elevation. It only ever holds ids the
 * person put there: nothing is inferred from a unit being similar to another, and a unit
 * is never added on the strength of a previous batch.
 */
describe('picking units off the elevation', () => {
  it('replaces the whole set on a plain click', () => {
    expect(nextSelection(['u1', 'u2'], 'u3', false)).toEqual(['u3']);
  });

  it('adds a unit that is not in the set', () => {
    expect(nextSelection(['u1'], 'u2', true)).toEqual(['u1', 'u2']);
  });

  it('takes a unit back out when it is already in the set', () => {
    expect(nextSelection(['u1', 'u2'], 'u1', true)).toEqual(['u2']);
  });

  it('starts a set from nothing', () => {
    expect(nextSelection([], 'u1', true)).toEqual(['u1']);
  });

  it('can be emptied, which is how Esc clears the selection', () => {
    expect(nextSelection(['u1'], 'u1', true)).toEqual([]);
  });

  it('keeps the order units were picked in and adds no duplicate', () => {
    expect(nextSelection(['u2', 'u1'], 'u2', true)).toEqual(['u1']);
    expect(nextSelection(['u2', 'u1'], 'u3', true)).toEqual(['u2', 'u1', 'u3']);
  });
});

/*
 * The structure can be edited while a set is picked, so the set has to be read against the
 * units that are still there: an id left behind counts towards 已選 N 個單位 and towards the
 * records the bar warns about, while naming nothing anyone can act on (review, 2026-10-16).
 */
describe('a picked set forgets the units that are gone', () => {
  it('drops an id that no longer names a unit', () => {
    expect(pruneSelection(['u1', 'u2'], ['u2'])).toEqual(['u2']);
  });

  it('leaves the set alone while every id still names a unit', () => {
    const picked = ['u1', 'u2'];
    expect(pruneSelection(picked, ['u1', 'u2', 'u3'])).toEqual(picked);
    // The same array, so a caller holding it in state does not re-render for nothing.
    expect(pruneSelection(picked, ['u1', 'u2'])).toBe(picked);
  });

  it('empties a set whose units have all gone', () => {
    expect(pruneSelection(['u1'], [])).toEqual([]);
  });
});

/*
 * Esc is a key people also press to get out of a dialog, so while a set is picked it still
 * has to mean what it usually means wherever the cursor actually is.
 */
describe('the keys that act on a picked set', () => {
  const away = { inField: false, dialogOpen: false };

  it('clears the set on Esc', () => {
    expect(pickerKeyAction('Escape', away)).toBe('CLEAR');
  });

  it('leaves every other key alone, Delete included', () => {
    for (const key of ['Enter', 'a', 'ArrowDown', 'Control', 'Delete', 'Backspace']) expect(pickerKeyAction(key, away)).toBeUndefined();
  });

  /* Clearing the set from a keypress while the cursor is in the 記錄內容 box would be a trap. */
  it('does nothing while a field has the cursor', () => {
    const inField = { inField: true, dialogOpen: false };
    expect(pickerKeyAction('Escape', inField)).toBeUndefined();
  });

  /* While the entry dialog is open, Esc closes it, not the selection. */
  it('does nothing while a dialog is open', () => {
    const dialog = { inField: false, dialogOpen: true };
    expect(pickerKeyAction('Escape', dialog)).toBeUndefined();
  });
});
