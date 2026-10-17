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
/** The unit letters in column order, shared with the elevation's column headings. */
export const UNIT_LETTERS = LETTERS;
/**
 * "2樓 C1室" → "C1室": the floor the column already repeats is dropped, so a heading or a
 * ledger row says the unit and not the floor it is on. A label the floor is not part of
 * loses only its leading word instead.
 */
export const unitColumnLabel = (label: string, floorLabel?: string) => floorLabel && label.startsWith(floorLabel) && label.length > floorLabel.length ? label.slice(floorLabel.length).trim() : label.replace(/^\S+\s+/, "");
export const MAX_FLOORS = 100;
export const MAX_UNITS_PER_FLOOR = 50;
/** Most 劏房 rooms one unit may be divided into. One room means "put it back together". */
export const MAX_ROOMS = 20;

const freeId = (taken: Set<string>, make: (n: number) => string) => { for (let n = 1; ; n++) if (!taken.has(make(n))) return make(n); };
const byLabel = (a: Unit, b: Unit) => a.label.localeCompare(b.label, 'zh-Hant', { numeric: true });
const sorted = (list: Unit[]) => [...list].sort(byLabel);
/**
 * The rooms a move to `rooms` would drop. Rooms are dropped from the end, except at 1,
 * which is not "one room left" but "put it back together" — so every room goes.
 */
const roomsGoing = (existing: Unit[], rooms: number) => (rooms <= 1 ? existing : existing.slice(rooms));
const floorsOf = (s: OutreachSnapshot, buildingId: string) => s.floors.filter(f => f.buildingId === buildingId);

/** "12F" → "13F", "3 樓" → "4 樓", "G/F" → falls back to "N 樓". */
export function floorLabelFor(level: number, like?: string): string {
  if (like && /\d+/.test(like)) return like.replace(/-?\d+/, String(level));
  return `${level} 樓`;
}
/**
 * Letter part of "2樓 B室" → "B"; units the person named freely return undefined.
 *
 * Spacing is not part of a name: the district demo writes the floor 「1 樓」 and the unit on it
 * 「1樓 A室」, so matching the floor by its exact text left the floor in the unit's name, the
 * letter unreadable, and the unit taken for one named freely — laid out in a gap column, with
 * ＋ appending a new unit instead of filling the empty one, and a paper row unable to name it
 * (review, 2026-10-16).
 */
const letterOf = (unit: Unit, floor: Floor) => {
  const label = unit.label.replace(/\s+/g, ''), above = floor.label.replace(/\s+/g, '');
  return /^([A-Z])室?$/.exec(above && label.startsWith(above) ? label.slice(above.length) : label)?.[1];
};
/** What a unit's label puts before 「室」: 「1樓 A」 → 「1樓 」, 「A」 → 「」. */
const stemOf = (units: Unit[]) => sorted(units).map(u => /^(.*?)([A-Z])室$/.exec(u.label)?.[1]).find((stem): stem is string => stem !== undefined);
/**
 * How a new unit on this floor is spelled: the way the units already written there are, so it
 * reads like the ones beside it rather than like the floor label.
 *
 * The district demo writes the floor 「1 樓」 but the units on it 「1樓 A室」, so a name built from
 * the floor label alone puts 「1 樓 A室」 between them — one floor, two spellings, in the ledger
 * and the export as much as on screen (review, 2026-10-16). A floor with nothing to copy borrows
 * the rest of the same building's way of writing, with this floor's own number — never another
 * building's, whose 「1F A室」 would name a floor this one has not got — failing that, its label.
 */
