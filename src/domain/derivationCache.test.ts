import { describe, expect, it } from 'vitest';
import { districtDemo } from '../data/districtDemo';
import { getOpenFollowUps, latestForUnit, unitState, type OutreachSnapshot } from './types';

const fresh = (): OutreachSnapshot => structuredClone(districtDemo);
const states = (snapshot: OutreachSnapshot) => snapshot.units.map(unit => unitState(snapshot, unit.buildingId, unit.id));

describe('derivation caches', () => {
  it('give the same answers as a snapshot seen for the first time', () => {
    const snapshot = fresh();
    const first = states(snapshot);
    expect(states(snapshot)).toEqual(first);
    expect(states(fresh())).toEqual(first);
  });

  it('follow a replaced observations array', () => {
    const snapshot = fresh();
    const open = getOpenFollowUps(snapshot);
    expect(open.length).toBeGreaterThan(0);
    const closed = { ...snapshot, observations: snapshot.observations.map(item => item.id === open[0].observationId ? { ...item, deleted: { at: '2026-10-29T00:00:00Z', by: { accountId: 'a', name: '合成' } } } : item) };
    expect(getOpenFollowUps(closed).map(item => item.observationId)).not.toContain(open[0].observationId);
    expect(getOpenFollowUps(snapshot)).toEqual(open);
  });

  it('do not serve a stale answer after an in-place push', () => {
    const snapshot = fresh();
    const unit = snapshot.units.find(item => !latestForUnit(snapshot, item.id))!;
    expect(latestForUnit(snapshot, unit.id)).toBeUndefined();
    const source = snapshot.observations.find(item => item.unitId)!;
    snapshot.observations.push({ ...source, id: 'cache-push', floorId: unit.floorId, unitId: unit.id, correctsObservationId: undefined, resolvesObservationId: undefined, followUp: undefined });
    expect(latestForUnit(snapshot, unit.id)?.id).toBe('cache-push');
  });
});
