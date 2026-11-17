import { describe, expect, it } from 'vitest';
import { moveSheetSnap, nextSheetSnap, resolveSheetSnap } from './mobileSheetState';

describe('mobile sheet stops', () => {
  it('moves through collapsed, half and expanded without skipping a stop', () => {
    expect(moveSheetSnap('collapsed', 1)).toBe('half');
    expect(moveSheetSnap('half', 1)).toBe('expanded');
    expect(moveSheetSnap('expanded', 1)).toBe('expanded');
    expect(moveSheetSnap('expanded', -1)).toBe('half');
    expect(moveSheetSnap('half', -1)).toBe('collapsed');
    expect(moveSheetSnap('collapsed', -1)).toBe('collapsed');
  });

  it('opens a preserved draft directly from collapsed', () => {
    expect(nextSheetSnap('collapsed', true)).toBe('expanded');
    expect(nextSheetSnap('collapsed', false)).toBe('half');
    expect(nextSheetSnap('half', false)).toBe('expanded');
    expect(nextSheetSnap('expanded', true)).toBe('half');
  });

  it('snaps back after a small movement and follows a deliberate drag', () => {
    expect(resolveSheetSnap('half', -20)).toBe('half');
    expect(resolveSheetSnap('half', -60)).toBe('expanded');
    expect(resolveSheetSnap('half', 60)).toBe('collapsed');
  });

  it('recognises a short fast flick in either direction', () => {
    expect(resolveSheetSnap('collapsed', -12, -0.6)).toBe('half');
    expect(resolveSheetSnap('expanded', 12, 0.6)).toBe('half');
    expect(resolveSheetSnap('half', -12, -0.1)).toBe('half');
  });
});
