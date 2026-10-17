import { describe, expect, it } from 'vitest';
import { districtDemo } from '../data/districtDemo';
import { workflowDemo } from '../data/workflowDemo';
import { addBuilding } from '../data/newBuilding';
import { blankSnapshot } from '../data/blankSnapshot';
import { exportWorkflowWorkbook, parseWorkflowWorkbook } from '../data/workflowWorkbook';
import { validateSnapshot } from './schema';
import { applyStructureChange, deleteGate, findPaperLocation, floorColumnCount, floorHeadings, floorUnitColumns, floorUnitGroups, lastDrawnUnit, proposeLocation, roomCountAction, structureImpact, unitColumn, UNIT_LETTERS, type StructureChange } from './structure';
import type { OutreachSnapshot } from './types';

const actor = { at: '2026-10-10T08:00:00.000Z', by: '測試同事' };
const start = () => { const r = addBuilding(blankSnapshot(), { id: 'SYP-001', name: '新大廈', address: '第三街 1 號', coordinates: { lng: 114.14, lat: 22.2867 } }); if ('error' in r) throw new Error(r.error); return r.snapshot; };
const apply = (s: OutreachSnapshot, change: StructureChange) => { const r = applyStructureChange(s, change, actor); if ('error' in r) throw new Error(r.error); validateSnapshot(r.snapshot); return r.snapshot; };
const flags = { isSynthetic: true as const, provisional: true as const };
/** A unit split in two, with a record on the second room — what merging has to ask about. */
const withRoomRecord = () => {
  let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 1 });
  s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 2 });
  const room = s.units.find(u => u.label === '1 樓 A2室')!;
  const at = '2026-10-10T09:00:00+08:00';
  const next: OutreachSnapshot = {
    ...s,
    visits: [{ ...flags, id: 'visit-1', occurredAt: at, recordedAt: at, workerName: '測試同事' }],
    observations: [{ ...flags, id: 'observation-1', visitId: 'visit-1', buildingId: 'SYP-001', floorId: room.floorId, unitId: room.id, occurredAt: at, recordedAt: at, workerName: '測試同事', coverage: 'VISITED_NO_FINDING', evidence: [] }],
  };
  validateSnapshot(next);
  return next;
};

