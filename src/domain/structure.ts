/**
 * Experimental: edit a building's floors and units in the UI instead of the Excel cell.
 * Pure functions; each returns a new snapshot or a refusal in staff wording. Nothing here
 * touches observations — anything with records is never removed.
 */
import type { Floor, OutreachSnapshot, Unit } from './types';

export type StructureResult = { snapshot: OutreachSnapshot } | { error: string };
export interface StructureActor { at: string; by?: string }
const flags = { isSynthetic: true, provisional: true } as const;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I and O look like 1 and 0 on paper
export const MAX_FLOORS = 100;
export const MAX_UNITS_PER_FLOOR = 50;

const freeId = (taken: Set<string>, make: (n: number) => string) => { for (let n = 1; ; n++) if (!taken.has(make(n))) return make(n); };
const floorsOf = (s: OutreachSnapshot, buildingId: string) => s.floors.filter(f => f.buildingId === buildingId);

/** "12F" → "13F", "3 樓" → "4 樓", "G/F" → falls back to "N 樓". */
export function floorLabelFor(level: number, like?: string): string {
  if (like && /\d+/.test(like)) return like.replace(/-?\d+/, String(level));
  return `${level} 樓`;
}
/** Letter part of "2樓 B室" → "B"; units the person named freely return undefined. */
const letterOf = (unit: Unit, floor: Floor) => /^\s*([A-Z])室?\s*$/.exec(unit.label.replace(floor.label, ''))?.[1];
const unitLabel = (floor: Floor, letter: string) => `${floor.label} ${letter}室`;

function withBuilding(s: OutreachSnapshot, buildingId: string, floors: Floor[], units: Unit[]): OutreachSnapshot {
  const count = floors.filter(f => f.buildingId === buildingId).length;
  return { ...s, floors, units, buildings: s.buildings.map(b => b.id !== buildingId ? b : { ...b, layoutDeclared: count > 0, floorCount: count || undefined }) };
}

/** Add `count` floors above the top floor, each with `unitsPerFloor` lettered units. */
export function addFloors(s: OutreachSnapshot, buildingId: string, count: number, unitsPerFloor: number): StructureResult {
  if (!s.buildings.some(b => b.id === buildingId)) return { error: '找不到這幢大廈。' };
  if (!Number.isInteger(count) || count < 1) return { error: '請填要新增多少層（至少 1 層）。' };
  if (!Number.isInteger(unitsPerFloor) || unitsPerFloor < 0 || unitsPerFloor > LETTERS.length) return { error: `每層單位數要在 0 至 ${LETTERS.length} 之間。` };
  const existing = floorsOf(s, buildingId);
  if (existing.length + count > MAX_FLOORS) return { error: `一幢最多 ${MAX_FLOORS} 層。` };
  const top = existing.reduce<Floor | undefined>((a, f) => (!a || f.level > a.level ? f : a), undefined);
  const floorIds = new Set(s.floors.map(f => f.id)), unitIds = new Set(s.units.map(u => u.id));
  const floors = [...s.floors], units = [...s.units];
  for (let i = 1; i <= count; i++) {
    const level = (top?.level ?? 0) + i;
    const id = freeId(floorIds, n => `${buildingId}-f${n}`); floorIds.add(id);
    const floor: Floor = { ...flags, id, buildingId, level, label: floorLabelFor(level, top?.label) };
    floors.push(floor);
    for (let k = 0; k < unitsPerFloor; k++) {
      const uid = freeId(unitIds, n => `${id}-u${n}`); unitIds.add(uid);
      units.push({ ...flags, id: uid, buildingId, floorId: id, label: unitLabel(floor, LETTERS[k]) });
    }
  }
  return { snapshot: withBuilding(s, buildingId, floors, units) };
}

/** Add one unit to a floor, taking the next free letter. */
export function addUnit(s: OutreachSnapshot, floorId: string): StructureResult {
  const floor = s.floors.find(f => f.id === floorId);
  if (!floor) return { error: '找不到這一層。' };
  const onFloor = s.units.filter(u => u.floorId === floorId && !u.parentUnitId);
  if (onFloor.length >= MAX_UNITS_PER_FLOOR) return { error: `一層最多 ${MAX_UNITS_PER_FLOOR} 個單位。` };
  const used = new Set(onFloor.map(u => letterOf(u, floor)));
  const letter = [...LETTERS].find(l => !used.has(l));
  const label = letter ? unitLabel(floor, letter) : `${floor.label} ${onFloor.length + 1}號`;
  const id = freeId(new Set(s.units.map(u => u.id)), n => `${floorId}-u${n}`);
  return { snapshot: { ...s, units: [...s.units, { ...flags, id, buildingId: floor.buildingId, floorId, label }] } };
}

