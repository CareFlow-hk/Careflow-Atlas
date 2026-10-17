import { describe, expect, it } from 'vitest';
import { addBuilding } from '../data/newBuilding';
import { blankSnapshot } from '../data/blankSnapshot';
import { validateSnapshot } from './schema';
import { applyStructureChange, findPaperLocation, proposeLocation, readPaperFloor, readPaperUnit } from './structure';

const actor = { at: '2026-10-10T08:00:00.000Z', by: '測試同事' };
const building = () => {
  const r = addBuilding(blankSnapshot(), { id: 'SYP-001', name: '新大廈', address: '第三街 1 號', coordinates: { lng: 114.14, lat: 22.2867 } });
  if ('error' in r) throw new Error(r.error);
  const f = applyStructureChange(r.snapshot, { kind: 'addFloors', buildingId: 'SYP-001', count: 3, unitsPerFloor: 2 }, actor);
  if ('error' in f) throw new Error(f.error);
  return f.snapshot;
};

describe('semi-agent: structure proposals from paper locations', () => {
  it('reads only plain floor and unit wording', () => {
    expect(['5樓', '5/F', '5F', '5 樓', '5'].map(readPaperFloor)).toEqual([5, 5, 5, 5, 5]);
    expect(['G/F', '地下', '五樓', ''].map(readPaperFloor)).toEqual([undefined, undefined, undefined, undefined]);
    expect(readPaperUnit('B1室')).toEqual({ letter: 'B', room: 1 });
    expect(readPaperUnit('5樓 c', '5樓')).toEqual({ letter: 'C', room: undefined });
    expect(readPaperUnit('後座')).toBeUndefined();
  });
  it('proposes nothing when the location exists or cannot be read', () => {
    const s = building();
    expect(proposeLocation(s, 'SYP-001', '2樓', 'A室')).toBeUndefined();
    expect(proposeLocation(s, 'SYP-001', '頂樓', 'A室')).toBeUndefined();
    expect(findPaperLocation(s, 'SYP-001', '2/F', 'a')).toBe(s.units.find(u => u.label === '2 樓 A室')!.id);
  });
  it('proposes a 劏房 room under an existing unit and applies it', () => {
    const s = building();
    const p = proposeLocation(s, 'SYP-001', '2樓', 'B1室')!;
    expect(p.steps).toEqual(['把「2 樓 B室」分出劏房「2 樓 B1室」']);
    const r = p.apply(s);
    if ('error' in r) throw new Error(r.error);
    validateSnapshot(r.snapshot);
    expect(r.snapshot.units.find(u => u.id === r.unitId)).toMatchObject({ label: '2 樓 B1室', parentUnitId: s.units.find(u => u.label === '2 樓 B室')!.id });
    expect(proposeLocation(r.snapshot, 'SYP-001', '2樓', 'B1室')).toBeUndefined();
    expect(findPaperLocation(r.snapshot, 'SYP-001', '2樓', 'B1')).toBe(r.unitId);
  });
  it('proposes a missing floor, unit and room together, leaving records untouched', () => {
    const s = building();
    const p = proposeLocation(s, 'SYP-001', '5樓', 'C2')!;
    expect(p.steps).toEqual(['新增「5 樓」', '在5 樓新增「5 樓 C室」', '把「5 樓 C室」分出劏房「5 樓 C2室」']);
    const r = p.apply(s);
    if ('error' in r) throw new Error(r.error);
    validateSnapshot(r.snapshot);
    expect(r.snapshot.buildings[0].floorCount).toBe(4);
    expect(r.snapshot.observations).toBe(s.observations);
  });
  it('clears a no-subdivision confirmation when a room is added', () => {
    let s = building();
    const unitId = s.units.find(u => u.label === '1 樓 A室')!.id;
    const c = applyStructureChange(s, { kind: 'noSubdivision', unitIds: [unitId], confirm: true }, actor);
    if ('error' in c) throw new Error(c.error);
    s = c.snapshot;
    const r = proposeLocation(s, 'SYP-001', '1樓', 'A1')!.apply(s);
    if ('error' in r) throw new Error(r.error);
    expect(r.snapshot.units.find(u => u.id === unitId)!.noSubdivision).toBeUndefined();
  });
});