describe('experimental structure editing', () => {
  it('adds floors with lettered units on an empty building', () => {
    const s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 3, unitsPerFloor: 4 });
    expect(s.floors.map(f => f.label)).toEqual(['1 樓', '2 樓', '3 樓']);
    expect(s.units.filter(u => u.floorId === s.floors[2].id).map(u => u.label)).toEqual(['3 樓 A室', '3 樓 B室', '3 樓 C室', '3 樓 D室']);
    expect(s.buildings[0]).toMatchObject({ layoutDeclared: true, floorCount: 3 });
  });
  it('continues an existing building\'s floor naming', () => {
    const building = workflowDemo.buildings[0];
    const top = workflowDemo.floors.filter(f => f.buildingId === building.id).sort((a, b) => b.level - a.level)[0];
    const s = apply(workflowDemo, { kind: 'addFloors', buildingId: building.id, count: 1, unitsPerFloor: 2 });
    expect(s.floors.at(-1)).toMatchObject({ level: top.level + 1, label: top.label.replace(/\d+/, String(top.level + 1)) });
  });
  it('adds a unit with the next free letter', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 2 });
    s = apply(s, { kind: 'addUnit', floorId: s.floors[0].id });
    expect(s.units.map(u => u.label)).toEqual(['1 樓 A室', '1 樓 B室', '1 樓 C室']);
  });
  it('keeps the other units in place after a delete, and reuses the gap when adding', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 4 });
    const floorId = s.floors[0].id;
    const a = s.units.find(u => u.label === '1 樓 A室')!;
    s = apply(s, { kind: 'removeUnits', unitIds: [a.id] });
    // B, C, D stay in their own columns; A's column is left empty rather than being closed up.
    expect(floorUnitColumns(s, floorId, 4).map(cell => cell?.unit.label)).toEqual([undefined, '1 樓 B室', '1 樓 C室', '1 樓 D室']);
    // Adding again fills the leftmost gap (A) before anything new is appended to the right.
    s = apply(s, { kind: 'addUnit', floorId });
    expect(floorUnitColumns(s, floorId, 4).map(cell => cell?.unit.label)).toEqual(['1 樓 A室', '1 樓 B室', '1 樓 C室', '1 樓 D室']);
  });
  it('splits a unit into 劏房 rooms that share its column', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 2 });
    s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 3 });
    const groups = floorUnitGroups(s, s.floors[0].id);
    expect(groups.map(g => [g.unit.label, g.rooms.map(r => r.label)])).toEqual([['1 樓 A室', ['1 樓 A1室', '1 樓 A2室', '1 樓 A3室']], ['1 樓 B室', []]]);
    expect(applyStructureChange(s, { kind: 'split', unitId: groups[0].rooms[0].id, rooms: 2 }, actor)).toHaveProperty('error');
  });
  it('batch-confirms no subdivision, skipping split units, and can withdraw it', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 2, unitsPerFloor: 3 });
    s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 2 });
    const all = s.units.map(u => u.id);
    const r = applyStructureChange(s, { kind: 'noSubdivision', unitIds: all, confirm: true }, actor);
    if ('error' in r) throw new Error(r.error);
    expect(r.message).toContain('已確認 5 個單位無劏房');
    expect(r.message).toContain('略過 3 個');
    expect(r.snapshot.units.filter(u => u.noSubdivision)).toHaveLength(5);
    expect(r.snapshot.units.find(u => u.noSubdivision)!.noSubdivision).toEqual(actor);
    const back = apply(r.snapshot, { kind: 'noSubdivision', unitIds: all, confirm: false });
    expect(back.units.some(u => u.noSubdivision)).toBe(false);
  });
  it('splitting clears an earlier no-subdivision confirmation', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 1 });
    s = apply(s, { kind: 'noSubdivision', unitIds: [s.units[0].id], confirm: true });
    s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 2 });
    expect(s.units[0].noSubdivision).toBeUndefined();
  });
  it('merges 劏房 back into one unit when the count is set to 1', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 1 });
    s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 3 });
    const r = applyStructureChange(s, { kind: 'split', unitId: s.units[0].id, rooms: 1 }, actor);
    if ('error' in r) throw new Error(r.error);
    expect(r.message).toContain('已合併');
    expect(r.snapshot.units).toHaveLength(1);
    validateSnapshot(r.snapshot);
    // One room left is also put back together, rather than left with one behind.
    s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 1 });
    expect(s.units).toHaveLength(1);
  });
  it('drops the highest-numbered rooms when the count goes down, keeping the rest', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 1 });
    s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 3 });
    s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 2 });
    expect(s.units.filter(u => u.parentUnitId).map(u => u.label)).toEqual(['1 樓 A1室', '1 樓 A2室']);
  });
  it('refuses a room count that is not a change, or is out of range', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 1 });
    const unitId = s.units[0].id;
    expect(applyStructureChange(s, { kind: 'split', unitId, rooms: 1 }, actor)).toHaveProperty('error');
    s = apply(s, { kind: 'split', unitId, rooms: 2 });
    for (const rooms of [2, 0, 21, 1.5]) expect(applyStructureChange(s, { kind: 'split', unitId, rooms }, actor)).toHaveProperty('error');
    expect(roomCountAction(1, 2)).toBe('合併');
    expect(roomCountAction(1, 1)).toBe('合併');
    expect(roomCountAction(3, 2)).toBe('更新');
    expect(roomCountAction(2, 0)).toBe('建立');
    expect(roomCountAction(1, 0)).toBe('建立');
  });
  /*
   * The question the UI is meant to put on screen, and the same one the domain refuses
   * with — so a delete that would take records can never go through unasked.
   */
  it('refuses a removal that would take records with it until it is confirmed', () => {
    const observed = workflowDemo.observations.find(o => o.unitId)!;
    const refused = applyStructureChange(workflowDemo, { kind: 'removeUnits', unitIds: [observed.unitId!] }, actor);
    if (!('error' in refused)) throw new Error('有記錄的單位不應直接刪除');
    expect(refused.error).toContain('請先確認');
    expect(refused.error.endsWith(structureImpact(workflowDemo, { kind: 'removeUnits', unitIds: [observed.unitId!] })!.confirmation)).toBe(true);
    expect(applyStructureChange(workflowDemo, { kind: 'removeFloor', floorId: observed.floorId! }, actor)).toHaveProperty('error');
  });
  it('removes a confirmed unit together with its records, leaving a valid snapshot', () => {
    const observed = workflowDemo.observations.find(o => o.unitId)!;
    const { records } = structureImpact(workflowDemo, { kind: 'removeUnits', unitIds: [observed.unitId!] })!;
    // More than the unit's own record: the count includes what cited it.
    expect(records).toBeGreaterThan(1);
    const r = applyStructureChange(workflowDemo, { kind: 'removeUnits', unitIds: [observed.unitId!], confirmed: true }, actor);
    if ('error' in r) throw new Error(r.error);
    // Would throw on any record left pointing at a place that is gone.
    validateSnapshot(r.snapshot);
    expect(r.message).toContain(`連同 ${records} 筆記錄已一併刪除`);
    expect(r.snapshot.units.some(u => u.id === observed.unitId)).toBe(false);
  });
  it('asks before merging rooms that carry records, and takes them along', () => {
    const s = withRoomRecord();
    const unitId = s.units[0].id;
    const refused = applyStructureChange(s, { kind: 'split', unitId, rooms: 1 }, actor);
    if (!('error' in refused)) throw new Error('有記錄的劏房合併前應該先問');
    expect(refused.error).toContain('請先確認');
    const merged = apply(s, { kind: 'split', unitId, rooms: 1, confirmed: true });
    expect(merged.units).toHaveLength(1);
    expect(merged.observations).toEqual([]);
  });
  it('removes a unit, its rooms and a floor without records straight away', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 2, unitsPerFloor: 2 });
    s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 2 });
    s = apply(s, { kind: 'removeUnits', unitIds: [s.units[0].id] });
    expect(s.units).toHaveLength(3);
    s = apply(s, { kind: 'removeFloor', floorId: s.floors[1].id });
    expect(s.buildings[0].floorCount).toBe(1);
  });
  it('survives the Excel export and import', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 2, unitsPerFloor: 2 });
    s = apply(s, { kind: 'split', unitId: s.units[0].id, rooms: 2 });
    s = apply(s, { kind: 'noSubdivision', unitIds: [s.units[1].id], confirm: true });
    const parsed = parseWorkflowWorkbook(exportWorkflowWorkbook(s), 'round.xlsx', '2026-10-10T09:00:00Z')!;
    expect(parsed.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(parsed.snapshot!.units).toEqual(s.units);
  });
});

