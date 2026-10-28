import type { SpatialBuilding } from './buildingOverlaps';

export function OverlapNotice({ buildings, onSelect }: { buildings: readonly SpatialBuilding[]; onSelect: (id: string) => void }) {
  return <div role="status">{buildings.map(building => <p className="fp-editor__note is-problem" key={building.id}>
    這個形狀和『{building.name}』重疊。要在『{building.name}』記錄，還是重新選位置？{' '}
    <button type="button" onClick={() => onSelect(building.id)}>去『{building.name}』</button>
  </p>)}</div>;
}
