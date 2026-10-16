import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StructureBar } from './StructureBar';
import type { OutreachSnapshot } from '../domain/types';

const flags = { isSynthetic: true as const, provisional: true as const };
function district(): OutreachSnapshot {
  return {
    schemaVersion: '0.1-demo', isSynthetic: true, notice: '合成示例',
    buildings: [{ ...flags, id: 'b1', name: '海景樓', address: '合成地址', coordinates: { lng: 114.14, lat: 22.28 }, layoutDeclared: true, floorCount: 1 }],
    floors: [{ ...flags, id: 'f1', buildingId: 'b1', level: 2, label: '2樓' }],
    units: [{ ...flags, id: 'u-a', buildingId: 'b1', floorId: 'f1', label: '2樓 A室' }],
    households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [], visits: [], observations: [],
  };
}
const noop = () => undefined;

/*
 * The single-unit delete that fills the gap the ＋／－ row leaves: those only reach the last
 * unit on a floor, so a specific unit needs its own button. It appears once a unit is open in
 * the editor, and only where the caller can actually remove it.
 */
describe('StructureBar', () => {
  it('offers 刪除本單位 once a unit is open, and only when it can be deleted', () => {
    const withUnit = renderToStaticMarkup(<StructureBar snapshot={district()} buildingId="b1" splitUnitId="u-a" onCloseSplit={noop} onChange={noop} onDeleteUnit={noop} />);
    expect(withUnit).toContain('cf-structure__delete');
    expect(withUnit).toContain('>刪除本單位</button>');

    const noUnit = renderToStaticMarkup(<StructureBar snapshot={district()} buildingId="b1" onCloseSplit={noop} onChange={noop} onDeleteUnit={noop} />);
    expect(noUnit).not.toContain('cf-structure__delete');

    const noHandler = renderToStaticMarkup(<StructureBar snapshot={district()} buildingId="b1" splitUnitId="u-a" onCloseSplit={noop} onChange={noop} />);
    expect(noHandler).not.toContain('cf-structure__delete');
  });
});
