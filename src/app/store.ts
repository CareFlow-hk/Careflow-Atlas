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
import { mergeSync, type SyncChoice, type SyncConflict } from '../data/syncMerge';
import { addBuilding, type NewBuildingInput } from '../data/newBuilding';
import { blankSnapshot } from '../data/blankSnapshot';
import { applyStructureChange, setNoSubdivision, type LocationProposal, type StructureChange } from '../domain/structure';
import { appendPhotoPages, type PhotoPage } from '../photos/model';

const adapter = new LocalStoragePersistenceAdapter();
let repository = new OutreachRepository(adapter);
let baseRepository = new OutreachRepository(adapter, 'careflow-field-outreach.base');
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
/** Serialises pulls and writes: one in flight, in order, never two snapshots racing. */
let writes: Promise<void> = Promise.resolve();
/** The JSON the account端 held when this tab last read or wrote it. */
let confirmed = '';
/** The JSON both sides last agreed on; written once to remember the common ancestor. */
let savedBase = '';
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
  baseRepository = new OutreachRepository(adapter, `${suffix}.demo.base`);
  prefsRepository = new OptionPrefsRepository(adapter, `${suffix}.options`);
  server = id && remote ? new RemoteWorkspaceRepository() : undefined;
  serverVersion = undefined; confirmed = ''; savedBase = ''; writes = Promise.resolve();
  useWorkspace.setState({ snapshot: undefined, loading: false, storageError: undefined, pendingConflicts: [], conflictsOpen: false, syncBlocked: false, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false, optionPrefs: prefsRepository.get() });
}

/** This browser's working copy; a corrupt store is reported, not thrown at the caller. */
function workingSnapshot(): OutreachSnapshot | undefined {
  try { return repository.getSnapshot(); } catch { return undefined; }
}
/** The snapshot both sides last agreed on, when this browser remembers one. */
function readBase(): OutreachSnapshot | undefined {
  try { return baseRepository.getSnapshot(); } catch { return undefined; }
}
function rememberBase(snapshot: OutreachSnapshot) {
  const json = JSON.stringify(snapshot);
  if (json === savedBase) return;
  savedBase = json;
  try { baseRepository.replaceSnapshot(snapshot); } catch { /* merges then keep both sides rather than delete */ }
}
const conflictMessage = (count: number) =>
  `這個帳號的資料已在其他裝置更新，其中 ${count} 筆記錄兩邊都改過，未有自動決定。本機的版本仍留在這部電腦；請在視窗逐筆選擇保留哪一份，選好之前不會寫上帳號端。`;
const blockedMessage = '這個帳號的資料已在其他裝置更新，但兩邊的改動在關聯上對不上，未能自動合併。本機版本仍然保留，未寫上帳號端；請先匯出 Excel 核對。';

/** Publish a snapshot the account端 has not been told about yet, then tell it. */
function publish(set: (partial: Partial<WorkspaceState>) => void, snapshot: OutreachSnapshot) {
  // An unresolved record conflict keeps its banner: the edit does not settle it.
  set(useWorkspace.getState().pendingConflicts.length ? { snapshot } : { snapshot, storageError: undefined });
  scheduleSync();
}
/**
 * Queue a pull-then-write. The snapshot is read when the queued task runs, not when the
 * edit happened, so a later edit always carries the newest merged copy to the account端.
 */
function scheduleSync() {
  const target = server;
  if (!target) return;
  writes = writes.then(() => push(target));
}
/**
 * Read the account端 and fold in what another device wrote, keeping this browser's changes.
 *
 * Returns `conflict` when the two sides changed the same record differently; the caller must
 * then leave the working copy alone and ask. Nothing is ever written here.
 */