const unitStem = (units: Unit[], floor: Floor) => {
  const stem = stemOf(units.filter(u => u.floorId === floor.id && !u.parentUnitId))
    ?? stemOf(units.filter(u => u.buildingId === floor.buildingId));
  if (stem === undefined) return `${floor.label} `;
  return /\d/.test(stem) ? stem.replace(/-?\d+/, String(floor.level)) : stem;
};

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
    const stem = unitStem(s.units, floor);
    for (let k = 0; k < unitsPerFloor; k++) {
      const uid = freeId(unitIds, n => `${id}-u${n}`); unitIds.add(uid);
      units.push({ ...flags, id: uid, buildingId, floorId: id, label: `${stem}${LETTERS[k]}室` });
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
  const stem = unitStem(s.units, floor);
  const label = letter ? `${stem}${letter}室` : `${stem}${onFloor.length + 1}號`;
  const id = freeId(new Set(s.units.map(u => u.id)), n => `${floorId}-u${n}`);
  return { snapshot: { ...s, units: [...s.units, { ...flags, id, buildingId: floor.buildingId, floorId, label }] } };
}

/**
 * Set how many 劏房 rooms a unit is divided into. 1 puts it back together: every room goes
 * — not all but one — and the unit keeps whatever was recorded before the split. Rooms are
 * added at the end and dropped from the end, so the rooms that stay keep their numbers.
 */
export function setRoomCount(s: OutreachSnapshot, unitId: string, rooms: number, confirmed = false): StructureResult {
  const unit = s.units.find(u => u.id === unitId);
  if (!unit) return { error: '找不到這個單位。' };
  if (unit.parentUnitId) return { error: '劏房間格不能再分拆，請選原本的單位。' };
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > MAX_ROOMS) return { error: `請填 1 至 ${MAX_ROOMS} 間（填 1 即合併回一個單位）。` };
  const existing = sorted(s.units.filter(u => u.parentUnitId === unitId));
  const going = roomsGoing(existing, rooms);
  if (going.length) {
    const plan = removalPlan(s, new Set(going.map(u => u.id)), new Set(), going.map(u => u.label).join('、'));
    if (plan.records && !confirmed) return { error: confirmText(plan) };
    return { snapshot: withoutPlaces(s, plan) };
  }
  // Nothing to take away: 1 asks for a merge and there is nothing to merge, or the count
  // is already what it is.
  if (rooms <= 1) return { error: '這個單位還沒有分拆。' };
  if (rooms === existing.length) return { error: `已經有 ${existing.length} 間，數目沒有改變。` };
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

/**
 * What the split form's button says for a count, given how many rooms the unit has now.
 * Beside `setRoomCount` so 1 meaning "put it back together" is written down once.
 */
