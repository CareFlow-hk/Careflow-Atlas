import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoSnapshot } from '../data/demoFixture';
import { useWorkspace } from './store';

describe('building focus', () => {
  beforeEach(() => useWorkspace.setState({ snapshot: demoSnapshot, expanded: false, selectedBuildingId: undefined, selectedFloorId: undefined, selectedUnitId: undefined }));
  it('opens declared floors by default and clears the previous location selection', () => {
    useWorkspace.getState().selectBuilding('bldg-yu-an');
    expect(useWorkspace.getState().expanded).toBe(true);
    useWorkspace.getState().selectUnit('bldg-yu-an-f5-B');
    useWorkspace.getState().selectBuilding('bldg-hoi-king');
    expect(useWorkspace.getState()).toMatchObject({ expanded: true, selectedUnitId: undefined, selectedFloorId: undefined });
  });
  it('keeps unknown layouts intact and restores the overview', () => {
    useWorkspace.getState().selectBuilding('bldg-on-wo');
    expect(useWorkspace.getState().expanded).toBe(false);
    useWorkspace.getState().selectBuilding();
    expect(useWorkspace.getState()).toMatchObject({ selectedBuildingId: undefined, expanded: false });
  });
  /*
   * Clearing the unit is how the panel's blank areas go back to the building's own ledger
   * and footer button. The building and floor stay: the person stepped out of one unit,
   * not out of the building.
   */
  it('steps out of a unit without leaving the building', () => {
    useWorkspace.getState().selectBuilding('bldg-yu-an');
    useWorkspace.getState().selectUnit('bldg-yu-an-f5-B');
    useWorkspace.getState().selectUnit(undefined);
    expect(useWorkspace.getState()).toMatchObject({ selectedBuildingId: 'bldg-yu-an', selectedFloorId: 'bldg-yu-an-f5', selectedUnitId: undefined, expanded: true });
  });
  it('leaves the selection alone for a unit that is not there', () => {
    useWorkspace.getState().selectUnit('bldg-yu-an-f5-B');
    useWorkspace.getState().selectUnit('bldg-yu-an-f9-Z');
    expect(useWorkspace.getState().selectedUnitId).toBe('bldg-yu-an-f5-B');
  });
});