/*
 * The headings over the elevation's columns. A column is drawn so a letter keeps its place,
 * but the heading must name what is actually in it: plenty of Hong Kong buildings number
 * their units, and printing A over a column of 1室 names a unit nobody has (review, 2026-10-16).
 */
describe('the elevation names each column after what is in it', () => {
  /** Staff-typed labels for one floor's units, in the order the fixture made them; undefined keeps one. */
  const relabel = (s: OutreachSnapshot, names: (string | undefined)[]) => {
    const onFloor = s.units.filter(u => u.floorId === s.floors[0].id);
    const next = { ...s, units: s.units.map(u => { const at = onFloor.indexOf(u); const name = names[at]; return !name ? u : { ...u, label: `${s.floors[0].label} ${name}` }; }) };
    validateSnapshot(next);
    return next;
  };
  const threeUnits = () => apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 3 });
  const headingsOf = (s: OutreachSnapshot) => floorHeadings(s, s.floors, floorColumnCount(s, s.floors[0].id));

  it('says 1室、2室、3室 for a building whose units are numbered, not A、B、C', () => {
    const s = relabel(threeUnits(), ['1室', '2室', '3室']);
    expect(floorUnitColumns(s, s.floors[0].id, 3).map(cell => cell?.unit.label)).toEqual(['1 樓 1室', '1 樓 2室', '1 樓 3室']);
    expect(headingsOf(s)).toEqual(['1室', '2室', '3室']);
  });
  it('still says A、B、C for a building whose units are lettered', () => {
    expect(headingsOf(threeUnits())).toEqual(['A', 'B', 'C']);
  });
  it('leaves a deleted letter\'s column blank rather than renaming the ones after it', () => {
    const s = threeUnits();
    const b = s.units.find(u => u.label === '1 樓 B室')!;
    expect(headingsOf(apply(s, { kind: 'removeUnits', unitIds: [b.id] }))).toEqual(['A', '', 'C']);
  });

  /*
   * 「1號舖」 sorts before 「A室」, so a single pass over the floor put the shop in column 0 and
   * then let A take that column away from it. The unit stayed in the snapshot with its records
   * and disappeared from the elevation: nobody could click it, and its records were unreachable.
   */
  const cellsOf = (s: OutreachSnapshot) => floorUnitColumns(s, s.floors[0].id, floorColumnCount(s, s.floors[0].id)).map(cell => cell?.unit.label ?? '(空)');

  it('keeps a numbered floor in its own columns', () => {
    expect(cellsOf(relabel(threeUnits(), ['1室', '2室', '3室']))).toEqual(['1 樓 1室', '1 樓 2室', '1 樓 3室']);
  });
  it('does not let a letter overwrite a unit that is not lettered', () => {
    const s = relabel(apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 3 }), ['A室', 'B室', '1號舖']);
    expect(cellsOf(s)).toEqual(['1 樓 A室', '1 樓 B室', '1 樓 1號舖']);
  });
  it('puts a non-letter unit in the leftmost free column after a letter is deleted', () => {
    const s = threeUnits();
    const a = s.units.find(u => u.label === '1 樓 A室')!;
    const afterDelete = apply(s, { kind: 'removeUnits', unitIds: [a.id] });
    // The unit that replaces C is not lettered, so it fills A's empty column rather than C's.
    // A is gone, so the units left on the floor are B and C: C becomes the shop.
    expect(cellsOf(relabel(afterDelete, [undefined, '1號舖']))).toEqual(['1 樓 1號舖', '1 樓 B室', '(空)']);
  });
});