/** "2樓 A室" split in 3 → "2樓 A1室", "2樓 A2室", "2樓 A3室". The unit itself stays, with its records. */
export function splitUnit(s: OutreachSnapshot, unitId: string, rooms: number): StructureResult {
  const unit = s.units.find(u => u.id === unitId);
  if (!unit) return { error: '找不到這個單位。' };
  if (unit.parentUnitId) return { error: '劏房間格不能再分拆，請選原本的單位。' };
  if (!Number.isInteger(rooms) || rooms < 2 || rooms > 20) return { error: '請填 2 至 20 間。' };
  const existing = s.units.filter(u => u.parentUnitId === unitId);
  const stem = unit.label.replace(/室$/, '');
  const ids = new Set(s.units.map(u => u.id)), labels = new Set(existing.map(u => u.label));
  const added: Unit[] = [];
  for (let n = 1; added.length < rooms - existing.length; n++) {
    const label = `${stem}${n}室`;
    if (labels.has(label)) continue;
    const id = freeId(ids, k => `${unitId}-s${k}`); ids.add(id);
    added.push({ ...flags, id, buildingId: unit.buildingId, floorId: unit.floorId, label, parentUnitId: unitId });
  }
  if (!added.length) return { error: `已經有 ${existing.length} 間，數目沒有改變。` };
  // A split unit cannot also be confirmed free of subdivision.
  const units = s.units.map(u => u.id === unitId && u.noSubdivision ? { ...u, noSubdivision: undefined } : u);
  return { snapshot: { ...s, units: [...units, ...added] } };
}

/** Confirm (or withdraw) "no subdivided rooms" on many units at once. Split units are skipped and counted. */
export function setNoSubdivision(s: OutreachSnapshot, unitIds: string[], confirm: boolean, actor: StructureActor) {
  const chosen = new Set(unitIds);
  const split = new Set(s.units.filter(u => u.parentUnitId).map(u => u.parentUnitId!));
  let changed = 0, skipped = 0;
  const units = s.units.map(u => {
    if (!chosen.has(u.id)) return u;
    if (confirm && (split.has(u.id) || u.parentUnitId)) { skipped++; return u; }
    if (confirm === !!u.noSubdivision) return u;
    changed++;
    return confirm ? { ...u, noSubdivision: { at: actor.at, by: actor.by } } : { ...u, noSubdivision: undefined };
  });
  return { snapshot: changed ? { ...s, units } : s, changed, skipped };
}

const hasRecords = (s: OutreachSnapshot, test: (ref: { floorId?: string; unitId?: string }) => boolean) =>
  s.observations.some(test) || s.householdResidences.some(r => test({ unitId: r.unitId }));

/** Remove a unit with no records (and its rooms, if none of them has records either). */
export function removeUnit(s: OutreachSnapshot, unitId: string): StructureResult {
  const ids = new Set([unitId, ...s.units.filter(u => u.parentUnitId === unitId).map(u => u.id)]);
  if (hasRecords(s, r => !!r.unitId && ids.has(r.unitId))) return { error: '這個單位（或其劏房）已有記錄，不能刪除。' };
  return { snapshot: { ...s, units: s.units.filter(u => !ids.has(u.id)) } };
}

/** Remove a floor with no records anywhere on it. */
export function removeFloor(s: OutreachSnapshot, floorId: string): StructureResult {
  const floor = s.floors.find(f => f.id === floorId);
  if (!floor) return { error: '找不到這一層。' };
  const unitIds = new Set(s.units.filter(u => u.floorId === floorId).map(u => u.id));
  if (hasRecords(s, r => r.floorId === floorId || (!!r.unitId && unitIds.has(r.unitId)))) return { error: `「${floor.label}」已有記錄，不能刪除。` };
  return { snapshot: withBuilding(s, floor.buildingId, s.floors.filter(f => f.id !== floorId), s.units.filter(u => u.floorId !== floorId)) };
}

