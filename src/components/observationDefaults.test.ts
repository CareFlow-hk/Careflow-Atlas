import { describe, expect, it } from 'vitest';
import { inheritedCoverage, roomFormDefaults } from './observationDefaults';
import { coverageOptionGroups } from '../domain/presentation';
import type { Observation, OutreachSnapshot, Unit } from '../domain/types';

const flags = { isSynthetic: true as const, provisional: true as const };
const unit = (over: Partial<Unit> & { id: string }): Unit => ({ ...flags, buildingId: 'b1', floorId: 'f1', label: over.id, ...over });
const record = (over: Partial<Observation> & { id: string }): Observation => ({
  ...flags, visitId: 'v1', buildingId: 'b1', floorId: 'f1', occurredAt: '2026-01-05T02:00:00.000Z', recordedAt: '2026-01-05T02:00:00.000Z',
  workerName: 'w', coverage: 'VISITED_NO_FINDING', evidence: [], ...over,
});
const scene = (units: Unit[], observations: Observation[]): OutreachSnapshot => ({
  schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
  buildings: [{ ...flags, id: 'b1', name: 'B', address: 'A', coordinates: { lng: 0, lat: 0 }, layoutDeclared: true }],
  floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 1, label: '1F' }],
  units, households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [], visits: [], observations,
});

/*
 * What a 劏房 room's form opens with. Following the room's own last record is a
 * convenience; answering for a visit nobody has described yet is not, so the rule has to
 * refuse to do it (review, 2026-10-15).
 */
describe("a room form follows its own last record", () => {
  it('carries the last result over when there is one', () => {
    expect(inheritedCoverage({ coverage: 'VISITED_NO_FINDING' })).toBe('VISITED_NO_FINDING');
    expect(inheritedCoverage({ coverage: 'ATTEMPTED' })).toBe('ATTEMPTED');
    expect(inheritedCoverage({ coverage: 'UNVISITED' })).toBe('UNVISITED');
  });

  /*
   * The one case the review asked to change: no record means no answer, rather than the
   * ordinary outcome standing in for one.
   */
  it('answers nothing when there is no record to follow', () => {
    expect(inheritedCoverage(undefined)).toBeUndefined();
  });

  /* An imported finer value must light up a choice the form actually offers. */
  it('reads a stored value back as the choice that stands for it', () => {
    expect(inheritedCoverage({ coverage: 'PARTIAL' })).toBe('ATTEMPTED');
    expect(inheritedCoverage({ coverage: 'INACCESSIBLE' })).toBe('ATTEMPTED');
    expect(inheritedCoverage({ coverage: 'VISITED_WITH_FINDING' })).toBe('VISITED_NO_FINDING');
  });

  /* Whatever it carries over has to be a choice the form shows, never a value it does not. */
  it('carries over only values the form offers as choices', () => {
    const offered = coverageOptionGroups.map(option => option.canonical);
    for (const coverage of ['UNVISITED', 'ATTEMPTED', 'PARTIAL', 'INACCESSIBLE', 'VISITED_NO_FINDING', 'VISITED_WITH_FINDING', 'UNKNOWN'] as const) {
      expect(offered).toContain(inheritedCoverage({ coverage }));
    }
  });
});

/*
 * Which place each answer belongs to. 住房判斷 belongs to the room, because a room is what
 * the split made; 覆蓋狀態 belongs to a visit, so it is only ever followed, and a room with
 * nothing of its own follows the unit it was split from (2026-10-15).
 */
describe('the two answers a form opens with, per place', () => {
  const parent = unit({ id: 'u1', label: 'A室' });
  const room = unit({ id: 'r1', label: 'A1室', parentUnitId: 'u1' });

  it('answers the housing question for a room and follows its unit’s last visit', () => {
    expect(roomFormDefaults(scene([parent, room], [record({ id: 'o1', unitId: 'u1' })]), room)).toEqual({ coverage: 'VISITED_NO_FINDING', assessment: 'STAFF_VERIFIED' });
  });

  it('leaves the room unanswered when the unit it came from was never recorded', () => {
    expect(roomFormDefaults(scene([parent, room], []), room)).toEqual({ assessment: 'STAFF_VERIFIED' });
  });

  it('answers nothing at all for an ordinary unit, and for the building', () => {
    const snapshot = scene([parent, room], [record({ id: 'o1', unitId: 'u1' })]);
    expect(roomFormDefaults(snapshot, parent)).toEqual({});
    expect(roomFormDefaults(snapshot, undefined)).toEqual({});
  });
});