/*
 * The district demo spells the floor 「1 樓」 with a space and the unit on it 「1樓 A室」 without
 * one. Reading a unit's letter meant deleting the floor label by exact text, so those units kept
 * their floor in the name, were taken for free-form names, and were laid out in gap columns —
 * deleting A slid B and C left instead of leaving A's column empty. It is the same read that
 * decides which existing unit a paper row names, and whether ＋ reuses the gap or appends
 * (review, 2026-10-16).
 */
describe('the demo writes a floor and its units with different spacing', () => {
  const floor = districtDemo.floors.find(f => f.id === 'district-01-f10')!;
  const width = (s: OutreachSnapshot) => floorColumnCount(s, floor.id);
  /** Each column by the letter it holds; `?` marks a unit no column could name by letter. */
  const columns = (s: OutreachSnapshot) => floorUnitColumns(s, floor.id, width(s)).map(cell => {
    if (!cell) return '(空)';
    const at = unitColumn(cell.unit, floor);
    return at === undefined ? `?${cell.unit.label}` : UNIT_LETTERS[at];
  });

  it('keeps B and C in their columns when A is deleted, and ＋ puts A back', () => {
    expect(columns(districtDemo)).toEqual(['A', 'B', 'C']);
    const a = districtDemo.units.find(u => u.id === 'district-01-f10-A')!;
    const afterDelete = apply(districtDemo, { kind: 'removeUnits', unitIds: [a.id] });
    expect(columns(afterDelete)).toEqual(['(空)', 'B', 'C']);
    const refilled = apply(afterDelete, { kind: 'addUnit', floorId: floor.id });
    expect(columns(refilled)).toEqual(['A', 'B', 'C']);
    const floors = refilled.floors.filter(f => f.buildingId === floor.buildingId);
    expect(floorHeadings(refilled, floors, width(refilled))).toEqual(['A', 'B', 'C']);
  });

  it('reads a paper 「1樓 B室」 as the unit that is already on the floor', () => {
    expect(findPaperLocation(districtDemo, 'district-01', '1樓', 'B室')).toBe('district-01-f1-B');
    // Floor and unit both exist, so there is nothing to propose — and nothing to add twice.
    expect(proposeLocation(districtDemo, 'district-01', '1樓', 'B室')).toBeUndefined();
    expect(proposeLocation(districtDemo, 'district-01', '1樓', 'B2室')?.steps)
      .toEqual(['把「1樓 B室」分出劏房「1樓 B2室」']);
  });
});