/** Units of a floor in display order: each unit followed by its rooms. */
export function floorUnitGroups(s: OutreachSnapshot, floorId: string): { unit: Unit; rooms: Unit[] }[] {
  const all = s.units.filter(u => u.floorId === floorId);
  const sort = (list: Unit[]) => list.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant', { numeric: true }));
  return sort(all.filter(u => !u.parentUnitId)).map(unit => ({ unit, rooms: sort(all.filter(r => r.parentUnitId === unit.id)) }));
}

export type StructureChange =
  | { kind: 'addFloors'; buildingId: string; count: number; unitsPerFloor: number }
  | { kind: 'addUnit'; floorId: string }
  | { kind: 'removeFloor'; floorId: string }
  | { kind: 'removeUnits'; unitIds: string[] }
  | { kind: 'split'; unitId: string; rooms: number }
  | { kind: 'noSubdivision'; unitIds: string[]; confirm: boolean };

/** One entry point for the UI: apply a change and say what happened, in staff wording. */
export function applyStructureChange(s: OutreachSnapshot, change: StructureChange, actor: StructureActor): { snapshot: OutreachSnapshot; message: string } | { error: string } {
  const done = (r: StructureResult, message: string) => ('error' in r ? r : { snapshot: r.snapshot, message });
  switch (change.kind) {
    case 'addFloors': return done(addFloors(s, change.buildingId, change.count, change.unitsPerFloor), `已新增 ${change.count} 層。`);
    case 'addUnit': return done(addUnit(s, change.floorId), '已加一個單位。');
    case 'removeFloor': return done(removeFloor(s, change.floorId), '已刪除這一層。');
    case 'split': return done(splitUnit(s, change.unitId, change.rooms), `已分拆為 ${change.rooms} 間劏房。`);
    case 'removeUnits': {
      let next = s;
      for (const id of change.unitIds) {
        if (!next.units.some(u => u.id === id)) continue; // already gone with its parent
        const r = removeUnit(next, id);
        if ('error' in r) return { error: `${s.units.find(u => u.id === id)?.label ?? id}：${r.error}` };
        next = r.snapshot;
      }
      return { snapshot: next, message: `已刪除 ${change.unitIds.length} 個單位。` };
    }
    case 'noSubdivision': {
      const r = setNoSubdivision(s, change.unitIds, change.confirm, actor);
      if (!r.changed) return { error: r.skipped ? '選取的單位已分拆為劏房，不能確認無劏房。' : '沒有需要更改的單位。' };
      return { snapshot: r.snapshot, message: `${change.confirm ? '已確認' : '已取消'} ${r.changed} 個單位${change.confirm ? '無劏房' : '的無劏房確認'}。${r.skipped ? `略過 ${r.skipped} 個已分拆的單位。` : ''}` };
    }
  }
}

/**
 * Semi-agent: the paper names a floor or unit the building does not have yet.
 * Read only plain forms ("5樓", "5/F", "B", "B1室"); anything else gets no proposal
 * (never guess). The proposal lists its steps for a person to accept; nothing is
 * changed until `apply` is called.
 */
export interface LocationProposal { label: string; steps: string[]; apply: (s: OutreachSnapshot) => { snapshot: OutreachSnapshot; unitId: string } | { error: string } }
const plain = (value?: string | null) => (value ?? '').trim().toUpperCase().replace(/[\s·・]/g, '');
export function readPaperFloor(text?: string | null): number | undefined {
  const m = /^(\d{1,3})(?:\/?F|樓|層|字樓)?$/.exec(plain(text));
  return m ? Number(m[1]) : undefined;
}
export function readPaperUnit(text?: string | null, floorText?: string | null): { letter: string; room?: number } | undefined {
  let value = plain(text);
  const floor = plain(floorText);
  if (floor && value.startsWith(floor)) value = value.slice(floor.length);
  value = value.replace(/^(\d{1,3})(?:\/?F|樓|層)/, '').replace(/(室|房|號)$/, '');
  const m = /^([A-Z])(\d{1,2})?$/.exec(value);
  return m ? { letter: m[1], room: m[2] ? Number(m[2]) : undefined } : undefined;
}

