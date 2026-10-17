import type { NewBuildingInput } from '../data/newBuilding';
import { outlineCentre } from './footprintGeometry';
import { defaultFootprintRing } from './mapModel';
import type { AddressSuggestion } from './nearbyAddress';
import type { FootprintMatch } from './osmFootprint';

/**
 * What one picked spot on the map becomes. Kept out of the panel so the wording and the
 * stored values can be asserted without a browser.
 */

/** `manual`: right-clicked on a spot the basemap has nothing at, so no outline is matched. */
export type Picked = { point: { lng: number; lat: number }; match?: FootprintMatch; manual?: boolean };
/** What the person types. The id is numbered on the way in, and floors start from the structure editor. */
export type AddBuildingForm = { name: string; address: string };
/** The outline as the panel holds it, and whether a person has moved it since it was picked. */
export type DraftShape = { ring: number[][]; edited: boolean };

/**
 * The outline the editor starts from: the one the basemap matched, or the default block where
 * there is none to match. Undefined only while the match is still being looked up — a shape to
 * start dragging and then have replaced is worse than no shape for a moment.
 */
export function seedRing(picked: Picked): number[][] | undefined {
  if (picked.manual) return defaultFootprintRing(picked.point);
  const match = picked.match;
  if (!match) return undefined;
  return match.kind === 'none' ? defaultFootprintRing(picked.point) : match.ring;
}

/**
 * What a picked spot stores: the outline as it stands, with the marker at the middle of it.
 * The source stays `osm` only while nobody has touched it — a moved outline is a person's
 * reading of the building, not the basemap's, and is kept as `manual` with the match recorded
 * so it can still be traced back to what was offered.
 */
export function buildingInput(form: AddBuildingForm, picked: Picked, shape?: DraftShape): NewBuildingInput {
  const match = picked.manual ? undefined : picked.match;
  const outline = match && match.kind !== 'none' ? match : undefined;
  const osm = outline ? { osmId: outline.osmId, match: outline.kind } : {};
  if (shape) return {
    ...form,
    coordinates: outlineCentre(shape.ring),
    footprint: shape.ring,
    footprintSource: { kind: shape.edited || !outline ? 'manual' as const : 'osm' as const, at: new Date().toISOString(), ...osm },
  };
  return {
    ...form,
    coordinates: outline ? outlineCentre(outline.ring) : picked.point,
    ...(outline ? { footprint: outline.ring, footprintSource: { kind: 'osm' as const, at: new Date().toISOString(), ...osm } } : {}),
  };
}

/**
 * What pressing Tab should fill the address with. Only from one of the two naming fields,
 * and only while the address is still blank, so someone typing their own address — or
 * tabbing out of anything else — keeps ordinary navigation.
 */
export function addressFromTab(from: 'name' | 'address' | 'other', address: string, suggestion: AddressSuggestion | undefined) {
  return from !== 'other' && !address.trim() ? suggestion?.text : undefined;
}

/** Which shape will be stored, said plainly, so a placeholder is never mistaken for a survey. */
export function shapeNote(picked: Picked) {
  if (picked.manual) return { text: '這裡當作底圖上沒有的新建築：先用預設方塊定位，座標就是你右鍵的位置。可以直接在地圖上拖動形狀。', check: true };
  const match = picked.match;
  if (!match) return { text: '正在找地圖上的建築形狀…', check: false };
  if (match.kind === 'none') return { text: `找不到地圖上的建築（${match.reason}），先用預設方塊定位，可以直接在地圖上拖動形狀。`, check: true };
  const size = `約 ${Math.round(match.area)} m²`;
  if (match.large) return { text: `地圖上的建築${size}，可能連着相鄰大廈，可以直接在地圖上拖動把它收窄。`, check: true };
  if (match.kind === 'nearest' && match.distance >= 1) return { text: `你點的位置不在建築內，用了 ${Math.round(match.distance)} 米外最近的建築（${size}）。不對的話請點準一點。`, check: true };
  return { text: `已套用地圖上的建築形狀（${size}，來源 OpenStreetMap），可以直接在地圖上拖動微調。`, check: false };
}