async function reconcile(target: RemoteWorkspaceRepository): Promise<'ok' | 'conflict' | 'blocked'> {
  const record = await target.load();
  if (target !== server) return 'ok';
  if (!record) {
    // Nothing on the account端: this browser's copy is the first one, and there is no
    // common ancestor to compare a future write against.
    serverVersion = undefined; confirmed = ''; savedBase = '';
    return 'ok';
  }
  if (serverVersion !== undefined && record.version === serverVersion) return 'ok';
  const local = workingSnapshot();
  // The form the working copy will take, so comparisons do not trip over alignment.
  const remoteStored = repository.prepare(record.snapshot);
  serverVersion = record.version;
  confirmed = JSON.stringify(remoteStored);
  if (!local) {
    const stored = repository.replaceSnapshot(remoteStored);
    rememberBase(stored);
    useWorkspace.setState({ snapshot: stored });
    return 'ok';
  }
  const result = mergeSync(remoteStored, local, readBase());
  if (!result.snapshot) {
    useWorkspace.setState({ storageError: blockedMessage, pendingConflicts: [], conflictsOpen: false, syncBlocked: true });
    return 'blocked';
  }
  if (result.conflicts.length) {
    // The local copy is the only place the local version exists, so it stays exactly as
    // it is until the person has chosen; the account端 version is not adopted here.
    useWorkspace.setState({ snapshot: local, pendingConflicts: result.conflicts, conflictsOpen: true, storageError: conflictMessage(result.conflicts.length), syncBlocked: false });
    return 'conflict';
  }
  const stored = repository.replaceSnapshot(result.snapshot);
  // From now on the local changes are relative to what the account端 holds.
  rememberBase(remoteStored);
  useWorkspace.setState({ snapshot: stored, pendingConflicts: [], conflictsOpen: false, syncBlocked: false, ...(result.keptBoth
    ? { storageError: '這個帳號的資料已在其他裝置更新。兩邊的樓層／單位改動對不上，為免刪錯，已保留兩邊的資料（帳號端刪除的結構可能重新出現），請核對。' }
    : {}) });
  return 'ok';
}
/**
 * A failed write is reported, never swallowed: the banner says the change is on this
 * machine but not yet on the account端. A 409 means another device wrote between our pull
 * and our write, so the loop pulls again and folds the two copies together instead of
 * forcing this one through.
 */
async function push(target: RemoteWorkspaceRepository) {
  if (target !== server) return;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const outcome = await reconcile(target);
      if (target !== server) return;
      const awaitingChoice = useWorkspace.getState().pendingConflicts.length;
      if (awaitingChoice) {
        // Still undecided: pull again so a newer account端 version updates the question,
        // but never write a copy the person has not settled.
        useWorkspace.setState({ conflictsOpen: true, storageError: conflictMessage(awaitingChoice) });
        return;
      }
      if (outcome !== 'ok') return;
      const merged = workingSnapshot();
      if (!merged) return;
      const json = JSON.stringify(merged);
      if (json === confirmed) {
        if (useWorkspace.getState().storageError) useWorkspace.setState({ storageError: undefined });
        return;
      }
      try {
        const version = await target.save(merged, serverVersion);
        if (target !== server) return;
        serverVersion = version; confirmed = json;
        rememberBase(merged);
        if (useWorkspace.getState().storageError) useWorkspace.setState({ storageError: undefined });
        return;
      } catch (error) {
        if (target !== server) return;
        if (error instanceof ApiError && error.status === 409) continue;
        throw error;
      }
    }
    throw new ApiError(409, '工作區同時被其他裝置更新。');
  } catch (error) {
    if (target !== server) return;
    const conflict = error instanceof ApiError && error.status === 409;
    useWorkspace.setState({ storageError: conflict
      ? '這個帳號的資料不斷被其他裝置更新，本次改動未寫上帳號端。本機副本仍然保留，請稍後再試。'
      : '本次改動已儲存在本機，但未能同步到帳號端。請檢查網絡；本機副本仍然保留，稍後可再儲存。' });
  }
}
/**
 * Read the account端 copy and make it the working copy, merging rather than replacing.
 *
 * Two copies that differ are merged record by record (see data/syncMerge.ts). Only a record
 * both sides changed differently stops the merge and asks; nothing is silently dropped.
 */
