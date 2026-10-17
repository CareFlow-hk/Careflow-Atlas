import type { Building, FootprintSource, OutreachSnapshot } from '../domain/types';
import { isUndeclaredLayout, parseLayoutSummary } from './layoutSummary';

export interface NewBuildingInput {
  /** Blank takes the next free `SYP-001` style id; only imports and scripts name one. */
  id?: string; name: string; address: string;
  coordinates: { lng: number; lat: number };
  footprint?: number[][];
  footprintSource?: FootprintSource;
  /** 樓層單位摘要, same wording as the Excel cell. Blank leaves floors undeclared. */
  layout?: string;
}
export type NewBuildingResult = { snapshot: OutreachSnapshot; buildingId: string } | { error: string; field: 'id' | 'name' | 'layout' };

/** The next unused `SYP-001` style id, the same shape the Excel guide suggests. */
export function nextBuildingId(snapshot: OutreachSnapshot | undefined, prefix = 'SYP'): string {
  const taken = new Set(snapshot?.buildings.map(b => b.id) ?? []);
  for (let n = 1; ; n++) {
    const id = `${prefix}-${String(n).padStart(3, '0')}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Add one building drawn on the map. Same rules as a new row in 大廈總表:
 * name and a position are required, the address may be left blank until someone
 * knows it, the id must be free — one nobody named is numbered here, against this
 * very snapshot — and a layout is only taken when every line reads. Nothing else
 * in the snapshot changes.
 */
export function addBuilding(snapshot: OutreachSnapshot, input: NewBuildingInput): NewBuildingResult {
  const id = input.id?.trim() || nextBuildingId(snapshot), name = input.name.trim(), address = input.address.trim();
  // No "blank id" refusal: a blank one has just been numbered. What a caller did name still has to read.
  if (!/^[\w-]+$/.test(id)) return { error: '大廈編號只可用英文字母、數字、「-」或「_」。', field: 'id' };
  if (snapshot.buildings.some(b => b.id === id)) return { error: `大廈編號「${id}」已經用過，請換一個。`, field: 'id' };
  if (!name) return { error: '請填大廈名稱。', field: 'name' };
  const { lng, lat } = input.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('A new building needs a position.');
  const building: Building = {
    isSynthetic: true, provisional: true, id, name, address, coordinates: { lng, lat }, layoutDeclared: false,
    ...(input.footprint ? { footprint: input.footprint, footprintSource: input.footprintSource } : {}),
  };
  const next = { ...snapshot, buildings: [...snapshot.buildings, building] };
  if (input.layout && !isUndeclaredLayout(input.layout)) {
    const layout = parseLayoutSummary(id, input.layout);
    if ('error' in layout) return { error: layout.error, field: 'layout' };
    if (layout.floors.some(f => snapshot.floors.some(x => x.id === f.id)) || layout.units.some(u => snapshot.units.some(x => x.id === u.id)))
      return { error: '這個大廈編號和其他大廈的樓層編號撞了，請換一個編號。', field: 'id' };
    if (layout.floors.length) {
      Object.assign(building, { layoutDeclared: true, floorCount: layout.floors.length });
      next.floors = [...snapshot.floors, ...layout.floors];
      next.units = [...snapshot.units, ...layout.units];
    }
  }
  return { snapshot: next, buildingId: id };
}
