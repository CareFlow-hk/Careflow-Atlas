import { create } from 'zustand';
import { recordFollowUpEvent, tagNode, type FollowUpEventAction, type NodeTag, type Operator, type OutreachSnapshot, type SaveObservationInput } from '../domain/types';
import { createRecordId } from './recordId';
import type { CustomOptions } from '../domain/optionPrefs';
import { LocalStoragePersistenceAdapter, OutreachRepository, PersistenceError } from '../data/repository';
import { ApiError } from '../auth/api';
import { RemoteWorkspaceRepository } from '../data/remoteWorkspaceRepository';
import { outlineCentre } from '../map/footprintGeometry';
import { OptionPrefsRepository } from '../data/optionPrefsRepository';
import { mergeWorkflow } from '../data/workflowMerge';
import { addBuilding, type NewBuildingInput } from '../data/newBuilding';
import { blankSnapshot } from '../data/blankSnapshot';
import { applyStructureChange, setNoSubdivision, type LocationProposal, type StructureChange } from '../domain/structure';
import { appendPhotoPages, type PhotoPage } from '../photos/model';

const adapter = new LocalStoragePersistenceAdapter();
let repository = new OutreachRepository(adapter);
let backupRepository = new OutreachRepository(adapter, 'careflow-field-outreach.backup');
let prefsRepository = new OptionPrefsRepository(adapter);
let accountId: string | undefined;
/*
 * The browser copy stays the working copy that every domain rule runs against; the
 * account端 is the durable copy. Only a signed-in session with the server enabled turns
 * the second one on, so the demo/test paths never depend on the network.
 */
let server: RemoteWorkspaceRepository | undefined;
/** The version this tab last read from or wrote to the server. A write names it. */
let serverVersion: number | undefined;
/** Serialises writes: one in flight, in order, never two snapshots racing. */
let writes: Promise<void> = Promise.resolve();
/** The last snapshot the server confirmed, so an unchanged snapshot is not sent again. */
let confirmed = '';
/**
 * Demo caches only. Never adopt the pre-authentication shared cache.
 * `remote` is set only by the session gate, after the server has confirmed a session.
 */
export function setWorkspaceAccount(id?: string, name?: string, remote = false) {
  // The operator travels with the account so a closed task names who closed it.
  useWorkspace.setState({ operator: id ? { accountId: id, name: name ?? id } : undefined });
  if (id === accountId && remote === !!server) return;
  accountId = id;
  const suffix = id ? `careflow-atlas.account.${id}` : 'careflow-atlas.signed-out';
  repository = new OutreachRepository(adapter, `${suffix}.demo`);
  backupRepository = new OutreachRepository(adapter, `${suffix}.demo.backup`);
  prefsRepository = new OptionPrefsRepository(adapter, `${suffix}.options`);
  server = id && remote ? new RemoteWorkspaceRepository() : undefined;
  serverVersion = undefined; confirmed = ''; writes = Promise.resolve();
  useWorkspace.setState({ snapshot: undefined, loading: false, storageError: undefined, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false, optionPrefs: prefsRepository.get() });
}

/** Publish a snapshot the account端 has not been told about yet, then tell it. */
function publish(set: (partial: Partial<WorkspaceState>) => void, snapshot: OutreachSnapshot) {
  set({ snapshot, storageError: undefined });
  scheduleSync(snapshot);
}
function scheduleSync(snapshot: OutreachSnapshot) {
  const target = server;
  if (!target) return;
  const json = JSON.stringify(snapshot);
  if (json === confirmed) return;
  writes = writes.then(() => push(target, snapshot, json));
}
/**
 * A failed write is reported, never swallowed: the banner says the change is on this
 * machine but not yet on the account端. A 409 means another device wrote first, so the
 * change is not forced through and the person is asked to reload.
 */
async function push(target: RemoteWorkspaceRepository, snapshot: OutreachSnapshot, json: string) {
  if (target !== server) return;
  try {
    const version = await target.save(snapshot, serverVersion);
    if (target !== server) return;
    serverVersion = version; confirmed = json;
    if (useWorkspace.getState().storageError) useWorkspace.setState({ storageError: undefined });
  } catch (error) {
    if (target !== server) return;
    const conflict = error instanceof ApiError && error.status === 409;
    useWorkspace.setState({ storageError: conflict
      ? '這個帳號的資料已在其他裝置更新，本次改動未寫上帳號端。請重新載入後再修改；本機副本仍然保留。'
      : '本次改動已儲存在本機，但未能同步到帳號端。請檢查網絡；本機副本仍然保留，稍後可再儲存。' });
  }
}
/**
 * Read the account端 copy and make it the working copy.
 *
 * Two copies that differ are never merged here: without a reliable business key there is
 * no honest way to tell a repeated visit from a second visit (CLAUDE.md §3.2), so the
 * account端 wins, the local copy is kept as a backup, and the person is told.
 */