describe('Excel merge persistence', () => {
  it('re-reads changes made after review and keeps newer records', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    try {
      useWorkspace.getState().importSnapshot(demoSnapshot);
      const latest = structuredClone(demoSnapshot); latest.people[0].phone = '0012345';
      values.set('careflow-field-outreach.snapshot', JSON.stringify(latest));
      useWorkspace.getState().mergeSnapshot(demoSnapshot, demoSnapshot);
      expect(useWorkspace.getState().snapshot?.people[0].phone).toBe('0012345');
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not publish success or overwrite storage when writing fails', () => {
    const stored = JSON.stringify(demoSnapshot);
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: () => { throw new Error('QuotaExceededError'); } });
    try {
      useWorkspace.setState({ snapshot: demoSnapshot });
      const incoming = structuredClone(demoSnapshot); incoming.people[0].phone = '0012345';
      expect(() => useWorkspace.getState().mergeSnapshot(incoming, demoSnapshot)).toThrow('本機儲存失敗');
      expect(useWorkspace.getState().snapshot).toEqual(demoSnapshot);
      expect(JSON.parse(stored)).toEqual(demoSnapshot);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('account demo cache isolation', () => {
  it('clears in-memory data on logout and does not adopt another account or legacy cache', async () => {
    const { setWorkspaceAccount } = await import('./store');
    const values = new Map<string, string>([['careflow-field-outreach.snapshot', JSON.stringify(demoSnapshot)]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    try {
      setWorkspaceAccount('account-a'); useWorkspace.getState().initialize();
      expect(useWorkspace.getState().snapshot).toBeUndefined();
      useWorkspace.getState().importSnapshot(demoSnapshot);
      setWorkspaceAccount(); expect(useWorkspace.getState().snapshot).toBeUndefined();
      setWorkspaceAccount('account-b'); useWorkspace.getState().initialize();
      expect(useWorkspace.getState().snapshot).toBeUndefined();
      setWorkspaceAccount('account-a'); useWorkspace.getState().initialize();
      expect(useWorkspace.getState().snapshot?.buildings.length).toBe(demoSnapshot.buildings.length);
    } finally { setWorkspaceAccount(); vi.unstubAllGlobals(); }
  });
});

/*
 * One result at every unit of a selection. What the batch must not do is claim more than it
 * did: units that cannot be confirmed free of 劏房 are counted and said out loud rather than
 * dropped, and nothing is written at all if the records cannot be stored.
 */
describe('recording the same result at several units', () => {
  const units = ['bldg-yu-an-f6-A', 'bldg-yu-an-f6-B'];
  const inputs = units.map((unitId, index) => ({
    id: `batch-${index}`, visitId: 'visit-batch', buildingId: 'bldg-yu-an', floorId: 'bldg-yu-an-f6', unitId,
    occurredAt: '2026-03-01T02:00:00.000Z', recordedAt: '2026-03-01T02:00:00.000Z', workerName: '合成工作員',
    coverage: 'VISITED_NO_FINDING' as const, assessment: 'STAFF_VERIFIED' as const, evidence: [], note: '合成內容',
  }));
  // A batch goes through the same repository the single-record path uses, so the fixture has
  // to be imported rather than dropped into state: the repository is what holds the file.
  const stored = (snapshot = demoSnapshot) => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    useWorkspace.getState().importSnapshot(structuredClone(snapshot));
  };
  const confirmedFree = (unitId: string) => Boolean(useWorkspace.getState().snapshot!.units.find(unit => unit.id === unitId)?.noSubdivision);

  beforeEach(() => stored());
  afterEach(() => vi.unstubAllGlobals());

  it('writes one record per unit', () => {
    const result = useWorkspace.getState().recordBatch(inputs, false);
    expect(result).toEqual({ saved: 2, confirmed: 0, skipped: 0 });
    const written = useWorkspace.getState().snapshot!.observations.filter(item => item.id.startsWith('batch-'));
    expect(written.map(item => item.unitId)).toEqual(units);
  });

  it('does not confirm anything unless it was asked to', () => {
    useWorkspace.getState().recordBatch(inputs, false);
    for (const unitId of units) expect(confirmedFree(unitId)).toBe(false);
  });

  it('confirms every unit in one step when it was asked to', () => {
    const result = useWorkspace.getState().recordBatch(inputs, true);
    expect(result).toMatchObject({ saved: 2, confirmed: 2 });
    for (const unitId of units) expect(confirmedFree(unitId)).toBe(true);
  });

  /* A unit already split into rooms cannot be declared free of 劏房; it is reported, not dropped. */
  it('counts the units it could not confirm and still records the rest', () => {
    const withRooms = structuredClone(demoSnapshot);
    const parent = withRooms.units.find(unit => unit.id === units[0])!;
    withRooms.units.push({ ...parent, id: 'room-1', label: 'A1室', parentUnitId: parent.id });
    stored(withRooms);
    const result = useWorkspace.getState().recordBatch(inputs, true);
    expect(result).toMatchObject({ saved: 2, confirmed: 1, skipped: 1 });
    // The records are written for both units: only the 無劏房 confirmation is refused.
    expect(useWorkspace.getState().snapshot!.observations.filter(item => item.id.startsWith('batch-'))).toHaveLength(2);
    expect(confirmedFree(units[0])).toBe(false);
    expect(confirmedFree(units[1])).toBe(true);
  });

  it('writes nothing when the records cannot be stored', () => {
    const before = useWorkspace.getState().snapshot;
    expect(() => useWorkspace.getState().recordBatch([{ ...inputs[0], coverage: 'NOT_A_COVERAGE' as never }], false)).toThrow();
    expect(useWorkspace.getState().snapshot).toBe(before);
  });

  it('says so when there is no data loaded', () => {
    useWorkspace.setState({ snapshot: undefined });
    expect(() => useWorkspace.getState().recordBatch(inputs, false)).toThrow('請先載入資料');
  });
});

describe('closing a task in the app', () => {
  it('names the signed-in account as operator, and refuses when nobody is signed in', async () => {
    const { setWorkspaceAccount } = await import('./store');
    const { getOpenFollowUps } = await import('../domain/types');
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    try {
      setWorkspaceAccount('account-a', '合成操作員');
      useWorkspace.getState().importSnapshot(demoSnapshot);
      const [task] = getOpenFollowUps(demoSnapshot);
      useWorkspace.getState().actOnFollowUp(task.observationId, 'DONE');
      const [event] = useWorkspace.getState().snapshot!.followUpEvents!;
      expect(event.operator).toEqual({ accountId: 'account-a', name: '合成操作員' });
      expect(getOpenFollowUps(useWorkspace.getState().snapshot!).some(open => open.observationId === task.observationId)).toBe(false);
      setWorkspaceAccount();
      useWorkspace.setState({ snapshot: demoSnapshot });
      expect(() => useWorkspace.getState().actOnFollowUp(task.observationId, 'DONE')).toThrow('請先登入');
    } finally { setWorkspaceAccount(); vi.unstubAllGlobals(); }
  });
});