export function roomCountAction(rooms: number, existing: number): '合併' | '更新' | '建立' {
  if (rooms === 1 && existing > 0) return '合併';
  return existing ? '更新' : '建立';
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

/**
 * A place that is going, and everything that goes with it.
 *
 * An observation names the floor and unit it was made at, and the snapshot is only valid
 * while those exist — so removing a place removes its records too. Any record citing one of
 * them goes as well: a correction of it, or the record that closed a follow-up raised there.
 * Left behind, those would point at a place that is no longer there.
 */
interface RemovalPlan {
  units: Set<string>; floors: Set<string>; observations: Set<string>; residences: number; places: string; records: number;
  /**
   * The part of the plan the elevation does not draw, and its own share of the records. A unit
   * split into 劏房 rooms is not on the elevation — only its rooms are — so a delete that takes
   * the unit takes something nobody can see. It is said on its own rather than mixed into the
   * count, which would read as records on the rooms that are on screen.
   */
  hidden?: { places: string; records: number };
}

const labelsOf = (s: OutreachSnapshot, ids: Set<string>) => s.units.filter(u => ids.has(u.id)).map(u => u.label).join('、');
/** The records left directly at these units, which is what a confirmation has to name. */
const recordsAt = (s: OutreachSnapshot, ids: Set<string>) =>
  s.observations.filter(o => o.unitId !== undefined && ids.has(o.unitId)).length
  + s.householdResidences.filter(r => r.unitId !== undefined && ids.has(r.unitId)).length;

function removalPlan(s: OutreachSnapshot, units: Set<string>, floors: Set<string>, places: string, hidden = new Set<string>()): RemovalPlan {
  const observations = new Set(s.observations
    .filter(o => (o.unitId !== undefined && units.has(o.unitId)) || (o.floorId !== undefined && floors.has(o.floorId)))
    .map(o => o.id));
  for (let grew = true; grew;) {
    grew = false;
    for (const o of s.observations) {
      if (observations.has(o.id)) continue;
      if ((o.correctsObservationId && observations.has(o.correctsObservationId)) || (o.resolvesObservationId && observations.has(o.resolvesObservationId))) { observations.add(o.id); grew = true; }
    }
  }
  const residences = s.householdResidences.filter(r => r.unitId !== undefined && units.has(r.unitId)).length;
  return {
    units, floors, observations, residences, places, records: observations.size + residences,
    hidden: hidden.size ? { places: labelsOf(s, hidden), records: recordsAt(s, hidden) } : undefined,
  };
}

/** The snapshot without the plan's places and their records. */
function withoutPlaces(s: OutreachSnapshot, plan: RemovalPlan): OutreachSnapshot {
  return {
    ...s,
    units: s.units.filter(u => !plan.units.has(u.id)),
    floors: s.floors.filter(f => !plan.floors.has(f.id)),
    observations: s.observations.filter(o => !plan.observations.has(o.id)),
    followUpEvents: s.followUpEvents?.filter(e => !plan.observations.has(e.observationId)),
    householdResidences: s.householdResidences.filter(r => r.unitId === undefined || !plan.units.has(r.unitId)),
  };
}

/**
 * What the confirmation says. It names the drawn places with their own records, and a unit the
 * elevation does not draw — a split one — separately, with its own count: the two are not the
 * same thing, and adding them together reads as records on cells that have none. A unit that is
 * not going is not mentioned at all, so its records are never counted in.
 */
const confirmText = (plan: RemovalPlan) => {
  const closing = '刪除會連同這些記錄一起刪除，請先確認。';
  const records = (places: string, count: number) => count ? `「${places}」有 ${count} 筆記錄` : `「${places}」沒有記錄`;
  if (!plan.hidden) return `${records(plan.places, plan.records)}，${closing}`;
  // Both sides are named even at zero, so the rooms going are on screen at the moment of the
  // decision rather than only the unit behind them.
  return `${records(plan.places, plan.records - plan.hidden.records)}；立面上沒有的${records(plan.hidden.places, plan.hidden.records)}，${closing}`;
};

/** The plan a change would need, or nothing when it removes no place at all. */
function planFor(s: OutreachSnapshot, change: StructureChange): RemovalPlan | undefined {
  switch (change.kind) {
    case 'removeFloor': {
      const floor = s.floors.find(f => f.id === change.floorId);
      if (!floor) return undefined;
      return removalPlan(s, new Set(s.units.filter(u => u.floorId === floor.id).map(u => u.id)), new Set([floor.id]), floor.label);
    }
    case 'removeUnits': {
      const going = s.units.filter(u => change.unitIds.includes(u.id) || (u.parentUnitId && change.unitIds.includes(u.parentUnitId)));
      if (!going.length) return undefined;
      const ids = new Set(going.map(u => u.id));
      // A unit with 劏房 rooms is not drawn: its rooms are, in its column. Taking it takes
      // something that is not on screen, which the confirmation has to say in its own words.
      const hidden = new Set(going.filter(u => s.units.some(r => r.parentUnitId === u.id)).map(u => u.id));
      return removalPlan(s, ids, new Set(), labelsOf(s, new Set([...ids].filter(id => !hidden.has(id)))), hidden);
    }
    case 'split': {
      const existing = sorted(s.units.filter(u => u.parentUnitId === change.unitId));
      if (!Number.isInteger(change.rooms) || change.rooms < 1 || change.rooms > MAX_ROOMS) return undefined;
      const going = roomsGoing(existing, change.rooms);
      if (!going.length) return undefined;
      return removalPlan(s, new Set(going.map(u => u.id)), new Set(), going.map(u => u.label).join('、'));
    }
    default: return undefined;
  }
}

/** What a change would destroy, in staff wording, when it would destroy anything. */
export function structureImpact(s: OutreachSnapshot, change: StructureChange): { label: string; records: number; confirmation: string } | undefined {
  const plan = planFor(s, change);
  return plan && plan.records ? { label: plan.places, records: plan.records, confirmation: confirmText(plan) } : undefined;
}

/* ------------------------------------------------------------------------- *
 * The copy a delete waits on.
 *
 * Records are only ever appended; a structure change that carries records away is the one
 * exception, and the workbook staff take first is what makes that exception recoverable.
 * So the delete does not go ahead on the strength of an intention to back up — it waits for
 * a download that actually happened, and a download the browser refused blocks it outright.
 * Nothing but a successful attempt opens the gate (review, 2026-10-15).
 * ------------------------------------------------------------------------- */

/** Where the copy stands: not asked for yet, being prepared, taken, or refused by the browser. */
export type BackupAttempt = 'IDLE' | 'WORKING' | 'DONE' | 'FAILED';

/** What the confirmation offers, and what it says while it waits. */
export interface BackupGate { allowed: boolean; note: string }

export function deleteGate(attempt: BackupAttempt): BackupGate {
  switch (attempt) {
    case 'DONE': return { allowed: true, note: '備份已下載，可以刪除。' };
    case 'WORKING': return { allowed: false, note: '正在準備備份…' };
    case 'FAILED': return { allowed: false, note: '備份下載失敗，未刪除任何記錄。請重試，或取消。' };
    default: return { allowed: false, note: '這是「只追加」的例外：先下載當前 Excel 備份，才可以連記錄一併刪除。' };
  }
}

/**
 * Remove a unit and its 劏房 rooms. Anything recorded there goes with them, which the caller
 * has to have asked about first: without `confirmed` this refuses and says what is at stake.
 */
export function removeUnit(s: OutreachSnapshot, unitId: string, confirmed = false): StructureResult {
  if (!s.units.some(u => u.id === unitId)) return { error: '找不到這個單位。' };
  // Through `planFor`, so a single unit and a picked set take exactly the same things and the
  // same words describe both — including which of them the elevation does not draw.
  const plan = planFor(s, { kind: 'removeUnits', unitIds: [unitId] });
  if (!plan) return { error: '找不到這個單位。' };
  if (plan.records && !confirmed) return { error: confirmText(plan) };
  return { snapshot: withoutPlaces(s, plan) };
}

/** Remove a floor and its units. As with a unit, records need confirming first. */
export function removeFloor(s: OutreachSnapshot, floorId: string, confirmed = false): StructureResult {
  const floor = s.floors.find(f => f.id === floorId);
  if (!floor) return { error: '找不到這一層。' };
  const plan = removalPlan(s, new Set(s.units.filter(u => u.floorId === floorId).map(u => u.id)), new Set([floorId]), floor.label);
  if (plan.records && !confirmed) return { error: confirmText(plan) };
  const dropped = withoutPlaces(s, plan);
  return { snapshot: withBuilding(dropped, floor.buildingId, dropped.floors, dropped.units) };
}

/** Units of a floor in display order: each unit followed by its rooms. */
export function floorUnitGroups(s: OutreachSnapshot, floorId: string): { unit: Unit; rooms: Unit[] }[] {
  const all = s.units.filter(u => u.floorId === floorId);
  const sort = (list: Unit[]) => list.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant', { numeric: true }));
  return sort(all.filter(u => !u.parentUnitId)).map(unit => ({ unit, rooms: sort(all.filter(r => r.parentUnitId === unit.id)) }));
}

/**
 * The column a unit sits in: the index of its letter among the unit letters, or undefined when
 * its label is not a plain letter (a "N號" fallback, or a name staff typed freely). I and O are
 * never unit letters, so a label that spells one is also treated as free-form.
 */
export function unitColumn(unit: Unit, floor: Floor): number | undefined {
  const letter = letterOf(unit, floor);
  return letter && LETTERS.includes(letter) ? LETTERS.indexOf(letter) : undefined;
}

/**
 * How many columns a floor needs: enough for every one of its units to have a column of its
 * own, zero when it has none. That is its widest lettered column, plus one for each unit that
 * cannot sit in a lettered one — a "N號" fallback, a name staff typed freely, or a second unit
 * sharing an already-taken letter.
 */
export function floorColumnCount(s: OutreachSnapshot, floorId: string): number {
  const floor = s.floors.find(f => f.id === floorId);
  const taken = new Set<number>();
  let extras = 0;
  for (const group of floorUnitGroups(s, floorId)) {
    const column = floor ? unitColumn(group.unit, floor) : undefined;
    if (column !== undefined && !taken.has(column)) taken.add(column);
    else extras++;
  }
  return (taken.size ? Math.max(...taken) + 1 : 0) + extras;
}

/**
 * A floor's units placed in fixed letter columns: A is column 0, B column 1, and so on, with a
 * deleted letter left empty so the units around it keep their positions instead of sliding into
 * it. Units whose label is not a plain letter take the leftmost column still free, in label
 * order — the same gap the ＋ button fills. `width` columns are returned so every floor of the
 * building shares the same grid.
 *
 * The letters go down first and the rest afterwards, because a letter belongs in its own column
 * and must never be written over: 「1號舖」 sorts before 「A室」, and a single pass would put it in
 * column 0 and then let A take that column away from it — the unit would still be in the
 * snapshot, with its records, but nothing on the elevation would reach it (review, 2026-10-16).
 */
export function floorUnitColumns(s: OutreachSnapshot, floorId: string, width: number): ({ unit: Unit; rooms: Unit[] } | undefined)[] {
  const floor = s.floors.find(f => f.id === floorId);
  const cells = new Array<{ unit: Unit; rooms: Unit[] } | undefined>(width).fill(undefined);
  const rest: { unit: Unit; rooms: Unit[] }[] = [];
  for (const group of floorUnitGroups(s, floorId)) {
    const column = floor ? unitColumn(group.unit, floor) : undefined;
    if (column !== undefined && column < width && !cells[column]) { cells[column] = group; continue; }
    rest.push(group);
  }
  let next = 0;
  for (const group of rest) {
    while (next < width && cells[next]) next++;
    if (next >= width) break;
    cells[next] = group;
    next++;
  }
  return cells;
}

/**
 * The place a floor's 「－」 takes away: the last cell the elevation actually draws.
 *
 * Not "the unit in the last column" — a unit that has been split into 劏房 rooms is not drawn,
 * only its rooms are, so that would be the invisible parent and one press would take the whole
 * group and the records under the original unit with it. What sits beside ＋ answers for what
 * ＋ can put there, which is one drawn cell (review, 2026-10-16).
 */
export function lastDrawnUnit(cells: ({ unit: Unit; rooms: Unit[] } | undefined)[]): Unit | undefined {
  const group = cells.filter((cell): cell is { unit: Unit; rooms: Unit[] } => cell !== undefined).at(-1);
  if (!group) return undefined;
  return group.rooms.length ? group.rooms.at(-1) : group.unit;
}

/**
 * The heading over each column of the elevation, named by what the column holds.
 *
 * A column is named by the letter of the unit sitting in it, so a floor missing B keeps C's
 * column under C. A building whose units are not lettered — 「1室、2室、3室」, or a floor with a
 * 1號舖 on it — has no letter for that column, so it is named by the unit that is there.
 * Printing A over a column of 1室 would name a unit the building has not got; plenty of Hong
 * Kong buildings number their units rather than letter them. `width` headings are returned so
 * every floor of the building shares the same grid.
 */
export function floorHeadings(s: OutreachSnapshot, floors: Floor[], width: number): string[] {
  const grid = floors.map(floor => ({ floor, cells: floorUnitColumns(s, floor.id, width) }));
  const headings: string[] = [];
  for (let column = 0; column < width; column++) {
    let named: string | undefined;
    let letter: string | undefined;
    for (const { floor, cells } of grid) {
      const cell = cells[column];
      if (!cell) continue;
      const at = unitColumn(cell.unit, floor);
      // Any floor lettered in this column names it for all of them: the columns exist so a
      // letter keeps its place, and a column is only letter-less when nothing lettered is in it.
      if (at !== undefined) { letter = UNIT_LETTERS[at]; break; }
      named ??= unitColumnLabel(cell.unit.label, floor.label);
    }
    headings.push(letter ?? named ?? '');
  }
  return headings;
}

/**
 * `confirmed` says a person has already been told which records would go with the removal.
 * Without it the change refuses rather than quietly discarding them.
 */
export type StructureChange =
  | { kind: 'addFloors'; buildingId: string; count: number; unitsPerFloor: number }
  | { kind: 'addUnit'; floorId: string }
  | { kind: 'removeFloor'; floorId: string; confirmed?: boolean }
  | { kind: 'removeUnits'; unitIds: string[]; confirmed?: boolean }
  | { kind: 'split'; unitId: string; rooms: number; confirmed?: boolean }
  | { kind: 'noSubdivision'; unitIds: string[]; confirm: boolean };

/** One entry point for the UI: apply a change and say what happened, in staff wording. */
export function applyStructureChange(s: OutreachSnapshot, change: StructureChange, actor: StructureActor): { snapshot: OutreachSnapshot; message: string } | { error: string } {
  const done = (r: StructureResult, message: string) => ('error' in r ? r : { snapshot: r.snapshot, message });
  // What the change destroys, counted before it happens so the message can say it.
  const impact = structureImpact(s, change);
  const alsoDeleted = impact ? `，連同 ${impact.records} 筆記錄已一併刪除。` : '';
  switch (change.kind) {
    case 'addFloors': return done(addFloors(s, change.buildingId, change.count, change.unitsPerFloor), `已新增 ${change.count} 層。`);
    case 'addUnit': return done(addUnit(s, change.floorId), '已加一個單位。');
    case 'removeFloor': return done(removeFloor(s, change.floorId, change.confirmed), `已刪除「${s.floors.find(f => f.id === change.floorId)?.label ?? '這一層'}」${alsoDeleted || '。'}`);
    case 'split': {
      const before = s.units.filter(u => u.parentUnitId === change.unitId).length;
      const message = change.rooms === 1 ? `已合併回一個單位${alsoDeleted || '。'}` : before ? `已改為 ${change.rooms} 間劏房${alsoDeleted || '。'}` : `已分拆為 ${change.rooms} 間劏房。`;
      return done(setRoomCount(s, change.unitId, change.rooms, change.confirmed), message);
    }
    case 'removeUnits': {
      let next = s;
      let removed = 0;
      for (const id of change.unitIds) {
        if (!next.units.some(u => u.id === id)) continue; // already gone with its parent
        const r = removeUnit(next, id, change.confirmed);
        if ('error' in r) return { error: `${s.units.find(u => u.id === id)?.label ?? id}：${r.error}` };
        // Counted off the snapshot, not off what was asked for: an id that named nothing takes
        // nothing, and a split unit takes its rooms with it. Saying the number asked for would
        // report units that are still there (review, 2026-10-16).
        removed += next.units.length - r.snapshot.units.length;
        next = r.snapshot;
      }
      return { snapshot: next, message: `已刪除 ${removed} 個單位${alsoDeleted || '。'}` };
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
  // The name the unit would be given is the name the step below promises, so both take the
  // spelling the floor's units already use rather than the floor label's.
  const parentLabel = `${unitStem(s.units, floor ?? { ...flags, id: `${buildingId}-f${level}`, buildingId, level, label: floorLabel })}${unit.letter}室`;
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
      const parentName = `${unitStem(next.units, t)}${unit.letter}室`;
      let p = next.units.find(u => u.floorId === t.id && !u.parentUnitId && (u.label === parentName || letterOf(u, t) === unit.letter));
      if (!p) {
        p = { ...flags, id: freeId(ids(next.units), n => `${t.id}-u${n}`), buildingId, floorId: t.id, label: parentName };
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
