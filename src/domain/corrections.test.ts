import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../data/demoFixture';
import { snapshotSchema } from './schema';
import { getCorrectionConflicts, getOpenFollowUps } from './types';

const setup = () => {
  const snapshot = structuredClone(demoSnapshot);
  const original = snapshot.observations.find(o => o.id === 'observation-yu-an-5b')!;
  snapshot.observations = [original];
  return { snapshot, original };
};

describe('correction chain integrity', () => {
  it('reopens a task only when a reasoned correction explicitly retracts its closure', () => {
    const { snapshot, original } = setup();
    const closed = { ...original, id: 'closed', followUp: undefined, resolvesObservationId: original.id, recordedAt: '2026-09-11T00:00:00Z' };
    snapshot.observations.push(closed, { ...closed, id: 'retracted', correctsObservationId: closed.id, resolvesObservationId: undefined, correctionReason: '結案誤填', recordedAt: '2026-09-12T00:00:00Z' });
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(getOpenFollowUps(snapshot).map(o => o.observationId)).toEqual([original.id]);
  });
  it('rejects duplicate closures addressed to different versions of one task', () => {
    const { snapshot, original } = setup();
    snapshot.observations.push(
      { ...original, id: 'corrected', correctsObservationId: original.id },
      { ...original, id: 'closed', followUp: undefined, resolvesObservationId: original.id },
      { ...original, id: 'closed-again', followUp: undefined, resolvesObservationId: 'corrected' },
    );
    expect(snapshotSchema.safeParse(snapshot).success).toBe(false);
  });
  it('rejects branching even when each immediate branch has been corrected again', () => {
    const { snapshot, original } = setup();
    snapshot.observations.push(
      { ...original, id: 'a', correctsObservationId: original.id },
      { ...original, id: 'b', correctsObservationId: original.id },
      { ...original, id: 'a2', correctsObservationId: 'a' },
      { ...original, id: 'b2', correctsObservationId: 'b' },
    );
    expect(getCorrectionConflicts(snapshot).length).toBeGreaterThan(0);
    expect(snapshotSchema.safeParse(snapshot).success).toBe(false);
  });
  it('keeps a closed task closed when the task receives a correction', () => {
    const { snapshot, original } = setup();
    snapshot.observations.push(
      { ...original, id: 'closed', followUp: undefined, resolvesObservationId: original.id, recordedAt: '2026-09-11T00:00:00Z' },
      { ...original, id: 'corrected', correctsObservationId: original.id, recordedAt: '2026-09-12T00:00:00Z', correctionReason: '修正備註' },
    );
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(getOpenFollowUps(snapshot)).toEqual([]);
  });
  it('allows a corrected closure without counting its old version twice', () => {
    const { snapshot, original } = setup();
    const closed = { ...original, id: 'closed', followUp: undefined, resolvesObservationId: original.id, recordedAt: '2026-09-11T00:00:00Z' };
    snapshot.observations.push(closed, { ...closed, id: 'corrected-closure', correctsObservationId: closed.id, recordedAt: '2026-09-12T00:00:00Z' });
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(getOpenFollowUps(snapshot)).toEqual([]);
  });
  it('requires a reason when correcting away an open follow-up', () => {
    const { snapshot, original } = setup();
    snapshot.observations.push({ ...original, id: 'corrected', correctsObservationId: original.id, followUp: undefined });
    expect(snapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});
