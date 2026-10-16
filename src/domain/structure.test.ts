import { describe, expect, it } from 'vitest';
import { workflowDemo } from '../data/workflowDemo';
import { addBuilding } from '../data/newBuilding';
import { blankSnapshot } from '../data/blankSnapshot';
import { exportWorkflowWorkbook, parseWorkflowWorkbook } from '../data/workflowWorkbook';
import { validateSnapshot } from './schema';
import { applyStructureChange, deleteGate, floorColumnCount, floorHeadings, floorUnitColumns, floorUnitGroups, roomCountAction, structureImpact, type StructureChange } from './structure';
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
  /** Staff-typed labels for one floor's units, in the order the fixture made them. */
  const relabel = (s: OutreachSnapshot, names: string[]) => {
    const onFloor = s.units.filter(u => u.floorId === s.floors[0].id);
    const next = { ...s, units: s.units.map(u => { const at = onFloor.indexOf(u); return at < 0 || at >= names.length ? u : { ...u, label: `${s.floors[0].label} ${names[at]}` }; }) };
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