/*
 * A unit the editor makes itself is spelled the way the units beside it are. Naming it from the
 * floor label instead put 「1 樓 A室」 on a floor of 「1樓 B室」 — one floor written two ways, in the
 * ledger and the Excel export as much as on the elevation — and left ＋ unable to put back the
 * unit it had just taken away (review, 2026-10-16).
 */
describe('a new unit is spelled like the units beside it', () => {
  const labelsOn = (s: OutreachSnapshot, floorId: string) => s.units.filter(u => u.floorId === floorId).map(u => u.label);
  const demoFloor = districtDemo.floors.find(f => f.id === 'district-01-f1')!;

  it('＋ puts back the very unit it took away, spacing and all', () => {
    const a = districtDemo.units.find(u => u.id === 'district-01-f1-A')!;
    // It has records, so the delete is the confirmed one a staff member has already been asked about.
    const afterDelete = apply(districtDemo, { kind: 'removeUnits', unitIds: [a.id], confirmed: true });
    expect(labelsOn(afterDelete, demoFloor.id)).toEqual(['1樓 B室', '1樓 C室']);
    expect(labelsOn(apply(afterDelete, { kind: 'addUnit', floorId: demoFloor.id }), demoFloor.id))
      .toEqual(['1樓 B室', '1樓 C室', '1樓 A室']);
  });

  it('gives a new floor the same way of writing as the rest of its own building', () => {
    const added = apply(districtDemo, { kind: 'addFloors', buildingId: 'district-01', count: 1, unitsPerFloor: 2 });
    const top = added.floors.filter(f => f.buildingId === 'district-01').at(-1)!;
    expect(top.label).toBe('11 樓');
    expect(labelsOn(added, top.id)).toEqual(['11樓 A室', '11樓 B室']);
    // Another building in the same snapshot writes its units differently; it must not lend its
    // spelling — 「1F A室」 would name a floor this building has not got.
    const small = apply(districtDemo, { kind: 'addFloors', buildingId: 'bldg-yu-an', count: 1, unitsPerFloor: 1 });
    expect(labelsOn(small, small.floors.filter(f => f.buildingId === 'bldg-yu-an').at(-1)!.id)).toEqual(['9F A室']);
  });

  it('promises the paper row the same name it will make', () => {
    const proposal = proposeLocation(districtDemo, 'district-01', '1樓', 'D室')!;
    expect(proposal.steps).toEqual(['在1 樓新增「1樓 D室」']);
    const made = proposal.apply(districtDemo);
    if ('error' in made) throw new Error(made.error);
    expect(made.snapshot.units.find(u => u.id === made.unitId)?.label).toBe('1樓 D室');
  });

  it('still writes a new building\'s units the way its own floor label reads', () => {
    const s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 2 });
    expect(labelsOn(s, s.floors[0].id)).toEqual(['1 樓 A室', '1 樓 B室']);
    expect(labelsOn(apply(s, { kind: 'addUnit', floorId: s.floors[0].id }), s.floors[0].id))
      .toEqual(['1 樓 A室', '1 樓 B室', '1 樓 C室']);
  });
});

