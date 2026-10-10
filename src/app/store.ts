import { create } from 'zustand';
import { recordFollowUpEvent, tagNode, type FollowUpEventAction, type NodeTag, type Operator, type OutreachSnapshot, type SaveObservationInput } from '../domain/types';
import { createRecordId } from './recordId';
import type { CustomOptions } from '../domain/optionPrefs';
import { LocalStoragePersistenceAdapter, OutreachRepository } from '../data/repository';
import { outlineCentre } from '../map/footprintGeometry';
import { OptionPrefsRepository } from '../data/optionPrefsRepository';
import { mergeWorkflow } from '../data/workflowMerge';
import { addBuilding, type NewBuildingInput } from '../data/newBuilding';
import { blankSnapshot } from '../data/blankSnapshot';
import { appendPhotoPages, type PhotoPage } from '../photos/model';

const adapter = new LocalStoragePersistenceAdapter();
let repository = new OutreachRepository(adapter);
let prefsRepository = new OptionPrefsRepository(adapter);
let accountId: string | undefined;
/** Demo caches only. Never adopt the pre-authentication shared cache. */
export function setWorkspaceAccount(id?: string, name?: string) {
  // The operator travels with the account so a closed task names who closed it.
  useWorkspace.setState({ operator: id ? { accountId: id, name: name ?? id } : undefined });
  if (id === accountId) return;
  accountId = id;
  const suffix = id ? `careflow-atlas.account.${id}` : 'careflow-atlas.signed-out';
  repository = new OutreachRepository(adapter, `${suffix}.demo`);
  prefsRepository = new OptionPrefsRepository(adapter, `${suffix}.options`);
  useWorkspace.setState({ snapshot: undefined, storageError: undefined, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false, optionPrefs: prefsRepository.get() });
}
interface WorkspaceState {
  snapshot?: OutreachSnapshot;
  storageError?: string;
  /** Self-defined entry choices for this account. A shortcut list, not a record. */
  optionPrefs: CustomOptions;
  /** The signed-in account. Recorded as the operator of task actions, never as a field worker. */
  operator?: Operator;
  selectedBuildingId?: string;
  selectedFloorId?: string;
  selectedUnitId?: string;
  expanded: boolean;
  initialize: () => void;
  importSnapshot: (snapshot: OutreachSnapshot) => void;
  mergeSnapshot: (snapshot: OutreachSnapshot, baseline?: OutreachSnapshot) => void;
  /** Empty this account's workspace in this browser. Options and the account are kept. */
  clearWorkspace: () => void;
  /** Replace a building's outline drawn on the map. Records stay attached; only the shape and its centre move. */
  setFootprint: (buildingId: string, ring: number[][]) => void;
  /** Add a building placed on the map. An empty workspace starts from the blank template. Returns the refusal, if any. */
  addBuilding: (input: NewBuildingInput) => { error: string; field: string } | undefined;
  saveObservation: (input: SaveObservationInput) => void;
  savePhotoPages: (pages: PhotoPage[]) => { added: number; duplicates: number };
  /** Set or clear the manual mark on a building or a floor. A display change only. */
  setTag: (subject: { buildingId: string; floorId?: string }, tag?: NodeTag) => void;
  /** Writes the shortcut list for this account. Never touches the snapshot. */
  setOptionPrefs: (prefs: CustomOptions) => void;
  /** Mark a task done, cancel it with a reason, or undo either. Appends; never edits. */
  actOnFollowUp: (observationId: string, action: FollowUpEventAction, reason?: string) => void;
  selectBuilding: (id?: string) => void;
  selectFloor: (id: string) => void;
  selectUnit: (id: string) => void;
  toggleExpanded: () => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  expanded: false,
  optionPrefs: {},
  initialize: () => {
    try { set({ snapshot: repository.getSnapshot(), storageError: undefined }); }
    catch { set({ storageError: '本機資料未能讀取。原有資料保留；你可以重新匯入合成資料。' }); }
  },
  importSnapshot: snapshot => {
    const saved = repository.replaceSnapshot(snapshot);
    set({ snapshot: saved, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false, storageError: undefined });
  },
  setFootprint: (buildingId, ring) => {
    const current = get().snapshot;
    if (!current) return;
    const centre = outlineCentre(ring);
    const operator = get().operator;
    const next = { ...current, buildings: current.buildings.map(b => b.id !== buildingId ? b : {
      ...b, footprint: ring, coordinates: { lng: centre.lng, lat: centre.lat },
      footprintSource: { kind: 'manual' as const, at: new Date().toISOString(), by: operator?.name, osmId: b.footprintSource?.osmId },
    }) };
    set({ snapshot: repository.replaceSnapshot(next), storageError: undefined });
  },
  addBuilding: input => {
    const result = addBuilding(get().snapshot ?? blankSnapshot(), input);
    if ('error' in result) return result;
    set({ snapshot: repository.replaceSnapshot(result.snapshot), storageError: undefined });
    get().selectBuilding(result.buildingId);
    return undefined;
  },
  clearWorkspace: () => {
    repository.clear();
    set({ snapshot: undefined, storageError: undefined, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false });
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
  setTag: (subject, tag) => {
    const current = get().snapshot;
    if (!current) return;
    const saved = repository.replaceSnapshot(tagNode(current, subject, tag));
    set({ snapshot: saved, storageError: undefined });
  },
  savePhotoPages: pages => {
    const current = repository.getSnapshot(); const operator = get().operator;
    if (!current || !operator) throw new Error('請先登入並載入街區資料。');
    const result = appendPhotoPages(current, pages, operator);
    if (result.added) set({ snapshot: repository.replaceSnapshot(result.snapshot), storageError: undefined });
    return { added: result.added, duplicates: result.duplicates };
  },
  setOptionPrefs: prefs => set({ optionPrefs: prefsRepository.save(prefs) }),
  actOnFollowUp: (observationId, action, reason) => {
    const current = get().snapshot;
    const operator = get().operator;
    if (!current) return;
    if (!operator) throw new Error('請先登入，才能記錄誰處理了這項跟進。');
    const next = recordFollowUpEvent(current, { id: `follow-up-event-${createRecordId()}`, observationId, action, reason, at: new Date().toISOString(), operator });
    if (next === current) return;
    set({ snapshot: repository.replaceSnapshot(next), storageError: undefined });
  },
  selectBuilding: id => set({ selectedBuildingId: id, selectedFloorId: undefined, selectedUnitId: undefined, expanded: !!id && !!get().snapshot?.floors.some(floor => floor.buildingId === id) }),
  selectFloor: id => set({ selectedFloorId: id, selectedUnitId: undefined, expanded: true }),
  selectUnit: id => {
    const unit = get().snapshot?.units.find(u => u.id === id);
    if (unit) set({ selectedBuildingId: unit.buildingId, selectedFloorId: unit.floorId, selectedUnitId: id, expanded: true });
  },
  toggleExpanded: () => set(state => ({ expanded: !state.expanded })),
}));
