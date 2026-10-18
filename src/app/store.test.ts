import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoSnapshot } from '../data/demoFixture';
import { setWorkspaceAccount, useWorkspace } from './store';

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

/*
 * The account端 copy. A signed-in account reads and writes the server's snapshot; a write
 * that never reached it is reported in the banner rather than shown as saved, and a copy
 * another device already changed is not overwritten.
 */
describe('the workspace the account端 holds', () => {
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
  function serverStub() {
    let record: { snapshot: unknown; version: number } | undefined;
    let fail: number | undefined;
    const calls: { method: string; body: { snapshot?: unknown; baseVersion?: number } }[] = [];
    const fetch = async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, body });
      if (fail) { const status = fail; fail = undefined; return reply(status, { error: '拒絕' }); }
      if (method === 'GET') return reply(200, record ?? {});
      if (method === 'PUT') {
        // The real server refuses a write that started from a version it no longer holds.
        if (record && body.baseVersion !== record.version) return reply(409, { error: '資料已在其他裝置更新。' });
        record = { snapshot: body.snapshot, version: (record?.version ?? 0) + 1 };
        return reply(200, { version: record.version });
      }
      if (method === 'DELETE') { record = undefined; return reply(200, { ok: true }); }
      return reply(404, { error: '找不到接口。' });
    };
    return { fetch, calls, get record() { return record; }, set record(value) { record = value; }, fail: (status: number) => { fail = status; } };
  }
  const values = new Map<string, string>();
  const localKey = 'careflow-atlas.account.account-a.demo';
  const start = async (server: ReturnType<typeof serverStub>) => {
    vi.stubGlobal('fetch', server.fetch);
    setWorkspaceAccount('account-a', '合成操作員', true);
    await useWorkspace.getState().initialize();
  };
  const put = (server: ReturnType<typeof serverStub>) => server.calls.find(call => call.method === 'PUT');

  beforeEach(() => { values.clear(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }); });
  afterEach(() => { setWorkspaceAccount(); vi.unstubAllGlobals(); });

  it('loads the copy the account端 holds and keeps a differing local one as a backup', async () => {
    const server = serverStub();
    const stale = structuredClone(demoSnapshot); stale.people[0].phone = '99999999';
    values.set(localKey, JSON.stringify(stale));
    server.record = { snapshot: demoSnapshot, version: 3 };
    await start(server);
    expect(useWorkspace.getState().snapshot?.people[0].phone).not.toBe('99999999');
    expect(useWorkspace.getState().storageError).toContain('未有自動合併');
    expect(JSON.parse(values.get(`${localKey}.backup`)!).people[0].phone).toBe('99999999');
  });

  /*
   * A running account service older than the interface answers 404. Saying "check your
   * network" sends people to the wrong place; the message has to name the stale service.
   */
  it('names an account service that is older than the workspace interface', async () => {
    const server = serverStub();
    vi.stubGlobal('fetch', async () => reply(404, { error: '找不到接口。' }));
    setWorkspaceAccount('account-a', '合成操作員', true);
    await useWorkspace.getState().initialize();
    expect(useWorkspace.getState().storageError).toContain('帳號服務的版本較舊');
    expect(useWorkspace.getState().loading).toBe(false);
    void server;
  });

  it('writes a change to the account端 with the version it read', async () => {
    const server = serverStub();
    server.record = { snapshot: demoSnapshot, version: 3 };
    await start(server);
    const changed = structuredClone(demoSnapshot); changed.people[0].phone = '12345678';
    useWorkspace.getState().importSnapshot(changed);
    await vi.waitFor(() => expect(put(server)).toBeTruthy());
    expect(put(server)?.body.baseVersion).toBe(3);
    expect(server.record?.version).toBe(4);
  });

  /* An unchanged snapshot is not sent again: saving the same file twice costs no write. */
  it('does not write a snapshot the account端 already holds', async () => {
    const server = serverStub();
    server.record = { snapshot: demoSnapshot, version: 3 };
    await start(server);
    useWorkspace.getState().importSnapshot(structuredClone(demoSnapshot));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(put(server)).toBeUndefined();
  });

  it('pushes this browser\'s copy up when the account端 holds nothing yet', async () => {
    const server = serverStub();
    values.set(localKey, JSON.stringify(demoSnapshot));
    await start(server);
    await vi.waitFor(() => expect(put(server)).toBeTruthy());
    expect(put(server)?.body.baseVersion).toBeUndefined();
    expect(server.record?.version).toBe(1);
  });

  it('says a change did not reach the account端 instead of showing it saved', async () => {
    const server = serverStub();
    server.record = { snapshot: demoSnapshot, version: 1 };
    await start(server);
    server.fail(500);
    const changed = structuredClone(demoSnapshot); changed.people[0].phone = '12345678';
    useWorkspace.getState().importSnapshot(changed);
    await vi.waitFor(() => expect(useWorkspace.getState().storageError).toContain('未能同步到帳號端'));
    expect(server.record?.version).toBe(1);
  });

  it('does not overwrite a change another device already wrote', async () => {
    const server = serverStub();
    server.record = { snapshot: demoSnapshot, version: 3 };
    await start(server);
    // Another device moved the server on while this tab still held version 3.
    const elsewhere = structuredClone(demoSnapshot); elsewhere.people[0].phone = '88888888';
    server.record = { snapshot: elsewhere, version: 4 };
    const changed = structuredClone(demoSnapshot); changed.people[0].phone = '12345678';
    useWorkspace.getState().importSnapshot(changed);
    await vi.waitFor(() => expect(useWorkspace.getState().storageError).toContain('已在其他裝置更新'));
    expect(JSON.parse(JSON.stringify(server.record?.snapshot)).people[0].phone).toBe('88888888');
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