/*
 * What a delete says and what it takes. The elevation draws a split unit as its rooms only, so
 * a confirmation that names the unit behind them names something that is not on screen, and a
 * button that takes it takes the whole group at once (review, 2026-10-16).
 */
describe('a delete names the places that are on screen', () => {
  const questionFor = (s: OutreachSnapshot, unitId: string) => structureImpact(s, { kind: 'removeUnits', unitIds: [unitId] })?.confirmation;
  const labelsOnFloor = (s: OutreachSnapshot) => s.units.map(u => u.label);

  it('takes the last room of a split group, not the unit behind it', () => {
    const s = withRoomRecord();
    const cells = floorUnitColumns(s, s.floors[0].id, floorColumnCount(s, s.floors[0].id));
    const target = lastDrawnUnit(cells)!;
    expect(target.label).toBe('1 樓 A2室');
    expect(questionFor(s, target.id)).toBe('「1 樓 A2室」有 1 筆記錄，刪除會連同這些記錄一起刪除，請先確認。');
    // The unit and its other room stay: one press takes one cell off the elevation.
    expect(apply(s, { kind: 'removeUnits', unitIds: [target.id], confirmed: true }).units.map(u => u.label)).toEqual(['1 樓 A室', '1 樓 A1室']);
  });

  it('says a unit behind the rooms is going, and counts only what is at each place', () => {
    const s = withRoomRecord();
    const parent = s.units.find(u => u.label === '1 樓 A室')!;
    // The one record sits on A2室, so the rooms are named with it and the unit behind is not
    // counted in — it has nothing of its own.
    expect(questionFor(s, parent.id)).toBe('「1 樓 A1室、1 樓 A2室」有 1 筆記錄；立面上沒有的「1 樓 A室」沒有記錄，刪除會連同這些記錄一起刪除，請先確認。');
  });

  it('names a unit with records of its own even when its rooms have none', () => {
    let s = apply(start(), { kind: 'addFloors', buildingId: 'SYP-001', count: 1, unitsPerFloor: 1 });
    const parent = s.units[0];
    const at = '2026-10-10T09:00:00+08:00';
    s = { ...s, visits: [{ ...flags, id: 'visit-1', occurredAt: at, recordedAt: at, workerName: '測試同事' }], observations: [1, 2].map(n => ({ ...flags, id: `observation-${n}`, visitId: 'visit-1', buildingId: 'SYP-001', floorId: parent.floorId, unitId: parent.id, occurredAt: at, recordedAt: at, workerName: '測試同事', coverage: 'VISITED_NO_FINDING' as const, evidence: [] })) };
    s = apply(s, { kind: 'split', unitId: parent.id, rooms: 2 });
    expect(questionFor(s, parent.id)).toBe('「1 樓 A1室、1 樓 A2室」沒有記錄；立面上沒有的「1 樓 A室」有 2 筆記錄，刪除會連同這些記錄一起刪除，請先確認。');
  });

  it('counts what went, not what was asked for', () => {
    const s = withRoomRecord();
    const parent = s.units.find(u => u.label === '1 樓 A室')!;
    // An id that names nothing takes nothing; the unit takes its two rooms with it.
    const r = applyStructureChange(s, { kind: 'removeUnits', unitIds: [parent.id, 'gone-already'], confirmed: true }, actor);
    if ('error' in r) throw new Error(r.error);
    expect(labelsOnFloor(r.snapshot)).toEqual([]);
    expect(r.message).toContain('已刪除 3 個單位');
  });
});

/*
 * The backup gate in front of a delete. Appending is the rule for records and deleting them
 * is the exception, so the confirmation must not open on anything short of a download that
 * actually happened — an intention, a failure, or a browser that refused must all leave it
 * shut (review, 2026-10-15).
 */
