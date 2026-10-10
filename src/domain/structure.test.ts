import { describe, expect, it } from 'vitest';
import { workflowDemo } from '../data/workflowDemo';
import { addBuilding } from '../data/newBuilding';
import { blankSnapshot } from '../data/blankSnapshot';
import { exportWorkflowWorkbook, parseWorkflowWorkbook } from '../data/workflowWorkbook';
import { validateSnapshot } from './schema';
import { applyStructureChange, floorUnitGroups, type StructureChange } from './structure';
import type { OutreachSnapshot } from './types';

const actor = { at: '2026-10-10T08:00:00.000Z', by: '測試同事' };
const start = () => { const r = addBuilding(blankSnapshot(), { id: 'SYP-001', name: '新大廈', address: '第三街 1 號', coordinates: { lng: 114.14, lat: 22.2867 } }); if ('error' in r) throw new Error(r.error); return r.snapshot; };
const apply = (s: OutreachSnapshot, change: StructureChange) => { const r = applyStructureChange(s, change, actor); if ('error' in r) throw new Error(r.error); validateSnapshot(r.snapshot); return r.snapshot; };

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
  it('never removes a floor or unit that has records', () => {
    const observed = workflowDemo.observations.find(o => o.unitId)!;
    expect(applyStructureChange(workflowDemo, { kind: 'removeUnits', unitIds: [observed.unitId!] }, actor)).toHaveProperty('error');
    expect(applyStructureChange(workflowDemo, { kind: 'removeFloor', floorId: observed.floorId! }, actor)).toHaveProperty('error');
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
