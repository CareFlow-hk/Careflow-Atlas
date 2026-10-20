import { describe, expect, it } from 'vitest';
import { blankSnapshot } from './blankSnapshot';
import { addBuilding } from './newBuilding';
import { mergeSync } from './syncMerge';
import { addFloors } from '../domain/structure';
import { validateSnapshot } from '../domain/schema';
import type { OutreachSnapshot } from '../domain/types';

/*
 * The 2026-10-20 trial: everyone started from an empty workspace and added buildings on the
 * map at the same time. Each device numbered its own SYP-001, the first save took the id,
 * and every other device that had also added floors could no longer sync at all.
 */
const flags = { isSynthetic: true as const, provisional: true as const };
function withBuilding(name: string, lng: number, lat: number) {
  const result = addBuilding(blankSnapshot(), { name, address: '', coordinates: { lng, lat } });
  if ('error' in result) throw new Error(result.error);
  return result.snapshot;
}
function record(s: OutreachSnapshot, id: string, place: { buildingId: string; floorId?: string; unitId?: string }): OutreachSnapshot {
  const at = '2026-10-20T06:30:00.000Z';
  return {
    ...s,
    visits: [...s.visits, { ...flags, id: `visit-${id}`, occurredAt: at, recordedAt: at, workerName: '同事' }],
    observations: [...s.observations, { ...flags, id, visitId: `visit-${id}`, ...place, occurredAt: at, recordedAt: at, workerName: '同事', coverage: 'VISITED_NO_FINDING', evidence: [] }],
  };
}

describe('two devices that numbered different buildings the same', () => {
  const base = blankSnapshot();
  const remote = record(withBuilding('abc', 114.1400, 22.2867), 'obs-remote', { buildingId: 'SYP-001' });
  const shaped = addFloors(withBuilding('明愛大廈', 114.1420, 22.2880), 'SYP-001', 2, 2);
  if ('error' in shaped) throw new Error(shaped.error);
  const unit = shaped.snapshot.units[0];
  const local = record(shaped.snapshot, 'obs-local', { buildingId: 'SYP-001', floorId: unit.floorId, unitId: unit.id });

  it('used to stop the sync for good', () => {
    expect(remote.buildings[0].id).toBe(local.buildings[0].id);
  });

  it('keeps both buildings, and moves this device\'s floors, units and records with its own', () => {
    for (const ancestor of [base, undefined]) {
      const result = mergeSync(remote, local, ancestor);
      expect(result.invalid).toBeUndefined();
      expect(result.conflicts).toEqual([]);
      const merged = result.snapshot!;
      expect(() => validateSnapshot(merged)).not.toThrow();
      expect(merged.buildings.map(b => b.name)).toEqual(['abc', '明愛大廈']);
      const mine = merged.buildings.find(b => b.name === '明愛大廈')!;
      expect(mine.id).not.toBe('SYP-001');
      expect(result.renamed).toEqual([{ from: 'SYP-001', to: mine.id, name: '明愛大廈' }]);
      expect(merged.floors.every(f => f.buildingId === mine.id && f.id.startsWith(`${mine.id}-`))).toBe(true);
      expect(merged.units).toHaveLength(4);
      const obs = merged.observations.find(o => o.id === 'obs-local')!;
      expect(obs.buildingId).toBe(mine.id);
      expect(merged.units.find(u => u.id === obs.unitId)?.floorId).toBe(obs.floorId);
      // The other device's building and record are untouched.
      expect(merged.observations.find(o => o.id === 'obs-remote')!.buildingId).toBe('SYP-001');
    }
  });

  it('leaves one building edited on both sides to the ordinary question', () => {
    const edited = structuredClone(remote); edited.buildings[0].address = '第三街 1 號';
    const result = mergeSync(remote, edited, base);
    expect(result.renamed).toBeUndefined();
    expect(result.conflicts.map(c => c.key)).toEqual(['buildings/SYP-001']);
  });

  it('does not renumber a building both sides already agreed on', () => {
    const moved = structuredClone(remote); moved.buildings[0].name = '改名';
    const result = mergeSync(remote, moved, remote);
    expect(result.renamed).toBeUndefined();
    expect(result.snapshot!.buildings[0]).toMatchObject({ id: 'SYP-001', name: '改名' });
  });
});
