import type { Floor, OutreachSnapshot, Unit } from '../domain/types';

/** What the 樓層單位摘要 cell shows for a building whose floors are not declared yet. */
export const UNDECLARED_LAYOUT = '樓層／單位未核實';
const MAX_FLOORS = 100;
const MAX_UNITS_PER_FLOOR = 50;

/** One line per floor, in stored order: `1 樓：1樓 A室、1樓 B室`. */
export function layoutSummary(snapshot: OutreachSnapshot, buildingId: string): string {
  return snapshot.floors.filter(f => f.buildingId === buildingId)
    .map(f => `${f.label}：${snapshot.units.filter(u => u.floorId === f.id).map(u => u.label).join('、')}`).join('\n');
}

/** Blank or the placeholder: the person has not declared a layout. */
export function isUndeclaredLayout(text: string): boolean {
  const value = text.trim();
  return !value || value === UNDECLARED_LAYOUT;
}

export type LayoutParse = { floors: Floor[]; units: Unit[] } | { error: string };

/**
 * Read a layout the person typed for a building that has no floors yet.
 * Lines run from the lowest floor up, the same order the export writes them.
 * Nothing is guessed: an unreadable line rejects the whole cell.
 */
export function parseLayoutSummary(buildingId: string, text: string): LayoutParse {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > MAX_FLOORS) return { error: `最多 ${MAX_FLOORS} 層。` };
  const floors: Floor[] = [], units: Unit[] = [];
  const floorLabels = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const match = /^([^：:]*)[：:](.*)$/.exec(line);
    if (!match) return { error: `第 ${index + 1} 行「${line}」缺少冒號。請寫成「1 樓：1樓 A室、1樓 B室」，一行一層。` };
    const label = match[1].trim();
    if (!label) return { error: `第 ${index + 1} 行未寫樓層名稱。` };
    if (floorLabels.has(label)) return { error: `樓層「${label}」重複。` };
    floorLabels.add(label);
    const floor: Floor = { isSynthetic: true, provisional: true, id: `${buildingId}-f${index + 1}`, buildingId, level: index + 1, label };
    const unitLabels = match[2].split(/[、,，]/).map(item => item.trim()).filter(Boolean);
    if (unitLabels.length > MAX_UNITS_PER_FLOOR) return { error: `樓層「${label}」最多 ${MAX_UNITS_PER_FLOOR} 個單位。` };
    const seen = new Set<string>();
    for (const [unitIndex, unitLabel] of unitLabels.entries()) {
      if (seen.has(unitLabel)) return { error: `樓層「${label}」的單位「${unitLabel}」重複。` };
      seen.add(unitLabel);
      units.push({ isSynthetic: true, provisional: true, id: `${floor.id}-u${unitIndex + 1}`, buildingId, floorId: floor.id, label: unitLabel });
    }
    floors.push(floor);
  }
  // Lines are read bottom-up; numbered labels written top-down would stack the building upside down.
  const numbers = floors.map(f => /^-?\d+/.exec(f.label.replace(/^B/i, '-'))?.[0]).map(n => n === undefined ? undefined : Number(n));
  for (let i = 1; i < numbers.length; i++) {
    const [previous, current] = [numbers[i - 1], numbers[i]];
    if (previous !== undefined && current !== undefined && current <= previous) return { error: `請由最低一層開始，逐行向上填寫（「${floors[i - 1].label}」之後是「${floors[i].label}」）。` };
  }
  return { floors, units };
}
