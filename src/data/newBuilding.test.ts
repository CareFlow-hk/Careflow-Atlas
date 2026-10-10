import { describe, expect, it } from 'vitest';
import { workflowDemo } from './workflowDemo';
import { blankSnapshot } from './blankSnapshot';
import { addBuilding, nextBuildingId } from './newBuilding';
import { exportWorkflowWorkbook, parseWorkflowWorkbook } from './workflowWorkbook';
import { validateSnapshot } from '../domain/schema';

const at = { lng: 114.1400376, lat: 22.2867829 };
const ring = [[114.14, 22.2867], [114.1401, 22.2867], [114.1401, 22.2868], [114.14, 22.2868], [114.14, 22.2867]];
const input = { id: 'SYP-001', name: '新大廈', address: '第三街 1 號', coordinates: at };

describe('adding a building on the map', () => {
  it('suggests the next free id', () => {
    expect(nextBuildingId(undefined)).toBe('SYP-001');
    const once = addBuilding(blankSnapshot(), input);
    if ('error' in once) throw new Error(once.error);
    expect(nextBuildingId(once.snapshot)).toBe('SYP-002');
  });
  it('adds only the building, with floors undeclared when no layout is given', () => {
    const result = addBuilding(workflowDemo, input);
    if ('error' in result) throw new Error(result.error);
    expect(result.snapshot.buildings.at(-1)).toMatchObject({ id: 'SYP-001', layoutDeclared: false, coordinates: at });
    expect(result.snapshot.floors).toBe(workflowDemo.floors);
    expect(result.snapshot.observations).toBe(workflowDemo.observations);
    expect(() => validateSnapshot(result.snapshot)).not.toThrow();
  });
  it('keeps the OSM outline and where it came from', () => {
    const result = addBuilding(blankSnapshot(), { ...input, footprint: ring, footprintSource: { kind: 'osm', at: '2026-10-10T00:00:00Z', osmId: '42', match: 'contains' } });
    if ('error' in result) throw new Error(result.error);
    expect(result.snapshot.buildings[0]).toMatchObject({ footprint: ring, footprintSource: { kind: 'osm', osmId: '42' } });
  });
  it('declares floors from the same wording as the Excel cell', () => {
    const result = addBuilding(blankSnapshot(), { ...input, layout: '1 樓：A室、B室\n2 樓：A室' });
    if ('error' in result) throw new Error(result.error);
    expect(result.snapshot.buildings[0]).toMatchObject({ layoutDeclared: true, floorCount: 2 });
    expect(result.snapshot.units.map(u => u.id)).toEqual(['SYP-001-f1-u1', 'SYP-001-f1-u2', 'SYP-001-f2-u1']);
  });
  it('refuses a taken id, missing fields or an unreadable layout, and says which field', () => {
    const taken = addBuilding(workflowDemo, { ...input, id: workflowDemo.buildings[0].id });
    expect(taken).toMatchObject({ field: 'id' });
    expect(addBuilding(workflowDemo, { ...input, id: 'a b' })).toMatchObject({ field: 'id' });
    expect(addBuilding(workflowDemo, { ...input, name: ' ' })).toMatchObject({ field: 'name' });
    expect(addBuilding(workflowDemo, { ...input, address: '' })).toMatchObject({ field: 'address' });
    expect(addBuilding(workflowDemo, { ...input, layout: '1 樓 A室' })).toMatchObject({ field: 'layout' });
    expect(addBuilding(workflowDemo, { ...input, layout: '3 樓：A\n2 樓：A' })).toMatchObject({ field: 'layout' });
  });
  it('travels through the Excel export and back unchanged', () => {
    const result = addBuilding(workflowDemo, { ...input, footprint: ring, footprintSource: { kind: 'osm', at: '2026-10-10T00:00:00Z', osmId: '42', match: 'contains' }, layout: '1 樓：A室' });
    if ('error' in result) throw new Error(result.error);
    const parsed = parseWorkflowWorkbook(exportWorkflowWorkbook(result.snapshot), 'round.xlsx', '2026-10-10T01:00:00Z')!;
    expect(parsed.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(parsed.snapshot!.buildings.find(b => b.id === 'SYP-001')).toEqual(result.snapshot.buildings.at(-1));
    expect(parsed.snapshot!.units.filter(u => u.buildingId === 'SYP-001')).toHaveLength(1);
  });
});
