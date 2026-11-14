export type MobileSheetSnap = 'collapsed' | 'half' | 'expanded';

const snaps: MobileSheetSnap[] = ['collapsed', 'half', 'expanded'];

export function moveSheetSnap(snap: MobileSheetSnap, direction: -1 | 1): MobileSheetSnap {
  return snaps[Math.max(0, Math.min(snaps.length - 1, snaps.indexOf(snap) + direction))];
}

/** A short flick or a deliberate drag moves one stop; small movements snap back. */
export function resolveSheetSnap(snap: MobileSheetSnap, deltaY: number, velocityY = 0): MobileSheetSnap {
  if (deltaY <= -48 || (deltaY < -8 && velocityY <= -0.45)) return moveSheetSnap(snap, 1);
  if (deltaY >= 48 || (deltaY > 8 && velocityY >= 0.45)) return moveSheetSnap(snap, -1);
  return snap;
}

export function nextSheetSnap(snap: MobileSheetSnap, editing: boolean): MobileSheetSnap {
  if (snap === 'collapsed') return editing ? 'expanded' : 'half';
  if (snap === 'half') return 'expanded';
  return 'half';
}
