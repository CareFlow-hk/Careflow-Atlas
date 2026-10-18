import { describe, expect, it } from 'vitest';
import { blankSnapshot } from './blankSnapshot';
import { demoSnapshot } from './demoFixture';
import { mergeSync } from './syncMerge';
import type { OutreachSnapshot } from '../domain/types';

const clone = () => structuredClone(demoSnapshot);
const person = (id: string, displayName: string) => ({ id, displayName, isSynthetic: true as const, provisional: true as const });

/*
 * Two devices, one workspace. What the merge must never do is decide, quietly, that one
 * side's record is the one to keep: a record both sides changed is reported for a person
 * to settle, and a record only one side touched is taken from that side.
 */
describe('merging the account端 with this browser', () => {
  it('keeps what each side added when the other side did not touch it', () => {
    const base = clone();
    const local = clone(); local.people.push(person('person-local', '本機新增'));
    const remote = clone(); remote.people.push(person('person-remote', '帳號端新增'));
    const result = mergeSync(remote, local, base);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot!.people.map(item => item.id)).toEqual(expect.arrayContaining(['person-local', 'person-remote']));
  });

  it('takes the side that changed a record and the side that did not', () => {
    const base = clone();
    const remoteChanged = clone(); remoteChanged.buildings[0].name = '帳號端改名';
    expect(mergeSync(remoteChanged, clone(), base).snapshot!.buildings[0].name).toBe('帳號端改名');
    const localChanged = clone(); localChanged.buildings[0].name = '本機改名';
    expect(mergeSync(clone(), localChanged, base).snapshot!.buildings[0].name).toBe('本機改名');
  });

  it('reports a record both sides changed instead of choosing for them', () => {
    const base = clone();
    const local = clone(); local.buildings[0].name = '本機改名';
    const remote = clone(); remote.buildings[0].name = '帳號端改名';
    const result = mergeSync(remote, local, base);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ collection: 'buildings', localDeleted: false, remoteDeleted: false });
    expect(result.conflicts[0].key).toBe(`buildings/${base.buildings[0].id}`);
    // Until the person answers, the account端's version is the one a snapshot can be built from.
    expect(result.snapshot!.buildings[0].name).toBe('帳號端改名');
  });

  it('applies the version the person kept', () => {
    const base = clone();
    const local = clone(); local.buildings[0].name = '本機改名';
    const remote = clone(); remote.buildings[0].name = '帳號端改名';
    const key = `buildings/${base.buildings[0].id}`;
    expect(mergeSync(remote, local, base, { [key]: 'local' }).snapshot!.buildings[0].name).toBe('本機改名');
    expect(mergeSync(remote, local, base, { [key]: 'remote' }).snapshot!.buildings[0].name).toBe('帳號端改名');
    // Once answered, the record is no longer an open question.
    expect(mergeSync(remote, local, base, { [key]: 'local' }).conflicts).toEqual([]);
  });

  it('keeps a deletion the other side did not touch, whichever side deleted it', () => {
    const base = clone();
    const removed = base.memberships[0].id;
    const local = clone(); local.memberships = local.memberships.filter(item => item.id !== removed);
    expect(mergeSync(clone(), local, base).snapshot!.memberships.some(item => item.id === removed)).toBe(false);
    expect(mergeSync(local, clone(), base).snapshot!.memberships.some(item => item.id === removed)).toBe(false);
  });

  it('reports a record deleted on one side and edited on the other', () => {
    const base = clone();
    const edited = base.memberships[0];
    const nextStatus = edited.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const deletedHere = clone(); deletedHere.memberships = deletedHere.memberships.filter(item => item.id !== edited.id);
    const editedThere = clone(); editedThere.memberships[0].status = nextStatus;
    const result = mergeSync(editedThere, deletedHere, base);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ localDeleted: true, remoteDeleted: false });
    expect(result.snapshot!.memberships.some(item => item.id === edited.id)).toBe(true);

    const editedHere = clone(); editedHere.memberships[0].status = nextStatus;
    const deletedThere = clone(); deletedThere.memberships = deletedThere.memberships.filter(item => item.id !== edited.id);
    const other = mergeSync(deletedThere, editedHere, base);
    expect(other.conflicts).toHaveLength(1);
    expect(other.conflicts[0]).toMatchObject({ localDeleted: false, remoteDeleted: true });
    expect(other.snapshot!.memberships.some(item => item.id === edited.id)).toBe(false);
  });

  /* Same-looking content is not identity: an added record is an added record (§3.2). */
  it('never collapses two records that look alike', () => {
    const base = clone();
    const local = clone(); local.people.push({ ...base.people[0], id: 'person-twin' });
    const result = mergeSync(clone(), local, base);
    expect(result.snapshot!.people).toHaveLength(base.people.length + 1);
    expect(result.conflicts).toEqual([]);
  });

  /* Without a remembered baseline only additions can be recognised, so nothing is deleted. */
  it('keeps both sides when there is no common ancestor to compare against', () => {
    const local = clone();
    const remote = clone(); remote.people.push(person('person-remote', '帳號端新增'));
    const result = mergeSync(remote, local, undefined);
    expect(result.snapshot!.people).toHaveLength(local.people.length + 1);
  });
});

/** A one-building workspace, small enough to reason about a deleted floor. */
function minimal(): OutreachSnapshot {
  const snapshot = blankSnapshot();
  snapshot.buildings.push({ id: 'b1', name: '測試大廈', address: '', coordinates: { lng: 114.1, lat: 22.3 }, layoutDeclared: true, floorCount: 1, isSynthetic: true, provisional: true });
  snapshot.floors.push({ id: 'f1', buildingId: 'b1', level: 1, label: '1樓', isSynthetic: true, provisional: true });
  snapshot.units.push({ id: 'u1', buildingId: 'b1', floorId: 'f1', label: '1樓 A室', isSynthetic: true, provisional: true });
  snapshot.visits.push({ id: 'v1', occurredAt: '2026-03-01T02:00:00.000Z', recordedAt: '2026-03-01T02:00:00.000Z', workerName: '合成工作員', isSynthetic: true, provisional: true });
  snapshot.observations.push({ id: 'o1', visitId: 'v1', buildingId: 'b1', floorId: 'f1', unitId: 'u1', occurredAt: '2026-03-01T02:00:00.000Z', recordedAt: '2026-03-01T02:00:00.000Z', workerName: '合成工作員', coverage: 'VISITED_NO_FINDING', evidence: [], isSynthetic: true, provisional: true });
  return snapshot;
}

/*
 * Honouring a deletion can leave a record another device added still pointing at it. The
 * merge then keeps both sides rather than deleting the record or its floor.
 */
describe('a deletion that would leave a record without its floor', () => {
  it('keeps both sides and says the deletion was reversed', () => {
    const base = minimal();
    const remote = structuredClone(base);
    remote.observations = []; remote.units = []; remote.floors = [];
    const local = structuredClone(base);
    local.observations.push({ ...local.observations[0], id: 'o2' });
    const result = mergeSync(remote, local, base);
    expect(result.keptBoth).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot!.floors).toHaveLength(1);
    expect(result.snapshot!.observations.map(item => item.id)).toEqual(['o1', 'o2']);
  });
});