describe('the delete gate waits on a backup that really happened', () => {
  it('stays shut until a backup has been taken, and says what it is waiting for', () => {
    const waiting = deleteGate('IDLE');
    expect(waiting.allowed).toBe(false);
    expect(waiting.note).toContain('先下載當前 Excel 備份');
    expect(deleteGate('WORKING').allowed).toBe(false);
  });

  it('opens only for a download the browser took', () => {
    expect(deleteGate('DONE').allowed).toBe(true);
  });

  it('stays shut when the download failed, rather than deleting without a way back', () => {
    const failed = deleteGate('FAILED');
    expect(failed.allowed).toBe(false);
    expect(failed.note).toContain('未刪除任何記錄');
  });
});

describe('a building whose bottom floor is 地下', () => {
  const at = { at: '2026-10-17T04:00:00Z' };
  const hk = () => {
    const r = addBuilding(blankSnapshot(), { name: '地下樓', address: '', coordinates: { lng: 114.14, lat: 22.28 }, layout: '地下：地下 A室\n1樓：1樓 A室、1樓 B室\n2樓：2樓 A室' });
    if ('error' in r) throw new Error(r.error);
    return { s: r.snapshot, id: r.buildingId };
  };
  const ok = (r: ReturnType<typeof applyStructureChange>) => { if ('error' in r) throw new Error(r.error); validateSnapshot(r.snapshot); return r.snapshot; };
  const labelsOn = (s: OutreachSnapshot, floorLabel: string) => s.units.filter(u => u.floorId === s.floors.find(f => f.label === floorLabel)!.id).map(u => u.label);

  it('names a new floor after the top one by number, not by level', () => {
    const { s, id } = hk();
    const next = ok(applyStructureChange(s, { kind: 'addFloors', buildingId: id, count: 2, unitsPerFloor: 1 }, at));
    expect(next.floors.map(f => f.label)).toEqual(['地下', '1樓', '2樓', '3樓', '4樓']);
    expect(labelsOn(next, '3樓')).toEqual(['3樓 A室']);
  });
  it('spells a unit on an emptied 1樓 as 1樓, not after its level', () => {
    const { s } = hk();
    const emptied = ok(applyStructureChange(s, { kind: 'removeUnits', unitIds: s.units.filter(u => u.label.startsWith('1樓')).map(u => u.id), confirmed: true }, at));
    const floorId = emptied.floors.find(f => f.label === '1樓')!.id;
    expect(labelsOn(ok(applyStructureChange(emptied, { kind: 'addUnit', floorId }, at)), '1樓')).toEqual(['1樓 A室']);
  });
  it('starts a building that only has 地下 at 1 樓', () => {
    const r = addBuilding(blankSnapshot(), { name: '平房', address: '', coordinates: { lng: 114.14, lat: 22.28 }, layout: '地下：A室' });
    if ('error' in r) throw new Error(r.error);
    expect(ok(applyStructureChange(r.snapshot, { kind: 'addFloors', buildingId: r.buildingId, count: 1, unitsPerFloor: 0 }, at)).floors.map(f => f.label)).toEqual(['地下', '1 樓']);
  });
  it('reads a paper 「1樓」 as the floor named 1樓, not the one at level 1', () => {
    const { s, id } = hk();
    expect(findPaperLocation(s, id, '1樓', 'B')).toBe(s.units.find(u => u.label === '1樓 B室')!.id);
    const room = proposeLocation(s, id, '1/F', 'B1')!;
    expect(room.steps).toEqual(['把「1樓 B室」分出劏房「1樓 B1室」']);
    const missing = proposeLocation(s, id, '3樓', 'A')!;
    expect(missing.steps).toEqual(['新增「3樓」', '在3樓新增「3樓 A室」']);
    const r = missing.apply(s);
    if ('error' in r) throw new Error(r.error);
    expect(r.snapshot.floors.find(f => f.label === '3樓')).toMatchObject({ level: 4 });
  });
});
