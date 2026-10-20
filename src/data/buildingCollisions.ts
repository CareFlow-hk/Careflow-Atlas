import type { OutreachSnapshot } from '../domain/types';
import { sameValue } from './snapshotValue';

/**
 * Two devices that add a building while out of step both number it from their own copy, so
 * both can call different buildings `SYP-001`. Matched by id, the merge would then take them
 * for one building edited twice: it asks which side to keep, and the floors, units and
 * records of the other side end up hanging from a building that is not theirs — a snapshot
 * that cannot be valid, so the sync stops for everyone who added one (2026-10-20 trial).
 *
 * A building both sides added under one id is told apart by where it is and what it is
 * called. Two different places, or two different names, are two buildings: this device's
 * one is given a new id, and everything that belongs to it moves with it. Nothing is
 * dropped and nothing is merged by content (CLAUDE.md §3.2); the result is what both people
 * actually added. The same name at the same spot is left alone: that is one building, and a
 * difference in it is a real edit the merge must still ask about.
 */
const SAME_PLACE_METRES = 25;

function metresApart(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6_371_000;
}

function samePlace(a: OutreachSnapshot['buildings'][number], b: OutreachSnapshot['buildings'][number]) {
  return a.name.trim() === b.name.trim() && metresApart(a.coordinates, b.coordinates) <= SAME_PLACE_METRES;
}

function freshId(old: string, taken: Set<string>, tag: () => string) {
  for (;;) {
    const id = `${old}-${tag()}`;
    if (!taken.has(id)) return id;
  }
}

const randomTag = () => Math.random().toString(36).slice(2, 6).toUpperCase();

export interface Separated { local: OutreachSnapshot; renamed: { from: string; to: string; name: string }[] }

/** `local` with every building that only collides by id moved to a new id. */
export function separateCollidingBuildings(remote: OutreachSnapshot, local: OutreachSnapshot, base?: OutreachSnapshot, tag = randomTag): Separated {
  const remoteBuildings = new Map(remote.buildings.map(b => [b.id, b]));
  const baseIds = new Set(base?.buildings.map(b => b.id) ?? []);
  const clashes = local.buildings.filter(b => {
    const other = remoteBuildings.get(b.id);
    // Agreed on before, or not on the other side at all: the ordinary merge decides.
    return other && !baseIds.has(b.id) && !sameValue(other, b) && !samePlace(other, b);
  });
  if (!clashes.length) return { local, renamed: [] };

  const taken = new Set<string>();
  for (const s of [remote, local]) for (const list of [s.buildings, s.floors, s.units]) for (const row of list) taken.add(row.id);
  const buildingIds = new Map<string, string>(), floorIds = new Map<string, string>(), unitIds = new Map<string, string>();
  const moved = (old: string, from: string, to: string) => {
    // Floor and unit ids are built from the building id (`SYP-001-f2-u1`); keep that reading.
    const id = old.startsWith(`${from}-`) ? `${to}${old.slice(from.length)}` : old;
    if (id !== old && taken.has(id)) return freshId(id, taken, tag);
    return id;
  };
  for (const b of clashes) {
    const to = freshId(b.id, taken, tag);
    taken.add(to);
    buildingIds.set(b.id, to);
    for (const f of local.floors) if (f.buildingId === b.id) { const id = moved(f.id, b.id, to); taken.add(id); floorIds.set(f.id, id); }
    for (const u of local.units) if (u.buildingId === b.id) { const id = moved(u.id, b.id, to); taken.add(id); unitIds.set(u.id, id); }
  }
  const map = <T extends string | undefined>(ids: Map<string, string>, id: T): T => (id !== undefined && ids.has(id) ? ids.get(id) as T : id);
  const next: OutreachSnapshot = {
    ...local,
    buildings: local.buildings.map(b => buildingIds.has(b.id) ? { ...b, id: buildingIds.get(b.id)! } : b),
    floors: local.floors.map(f => floorIds.has(f.id) ? { ...f, id: floorIds.get(f.id)!, buildingId: map(buildingIds, f.buildingId) } : f),
    units: local.units.map(u => unitIds.has(u.id) ? { ...u, id: unitIds.get(u.id)!, buildingId: map(buildingIds, u.buildingId), floorId: map(floorIds, u.floorId), parentUnitId: map(unitIds, u.parentUnitId) } : u),
    observations: local.observations.map(o => buildingIds.has(o.buildingId) ? { ...o, buildingId: map(buildingIds, o.buildingId), floorId: map(floorIds, o.floorId), unitId: map(unitIds, o.unitId) } : o),
    householdResidences: local.householdResidences.map(r => buildingIds.has(r.buildingId) ? { ...r, buildingId: map(buildingIds, r.buildingId), unitId: map(unitIds, r.unitId) } : r),
  };
  // Drop keys an optional field never had, so an unmoved record compares equal to its stored self.
  for (const list of [next.units, next.observations, next.householdResidences] as unknown as Record<string, unknown>[][]) {
    for (const row of list) for (const key of ['floorId', 'unitId', 'parentUnitId']) if (key in row && row[key] === undefined) delete row[key];
  }
  return { local: next, renamed: clashes.map(b => ({ from: b.id, to: buildingIds.get(b.id)!, name: b.name })) };
}