export function proposeLocation(s: OutreachSnapshot, buildingId: string, floorText?: string | null, unitText?: string | null): LocationProposal | undefined {
  const building = s.buildings.find(b => b.id === buildingId);
  const level = readPaperFloor(floorText), unit = readPaperUnit(unitText, floorText);
  if (!building || level === undefined || level < 1 || level > MAX_FLOORS || !unit) return undefined;
  const floors = floorsOf(s, buildingId);
  const floor = floors.find(f => f.level === level);
  const floorLabel = floor?.label ?? floorLabelFor(level, floors[0]?.label);
  const parentLabel = `${floorLabel} ${unit.letter}室`;
  const parent = floor && s.units.find(u => u.floorId === floor.id && !u.parentUnitId && (u.label === parentLabel || letterOf(u, floor) === unit.letter));
  const stem = (parent?.label ?? parentLabel).replace(/室$/, '');
  const roomLabel = unit.room !== undefined ? `${stem}${unit.room}室` : undefined;
  const room = parent && roomLabel ? s.units.find(u => u.parentUnitId === parent.id && u.label === roomLabel) : undefined;
  const steps = [
    !floor && `新增「${floorLabel}」`,
    !parent && `在${floorLabel}新增「${parentLabel}」`,
    roomLabel && !room && `把「${parent?.label ?? parentLabel}」分出劏房「${roomLabel}」`,
  ].filter((x): x is string => !!x);
  if (!steps.length) return undefined;
  return {
    label: roomLabel ?? parentLabel, steps,
    apply: current => {
      const ids = (list: { id: string }[]) => new Set(list.map(x => x.id));
      let next = current;
      let target = floorsOf(next, buildingId).find(f => f.level === level);
      if (!target) {
        if (floorsOf(next, buildingId).length >= MAX_FLOORS) return { error: `一幢最多 ${MAX_FLOORS} 層。` };
        const id = freeId(ids(next.floors), n => `${buildingId}-f${n}`);
        target = { ...flags, id, buildingId, level, label: floorLabel };
        next = withBuilding(next, buildingId, [...next.floors, target], next.units);
      }
      const t = target;
      let p = next.units.find(u => u.floorId === t.id && !u.parentUnitId && (u.label === parentLabel || letterOf(u, t) === unit.letter));
      if (!p) {
        p = { ...flags, id: freeId(ids(next.units), n => `${t.id}-u${n}`), buildingId, floorId: t.id, label: `${t.label} ${unit.letter}室` };
        next = { ...next, units: [...next.units, p] };
      }
      if (unit.room === undefined) return { snapshot: next, unitId: p.id };
      const parentUnit = p;
      const label = `${parentUnit.label.replace(/室$/, '')}${unit.room}室`;
      const existing = next.units.find(u => u.parentUnitId === parentUnit.id && u.label === label);
      if (existing) return { snapshot: next, unitId: existing.id };
      const roomUnit: Unit = { ...flags, id: freeId(ids(next.units), k => `${parentUnit.id}-s${k}`), buildingId, floorId: t.id, label, parentUnitId: parentUnit.id };
      // A unit with a room is no longer "confirmed not subdivided".
      next = { ...next, units: [...next.units.map(u => u.id === parentUnit.id && u.noSubdivision ? { ...u, noSubdivision: undefined } : u), roomUnit] };
      return { snapshot: next, unitId: roomUnit.id };
    },
  };
}

/** The unit the paper names, when the building already has it. Same reading rules as `proposeLocation`. */
export function findPaperLocation(s: OutreachSnapshot, buildingId: string, floorText?: string | null, unitText?: string | null): string | undefined {
  const level = readPaperFloor(floorText), unit = readPaperUnit(unitText, floorText);
  if (level === undefined || !unit) return undefined;
  const floor = floorsOf(s, buildingId).find(f => f.level === level);
  const parent = floor && s.units.find(u => u.floorId === floor.id && !u.parentUnitId && letterOf(u, floor) === unit.letter);
  if (!parent || unit.room === undefined) return parent?.id;
  const label = `${parent.label.replace(/室$/, '')}${unit.room}室`;
  return s.units.find(u => u.parentUnitId === parent.id && u.label === label)?.id;
}
