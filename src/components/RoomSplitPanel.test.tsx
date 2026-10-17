import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoomList, RoomSplitPanel } from './RoomSplitPanel';
import type { OutreachSnapshot, Unit } from '../domain/types';

const flags = { isSynthetic: true as const, provisional: true as const };
/** Mirrors BuildingDetail's own rule: drop the floor the column repeats, and 室. */
const labelOf = (unit: Unit) => unit.label.replace(/^\S+\s+/, '').replace(/室$/, '');

function district(units: Unit[]): OutreachSnapshot {
  return {
    schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
    buildings: [{ ...flags, id: 'b1', name: '海景樓', address: '合成地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true, floorCount: 1 }],
    floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 2, label: '2樓' }],
    units,
    households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [], visits: [], observations: [],
  };
}
const parent: Unit = { ...flags, id: 'u-a', buildingId: 'b1', floorId: 'f1', label: '2樓 A室' };
const room = (n: number): Unit => ({ ...flags, id: `u-a-${n}`, buildingId: 'b1', floorId: 'f1', label: `2樓 A${n}室`, parentUnitId: 'u-a' });
const noop = () => undefined;

describe('RoomList', () => {
  it('names each room after its unit and offers to record it', () => {
    const html = renderToStaticMarkup(<RoomList snapshot={district([parent, room(1), room(2)])} rooms={[room(1), room(2)]} labelOf={labelOf} onRecord={noop} />);
    expect(html).toContain('<strong>A1</strong>');
    expect(html).toContain('<strong>A2</strong>');
    expect(html).toContain('記錄 A1');
    expect(html).toContain('記錄 A2');
  });

  /*
   * A 劏房 room is recorded the way any other unit is: 記錄 opens the entry form, which
   * asks for coverage, contact and housing in full. There is no shortcut outcome of its
   * own, and no delete — how many rooms there are is set by the split form, where 1 merges.
   */
  it('offers no shortcut outcome and no delete of its own', () => {
    const html = renderToStaticMarkup(<RoomList snapshot={district([parent, room(1)])} rooms={[room(1)]} labelOf={labelOf} onRecord={noop} />);
    expect(html).not.toContain('cf-room-list__quick');
    expect(html).not.toContain('已接觸');
    expect(html).not.toContain('刪除');
  });
});

describe('RoomSplitPanel', () => {
  it('opens on two rooms and offers to create them', () => {
    const html = renderToStaticMarkup(<RoomSplitPanel snapshot={district([parent])} unitId="u-a" onStructureChange={() => undefined} onClose={noop} />);
    expect(html).toContain('新增劏房');
    expect(html).toContain('2樓 A室');
    expect(html).toContain('value="2"');
    expect(html).toContain('建立</button>');
    // The rooms themselves are listed in the unit's ledger, not here.
    expect(html).not.toContain('cf-room-list');
  });

  it('opens on the count the unit is at now, and offers an update', () => {
    const html = renderToStaticMarkup(<RoomSplitPanel snapshot={district([parent, room(1), room(2)])} unitId="u-a" onStructureChange={() => undefined} onClose={noop} />);
    expect(html).toContain('value="2"');
    expect(html).toContain('更新</button>');
    expect(html).toContain('現在有 2 間');
  });

  it('can be dismissed from its own header', () => {
    const html = renderToStaticMarkup(<RoomSplitPanel snapshot={district([parent])} unitId="u-a" onStructureChange={() => undefined} onClose={noop} />);
    expect(html).toContain('aria-label="收起新增劏房"');
  });

  it('renders nothing for a unit that is not in the snapshot', () => {
    expect(renderToStaticMarkup(<RoomSplitPanel snapshot={district([parent])} unitId="gone" onStructureChange={() => undefined} onClose={noop} />)).toBe('');
  });
});