async function loadRemote(target: RemoteWorkspaceRepository) {
  let local: OutreachSnapshot | undefined;
  try { local = repository.getSnapshot(); } catch { local = undefined; }
  try {
    const record = await target.load();
    if (target !== server) return;
    if (!record) {
      serverVersion = undefined; confirmed = '';
      useWorkspace.setState({ snapshot: local, storageError: undefined, loading: false });
      if (local) scheduleSync(local);
      return;
    }
    serverVersion = record.version;
    const same = !!local && JSON.stringify(local) === JSON.stringify(record.snapshot);
    let keptBackup = false;
    if (local && !same) { try { backupRepository.replaceSnapshot(local); keptBackup = true; } catch { /* the message says it was not merged either way */ } }
    // The working copy is what alignment and validation made of the stored document; that,
    // not the raw bytes read back, is what an unchanged snapshot is compared against.
    const stored = repository.replaceSnapshot(record.snapshot);
    confirmed = JSON.stringify(stored);
    useWorkspace.setState({ loading: false, snapshot: stored, storageError: local && !same
      ? `這個帳號的資料已在其他裝置更新，已載入帳號端的版本，未有自動合併。${keptBackup ? '本機原有的另一份副本已另存備份。' : ''}需要的話請先匯出 Excel 核對。`
      : undefined });
  } catch (error) {
    if (target !== server) return;
    useWorkspace.setState({ loading: false, snapshot: local, storageError: error instanceof ApiError && error.status === 401
      ? '登入已過期，未能讀取帳號端的資料。目前顯示的是本機副本。'
      : '未能連接帳號服務，目前顯示的是本機副本。恢復連線後請重新整理。' });
  }
}
interface WorkspaceState {
  snapshot?: OutreachSnapshot;
  /** True while the account端 copy is being read, so an empty start screen cannot be mistaken for an empty workspace. */
  loading: boolean;
  storageError?: string;
  /** Self-defined entry choices for this account. A shortcut list, not a record. */
  optionPrefs: CustomOptions;
  /** The signed-in account. Recorded as the operator of task actions, never as a field worker. */
  operator?: Operator;
  selectedBuildingId?: string;
  selectedFloorId?: string;
  selectedUnitId?: string;
  expanded: boolean;
  /** Local mode resolves at once; the account端 copy is read before it resolves. */
  initialize: () => Promise<void>;
  importSnapshot: (snapshot: OutreachSnapshot) => void;
  mergeSnapshot: (snapshot: OutreachSnapshot, baseline?: OutreachSnapshot) => void;
  /** Empty this account's workspace in this browser. Options and the account are kept. */
  clearWorkspace: () => void;
  /** Replace a building's outline drawn on the map. Records stay attached; only the shape and its centre move. */
  setFootprint: (buildingId: string, ring: number[][]) => void;
  /** Add a building placed on the map. An empty workspace starts from the blank template. Returns the refusal, if any. */
  addBuilding: (input: NewBuildingInput) => { error: string; field: string } | undefined;
  /** Experimental: edit floors, units and 劏房 rooms in the UI. Returns what happened, or the refusal. */
  changeStructure: (change: StructureChange) => { error: string } | { message: string };
  /** Semi-agent: apply a structure proposal accepted in paper intake. Returns the new unit, or the refusal. */
  applyLocationProposal: (proposal: LocationProposal) => { unitId: string; snapshot: OutreachSnapshot } | { error: string };
  saveObservation: (input: SaveObservationInput) => void;
  /** The same result recorded at every unit of a selection, optionally confirming them free of 劏房 in the same write. */
  recordBatch: (inputs: readonly SaveObservationInput[], confirmNoSubdivision: boolean) => { saved: number; confirmed: number; skipped: number };
  savePhotoPages: (pages: PhotoPage[]) => { added: number; duplicates: number };
  /** Set or clear the manual mark on a building or a floor. A display change only. */
  setTag: (subject: { buildingId: string; floorId?: string }, tag?: NodeTag) => void;
  /** Writes the shortcut list for this account. Never touches the snapshot. */
  setOptionPrefs: (prefs: CustomOptions) => void;
  /** Mark a task done, cancel it with a reason, or undo either. Appends; never edits. */
  actOnFollowUp: (observationId: string, action: FollowUpEventAction, reason?: string) => void;
  selectBuilding: (id?: string) => void;
  selectFloor: (id: string) => void;
  /** Undefined clears the unit, leaving the building and floor where they are. */
  selectUnit: (id?: string) => void;
  toggleExpanded: () => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  expanded: false,
  loading: false,
  optionPrefs: {},
  initialize: () => {
    if (server) { set({ loading: true, storageError: undefined }); return loadRemote(server); }
    try { set({ snapshot: repository.getSnapshot(), storageError: undefined }); }
    catch { set({ storageError: '本機資料未能讀取。原有資料保留；你可以重新匯入合成資料。' }); }
    return Promise.resolve();
  },
  importSnapshot: snapshot => {
    const saved = repository.replaceSnapshot(snapshot);
    set({ selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false });
    publish(set, saved);
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
    publish(set, repository.replaceSnapshot(next));
  },
  addBuilding: input => {
    const result = addBuilding(get().snapshot ?? blankSnapshot(), input);
    if ('error' in result) return result;
    publish(set, repository.replaceSnapshot(result.snapshot));
    get().selectBuilding(result.buildingId);
    return undefined;
  },
  changeStructure: change => {
    const current = get().snapshot;
    if (!current) return { error: '請先載入資料。' };
    const result = applyStructureChange(current, change, { at: new Date().toISOString(), by: get().operator?.name });
    if ('error' in result) return result;
    publish(set, repository.replaceSnapshot(result.snapshot));
    // A removed unit or floor cannot stay selected.
    const { selectedUnitId, selectedFloorId } = get();
    if (selectedUnitId && !result.snapshot.units.some(u => u.id === selectedUnitId)) set({ selectedUnitId: undefined });
    if (selectedFloorId && !result.snapshot.floors.some(f => f.id === selectedFloorId)) set({ selectedFloorId: undefined, selectedUnitId: undefined });
    return { message: result.message };
  },
  applyLocationProposal: proposal => {
    const current = get().snapshot;
    if (!current) return { error: '請先載入資料。' };
    const result = proposal.apply(current);
    if ('error' in result) return result;
    const saved = repository.replaceSnapshot(result.snapshot);
    publish(set, saved);
    return { unitId: result.unitId, snapshot: saved };
  },
  clearWorkspace: () => {
    repository.clear();
    const target = server;
    /*
     * Queue behind any write still in flight, so a late PUT cannot restore what was
     * cleared. The version is reset only once the delete has gone through: resetting it
     * earlier would make the write queued ahead of it name a version the server no longer
     * accepts, and report a conflict for a change that was in fact saved.
     */
    if (target) writes = writes.then(async () => {
      if (target !== server) return;
      await target.clear();
      if (target !== server) return;
      serverVersion = undefined; confirmed = '';
      if (useWorkspace.getState().storageError) useWorkspace.setState({ storageError: undefined });
    }).catch(() => {
      if (target !== server) return;
      useWorkspace.setState({ storageError: '本機工作區已清空，但未能清空帳號端的副本。請檢查網絡後重試。' });
    });
    else { serverVersion = undefined; confirmed = ''; }
    set({ snapshot: undefined, storageError: undefined, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false });
  },
  mergeSnapshot: (incoming, baseline) => {
    const result = mergeWorkflow(repository.getSnapshot(), incoming, baseline);
    if (!result.snapshot) throw new Error(result.issues.map(i => i.message).join('\n'));
    publish(set, repository.replaceSnapshot(result.snapshot));
  },
  saveObservation: input => {
    publish(set, repository.saveObservation(input));
  },
  recordBatch: (inputs, confirmNoSubdivision) => {
    const current = get().snapshot;
    if (!current) throw new PersistenceError('請先載入資料。');
    // The observations land first and in one write; only then is 無劏房 confirmed on the
    // same units, with the same actor the rest of the structure editor records.
    const written = repository.saveObservations(inputs);
    const unitIds = inputs.map(input => input.unitId).filter((id): id is string => !!id);
    const confirmed = confirmNoSubdivision
      ? setNoSubdivision(written, unitIds, true, { at: new Date().toISOString(), by: get().operator?.name })
      : { snapshot: written, changed: 0, skipped: 0 };
    publish(set, confirmed.changed ? repository.replaceSnapshot(confirmed.snapshot) : written);
    return { saved: inputs.length, confirmed: confirmed.changed, skipped: confirmed.skipped };
  },
  setTag: (subject, tag) => {
    const current = get().snapshot;
    if (!current) return;
    publish(set, repository.replaceSnapshot(tagNode(current, subject, tag)));
  },
  savePhotoPages: pages => {
    const current = repository.getSnapshot(); const operator = get().operator;
    if (!current || !operator) throw new Error('請先登入並載入街區資料。');
    const result = appendPhotoPages(current, pages, operator);
    if (result.added) publish(set, repository.replaceSnapshot(result.snapshot));
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
    publish(set, repository.replaceSnapshot(next));
  },
  selectBuilding: id => set({ selectedBuildingId: id, selectedFloorId: undefined, selectedUnitId: undefined, expanded: !!id && !!get().snapshot?.floors.some(floor => floor.buildingId === id) }),
  selectFloor: id => set({ selectedFloorId: id, selectedUnitId: undefined, expanded: true }),
  selectUnit: id => {
    if (!id) { set({ selectedUnitId: undefined }); return; }
    const unit = get().snapshot?.units.find(u => u.id === id);
    if (unit) set({ selectedBuildingId: unit.buildingId, selectedFloorId: unit.floorId, selectedUnitId: id, expanded: true });
  },
  toggleExpanded: () => set(state => ({ expanded: !state.expanded })),
}));