async function loadRemote(target: RemoteWorkspaceRepository) {
  const local = workingSnapshot();
  try {
    const outcome = await reconcile(target);
    if (target !== server) return;
    // A fresh account端 copy, or a local copy whose changes were merged in, is still
    // something the account端 does not hold. Sending an unchanged copy costs no write.
    if (outcome === 'ok') scheduleSync();
    useWorkspace.setState({ loading: false, ...(outcome === 'ok' ? { storageError: undefined } : {}) });
  } catch (error) {
    if (target !== server) return;
    /*
     * Name what actually failed. A 404 is not a network problem: it means the running
     * account service predates this interface (a process started before the upgrade, or a
     * deployment that was never rebuilt), which sends people looking at their network.
     */
    const message = error instanceof ApiError
      ? error.status === 401 ? '登入已過期，未能讀取帳號端的資料。目前顯示的是本機副本。'
        : error.status === 404 ? '帳號服務的版本較舊，未提供工作區接口。請重新啟動或重新部署帳號服務，再重新整理。目前顯示的是本機副本。'
          : `帳號服務未能讀取工作區（HTTP ${error.status}）。目前顯示的是本機副本。`
      : error instanceof Error && error.name === 'ZodError'
        ? '帳號端的資料格式不完整，未有載入。目前顯示的是本機副本；請先匯出 Excel 核對。'
        : '未能連接帳號服務，目前顯示的是本機副本。恢復連線後請重新整理。';
    useWorkspace.setState({ loading: false, snapshot: local, storageError: message });
  }
}
interface WorkspaceState {
  snapshot?: OutreachSnapshot;
  /** True while the account端 copy is being read, so an empty start screen cannot be mistaken for an empty workspace. */
  loading: boolean;
  storageError?: string;
  /** Records the account端 and this browser both changed; nothing is written until they are settled. */
  pendingConflicts: SyncConflict[];
  /** Whether the conflict dialog is showing. Closing it keeps the question for later. */
  conflictsOpen: boolean;
  /** The two copies could not be merged at all; only an explicit decision can move them on. */
  syncBlocked: boolean;
  /** Hide the banner. The underlying state is unchanged: a real failure is reported again. */
  dismissStorageError: () => void;
  openConflicts: () => void;
  /** Close the dialog without deciding. The question stays until it is settled. */
  deferConflicts: () => void;
  /** Apply the person's choice per conflicted record, then write the result to the account端. */
  resolveConflicts: (choices: Readonly<Record<string, SyncChoice>>) => void;
  /** Last resort for a merge that cannot be reconciled: this browser's copy replaces the account端's. */
  forcePushLocal: () => void;
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
  pendingConflicts: [],
  conflictsOpen: false,
  syncBlocked: false,
  initialize: () => {
    if (server) { set({ loading: true, storageError: undefined }); return loadRemote(server); }
    try { set({ snapshot: repository.getSnapshot(), storageError: undefined }); }
    catch { set({ storageError: '本機資料未能讀取。原有資料保留；你可以重新匯入合成資料。' }); }
    return Promise.resolve();
  },
  dismissStorageError: () => set({ storageError: undefined }),
  openConflicts: () => set({ conflictsOpen: true }),
  deferConflicts: () => set(state => ({ conflictsOpen: false, ...(state.pendingConflicts.length ? { storageError: conflictMessage(state.pendingConflicts.length) } : {}) })),
  resolveConflicts: choices => {
    const target = server;
    const local = workingSnapshot();
    if (!target || !local) return;
    writes = writes.then(async () => {
      if (target !== server) return;
      try {
        const record = await target.load();
        if (target !== server) return;
        if (!record) {
          // Nothing left on the account端: this browser's copy can be written as the first one.
          const stored = repository.replaceSnapshot(local);
          serverVersion = undefined; confirmed = ''; savedBase = '';
          set({ snapshot: stored, pendingConflicts: [], conflictsOpen: false, syncBlocked: false, storageError: undefined });
          scheduleSync();
          return;
        }
        const remoteStored = repository.prepare(record.snapshot);
        const result = mergeSync(remoteStored, local, readBase(), choices);
        serverVersion = record.version;
        confirmed = JSON.stringify(remoteStored);
        if (!result.snapshot) { set({ pendingConflicts: [], conflictsOpen: false, syncBlocked: true, storageError: blockedMessage }); return; }
        if (result.conflicts.length) {
          // The account端 moved again while the question was open; ask about the new pair.
          set({ pendingConflicts: result.conflicts, conflictsOpen: true, storageError: conflictMessage(result.conflicts.length) });
          return;
        }
        const stored = repository.replaceSnapshot(result.snapshot);
        rememberBase(remoteStored);
        set({ snapshot: stored, pendingConflicts: [], conflictsOpen: false, syncBlocked: false, storageError: undefined });
        scheduleSync();
      } catch (error) {
        if (target !== server) return;
        set({ storageError: error instanceof ApiError && error.status === 401
          ? '登入已過期，未能把選擇寫上帳號端。本機副本仍然保留。'
          : '未能讀取帳號端的資料，選擇未寫上。本機副本仍然保留，請檢查網絡後再試。' });
      }
    });
  },
  forcePushLocal: () => {
    const target = server;
    if (!target) return;
    writes = writes.then(async () => {
      if (target !== server) return;
      try {
        const record = await target.load();
        if (target !== server) return;
        const local = workingSnapshot();
        if (!local) return;
        const version = await target.save(local, record?.version);
        if (target !== server) return;
        serverVersion = version; confirmed = JSON.stringify(local);
        rememberBase(local);
        set({ storageError: undefined, syncBlocked: false, pendingConflicts: [], conflictsOpen: false });
      } catch {
        if (target !== server) return;
        set({ storageError: '未能以本機版本寫上帳號端。本機副本仍然保留，請檢查網絡後重試。' });
      }
    });
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
    savedBase = '';
    try { baseRepository.clear(); } catch { /* an unreadable baseline only costs a conservative merge */ }
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
    set({ snapshot: undefined, storageError: undefined, pendingConflicts: [], conflictsOpen: false, syncBlocked: false, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined, expanded: false });
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
