import { create } from 'zustand';
import type { OutreachSnapshot, SaveObservationInput } from '../domain/types';
import { LocalStoragePersistenceAdapter, OutreachRepository } from '../data/repository';
import { mergeWorkflow } from '../data/workflowMerge';

let repository = new OutreachRepository(new LocalStoragePersistenceAdapter());
let accountId: string | undefined;
/** Demo caches only. Never adopt the pre-authentication shared cache. */
export function setWorkspaceAccount(id?: string) {
  if (id === accountId) return;
  accountId = id;
  repository = new OutreachRepository(new LocalStoragePersistenceAdapter(), id ? `careflow-atlas.account.${id}.demo` : 'careflow-atlas.signed-out');
  useWorkspace.setState({ snapshot: undefined, storageError: undefined, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false });
}
interface WorkspaceState {
  snapshot?: OutreachSnapshot;
  storageError?: string;
  selectedBuildingId?: string;
  selectedFloorId?: string;
  selectedUnitId?: string;
  expanded: boolean;
  initialize: () => void;
  importSnapshot: (snapshot: OutreachSnapshot) => void;
  mergeSnapshot: (snapshot: OutreachSnapshot, baseline?: OutreachSnapshot) => void;
  saveObservation: (input: SaveObservationInput) => void;
  selectBuilding: (id?: string) => void;
  selectFloor: (id: string) => void;
  selectUnit: (id: string) => void;
  toggleExpanded: () => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  expanded: false,
  initialize: () => {
    try { set({ snapshot: repository.getSnapshot(), storageError: undefined }); }
    catch { set({ storageError: '本機資料未能讀取。原有資料保留；你可以重新匯入合成資料。' }); }
  },
  importSnapshot: snapshot => {
    const saved = repository.replaceSnapshot(snapshot);
    set({ snapshot: saved, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false, storageError: undefined });
  },
  mergeSnapshot: (incoming, baseline) => {
    const result = mergeWorkflow(repository.getSnapshot(), incoming, baseline);
    if (!result.snapshot) throw new Error(result.issues.map(i => i.message).join('\n'));
    const saved = repository.replaceSnapshot(result.snapshot);
    set({ snapshot: saved, storageError: undefined });
  },
  saveObservation: input => {
    const saved = repository.saveObservation(input);
    set({ snapshot: saved, storageError: undefined });
  },
  selectBuilding: id => set({ selectedBuildingId: id, selectedFloorId: undefined, selectedUnitId: undefined, expanded: !!id && !!get().snapshot?.floors.some(floor => floor.buildingId === id) }),
  selectFloor: id => set({ selectedFloorId: id, selectedUnitId: undefined, expanded: true }),
  selectUnit: id => {
    const unit = get().snapshot?.units.find(u => u.id === id);
    if (unit) set({ selectedBuildingId: unit.buildingId, selectedFloorId: unit.floorId, selectedUnitId: id, expanded: true });
  },
  toggleExpanded: () => set(state => ({ expanded: !state.expanded })),
}));
