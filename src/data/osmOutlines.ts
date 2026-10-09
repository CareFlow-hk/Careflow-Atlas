import type { OutreachSnapshot } from '../domain/types';
import { findOsmFootprint, type FootprintMatch } from '../map/osmFootprint';

export interface OutlineNote { label: string; detail: string; needsCheck: boolean }

/**
 * Give each building that has no outline here the OSM building under its coordinate.
 * Runs before the review screen so the person sees what was matched; nothing is saved
 * until they confirm the merge. Buildings that already have an outline are never touched.
 */
export async function attachOsmOutlines(incoming: OutreachSnapshot, current: OutreachSnapshot | undefined, find: (p: { lng: number; lat: number }) => Promise<FootprintMatch> = findOsmFootprint, now = new Date().toISOString()) {
  const snapshot = structuredClone(incoming);
  const notes: OutlineNote[] = [];
  for (const building of snapshot.buildings) {
    if (building.footprint || current?.buildings.find(b => b.id === building.id)?.footprint) continue;
    const match = await find(building.coordinates);
    if (match.kind === 'none') {
      notes.push({ label: `${building.name} · 找不到地圖上的建築，暫用預設方塊`, detail: `${match.reason}。合併後可以在地圖上用「調整形狀」畫出輪廓。`, needsCheck: true });
      continue;
    }
    building.footprint = match.ring;
    building.footprintSource = { kind: 'osm', at: now, osmId: match.osmId, match: match.kind };
    const size = `約 ${Math.round(match.area)} m²`;
    notes.push(match.large
      ? { label: `${building.name} · 地圖上的建築${size}，可能連着相鄰大廈`, detail: '建議合併後用「調整形狀」把輪廓收窄到這幢大廈。', needsCheck: true }
      : match.kind === 'nearest'
        ? { label: `${building.name} · 用了 ${Math.round(match.distance)} 米外最近的建築（${size}）`, detail: '座標不在任何建築內，請在地圖上確認是否正確，有需要可用「調整形狀」修改。', needsCheck: true }
        : { label: `${building.name} · 已套用地圖上的建築形狀（${size}）`, detail: '來源：OpenStreetMap。如不準確，可在地圖上用「調整形狀」修改。', needsCheck: false });
  }
  return { snapshot, notes };
}
