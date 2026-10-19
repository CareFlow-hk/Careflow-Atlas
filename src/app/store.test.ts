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
 * Colleagues of one institution work on one copy. Two accounts of the same institution must
 * see each other's records in this browser, or the shared server copy would be merged against
 * a local copy that pretends to be empty.
 */
describe('one working copy per institution', () => {
  const stub = () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    return values;
  };
  afterEach(() => { setWorkspaceAccount(); vi.unstubAllGlobals(); });

  it('shows the same records to another account of the same institution', async () => {
    stub();
    setWorkspaceAccount({ id: 'account-a', name: '同事甲', role: 'MEMBER', orgId: 'org-one' });
    await useWorkspace.getState().initialize();
    expect(useWorkspace.getState().snapshot).toBeUndefined();
    useWorkspace.getState().importSnapshot(demoSnapshot);

    setWorkspaceAccount({ id: 'account-b', name: '同事乙', role: 'ADMIN', orgId: 'org-one' });
    await useWorkspace.getState().initialize();
    expect(useWorkspace.getState().snapshot?.buildings.length).toBe(demoSnapshot.buildings.length);
    expect(useWorkspace.getState().role).toBe('ADMIN');
  });

  it('keeps two institutions apart', async () => {
    stub();
    setWorkspaceAccount({ id: 'account-a', name: '同事甲', role: 'MEMBER', orgId: 'org-one' });
    await useWorkspace.getState().initialize();
    useWorkspace.getState().importSnapshot(demoSnapshot);

    setWorkspaceAccount({ id: 'account-c', name: '同事丙', role: 'MEMBER', orgId: 'org-two' });
    await useWorkspace.getState().initialize();
    expect(useWorkspace.getState().snapshot).toBeUndefined();
  });

  it('adopts a person\'s own earlier copy the first time the institution copy is created', async () => {
    const values = stub();
    // The copy this account had before accounts shared a workspace.
    values.set('careflow-atlas.account.account-a.demo', JSON.stringify(demoSnapshot));
    setWorkspaceAccount({ id: 'account-a', name: '同事甲', role: 'MEMBER', orgId: 'org-one' });
    await useWorkspace.getState().initialize();
    expect(useWorkspace.getState().snapshot?.buildings.length).toBe(demoSnapshot.buildings.length);
    // The old key is left where it is: nothing is destroyed by the change.
    expect(values.has('careflow-atlas.account.account-a.demo')).toBe(true);
  });
});

/*
 * Withdrawing is the one thing a member may do to a record, and only to their own. The store
 * must refuse what the server refuses, so the button never promises something that will fail.
 */
describe('withdrawing a record', () => {
  const input = {
    id: 'withdraw-me', visitId: 'visit-withdraw', buildingId: 'bldg-yu-an', floorId: 'bldg-yu-an-f5', unitId: 'bldg-yu-an-f5-B',
    occurredAt: '2026-03-01T02:00:00.000Z', recordedAt: '2026-03-01T02:00:00.000Z', workerName: '合成工作員',
    coverage: 'VISITED_NO_FINDING' as const, evidence: [], note: '合成內容',
  };
  beforeEach(async () => {
    // A real store: importSnapshot writes here and initialize reads it back.
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    setWorkspaceAccount({ id: 'account-a', name: '同事甲', role: 'MEMBER', orgId: 'org-one' });
    await useWorkspace.getState().initialize();
    useWorkspace.getState().importSnapshot(structuredClone(demoSnapshot));
  });
  afterEach(() => { setWorkspaceAccount(); vi.unstubAllGlobals(); });

  it('names the person who saved the record, and lets them withdraw it', () => {
    useWorkspace.getState().saveObservation(input);
    expect(useWorkspace.getState().snapshot?.observations.find(item => item.id === input.id)?.createdBy).toEqual({ accountId: 'account-a', name: '同事甲' });
    const result = useWorkspace.getState().deleteObservation(input.id);
    expect(result).toHaveProperty('message');
    const stored = useWorkspace.getState().snapshot?.observations.find(item => item.id === input.id);
    // The row is still there, marked — not removed.
    expect(stored?.deleted).toMatchObject({ by: { accountId: 'account-a', name: '同事甲' } });
  });

  it('refuses a member another person\'s record or a row recorded before accounts existed', () => {
    const legacy = demoSnapshot.observations[0].id;
    expect(useWorkspace.getState().deleteObservation(legacy)).toEqual({ error: expect.stringContaining('員工只能撤回自己') });
    expect(useWorkspace.getState().snapshot?.observations.find(item => item.id === legacy)?.deleted).toBeUndefined();
    // Withdrawing the same record twice is refused, and the first marker is kept.
    useWorkspace.getState().saveObservation(input);
    expect(useWorkspace.getState().deleteObservation(input.id)).toHaveProperty('message');
    expect(useWorkspace.getState().deleteObservation(input.id)).toEqual({ error: expect.stringContaining('已經撤回') });
  });

  it('lets an administrator withdraw a record they did not save', async () => {
    const legacy = demoSnapshot.observations[0].id;
    setWorkspaceAccount({ id: 'account-admin', name: '管理員', role: 'ADMIN', orgId: 'org-one' });
    await useWorkspace.getState().initialize();
    expect(useWorkspace.getState().deleteObservation(legacy)).toHaveProperty('message');
    expect(useWorkspace.getState().snapshot?.observations.find(item => item.id === legacy)?.deleted?.by.accountId).toBe('account-admin');
  });
});

/*
 * Structure is additive for a member. Adding stays open — the team works on the same
 * buildings — but every way of taking a place away is the administrator's, including a
 * unit the member added a moment ago (2026-10-19 review). The refusal happens before the
 * working copy is touched, so nothing is left on this machine for the server to refuse
 * again on every later save.
 */
describe('a member cannot take structure away', () => {
  const member = { id: 'account-member', name: '同事甲', role: 'MEMBER' as const, orgId: 'org-one' };
  beforeEach(async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    setWorkspaceAccount(member);
    await useWorkspace.getState().initialize();
    useWorkspace.getState().importSnapshot(structuredClone(demoSnapshot));
  });
  afterEach(() => { setWorkspaceAccount(); vi.unstubAllGlobals(); });

  const units = () => useWorkspace.getState().snapshot!.units;
  const refusal = { error: expect.stringContaining('員工不能刪除樓層、單位或劏房') };

  it('refuses deleting a floor or a unit and leaves the working copy as it was', () => {
    const before = units().length;
    const floor = useWorkspace.getState().snapshot!.floors[0];
    const unit = units().find(item => item.floorId === floor.id)!;
    expect(useWorkspace.getState().changeStructure({ kind: 'removeUnits', unitIds: [unit.id], confirmed: true })).toEqual(refusal);
    expect(useWorkspace.getState().changeStructure({ kind: 'removeFloor', floorId: floor.id, confirmed: true })).toEqual(refusal);
    expect(units().length).toBe(before);
  });

  it('refuses merging 劏房 rooms back, though splitting into more stays open', () => {
    const parent = units().find(item => !item.parentUnitId)!;
    const before = units().length;
    // Splitting is additive: it adds rooms and takes none away.
    expect(useWorkspace.getState().changeStructure({ kind: 'split', unitId: parent.id, rooms: 2 })).toHaveProperty('message');
    expect(units().length).toBe(before + 2);
    // 1 merges them back — that is a delete, even though the member made the rooms.
    expect(useWorkspace.getState().changeStructure({ kind: 'split', unitId: parent.id, rooms: 1 })).toEqual(refusal);
    expect(units().length).toBe(before + 2);
  });

  it('still lets a member add a floor and a unit', () => {
    const before = units().length;
    expect(useWorkspace.getState().changeStructure({ kind: 'addFloors', buildingId: 'bldg-yu-an', count: 1, unitsPerFloor: 1 })).toHaveProperty('message');
    expect(units().length).toBe(before + 1);
    const floor = useWorkspace.getState().snapshot!.floors.find(item => item.buildingId === 'bldg-yu-an')!;
    expect(useWorkspace.getState().changeStructure({ kind: 'addUnit', floorId: floor.id })).toHaveProperty('message');
    expect(units().length).toBe(before + 2);
  });

  it('lets an administrator delete the same unit', async () => {
    setWorkspaceAccount({ id: 'account-admin', name: '管理員', role: 'ADMIN', orgId: 'org-one' });
    await useWorkspace.getState().initialize();
    const before = units().length;
    const unit = units().find(item => !item.parentUnitId)!;
    expect(useWorkspace.getState().changeStructure({ kind: 'removeUnits', unitIds: [unit.id], confirmed: true })).toHaveProperty('message');
    expect(units().length).toBeLessThan(before);
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
      // Persistent until cleared: a pull now runs before every write, so "the next request"
      // is not the one the caller meant.
      if (fail) return reply(fail, { error: '拒絕' });
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
    return { fetch, calls, get record() { return record; }, set record(value) { record = value; }, fail: (status?: number) => { fail = status; } };
  }
  const values = new Map<string, string>();
  const localKey = 'careflow-atlas.account.account-a.demo';
  /** Let the queue the load itself scheduled finish, so a test's next move is not racing it. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const start = async (server: ReturnType<typeof serverStub>) => {
    vi.stubGlobal('fetch', server.fetch);
    setWorkspaceAccount('account-a', '合成操作員', true);
    await useWorkspace.getState().initialize();
    await settle();
  };
  const put = (server: ReturnType<typeof serverStub>) => server.calls.find(call => call.method === 'PUT');

  beforeEach(() => { values.clear(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }); });
  afterEach(() => { setWorkspaceAccount(); vi.unstubAllGlobals(); });

  /*
   * A local copy from before this browser remembered a sync baseline has no common ancestor
   * with the account端 copy, so an edit both sides made cannot be attributed. It is not
   * guessed at: the local copy stays exactly where it is and the person is asked.
   */
  it('asks about a record both sides changed instead of replacing the local copy', async () => {
    const server = serverStub();
    const stale = structuredClone(demoSnapshot); stale.people[0].phone = '99999999';
    values.set(localKey, JSON.stringify(stale));
    server.record = { snapshot: demoSnapshot, version: 3 };
    await start(server);
    expect(useWorkspace.getState().snapshot?.people[0].phone).toBe('99999999');
    expect(useWorkspace.getState().pendingConflicts).toHaveLength(1);
    expect(useWorkspace.getState().conflictsOpen).toBe(true);
    expect(useWorkspace.getState().storageError).toContain('未有自動決定');
    expect(server.record?.version).toBe(3);
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

  /*
   * A 403 is the server refusing the change itself. Keeping the refused copy here would make
   * every later save fail the same way, so the working copy goes back to what the account端
   * holds and the banner names the permission — not a network that was never down.
   */
  it('names a refusal instead of the network, and does not keep the refused change', async () => {
    const server = serverStub();
    server.record = { snapshot: demoSnapshot, version: 3 };
    await start(server);
    server.fail(403);
    const changed = structuredClone(demoSnapshot); changed.people[0].phone = '12345678';
    useWorkspace.getState().importSnapshot(changed);
    await vi.waitFor(() => expect(useWorkspace.getState().storageError).toContain('拒絕'));
    expect(useWorkspace.getState().storageError).not.toContain('檢查網絡');
    expect(useWorkspace.getState().snapshot?.people[0].phone).toBe(demoSnapshot.people[0].phone);
    expect(server.record?.version).toBe(3);
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

  /*
   * The reason a pull runs before every write: another device's change is folded in first,
   * so this tab's write carries both. It is not a version-check that throws the local copy
   * away, and it is not a blind overwrite either.
   */
  it('keeps this browser\'s change and folds in what another device wrote', async () => {
    const server = serverStub();
    server.record = { snapshot: demoSnapshot, version: 3 };
    await start(server);
    const elsewhere = structuredClone(demoSnapshot); elsewhere.people[0].phone = '88888888';
    server.record = { snapshot: elsewhere, version: 4 };
    const changed = structuredClone(demoSnapshot); changed.people[1].phone = '12345678';
    useWorkspace.getState().importSnapshot(changed);
    await vi.waitFor(() => expect(server.record?.version).toBe(5));
    const written = server.record!.snapshot as typeof demoSnapshot;
    expect(written.people[0].phone).toBe('88888888');
    expect(written.people[1].phone).toBe('12345678');
  });

  /* The same record changed on both devices: stop and ask, then write the choice back. */
  it('asks before choosing, then writes the choice to the account端', async () => {
    const server = serverStub();
    server.record = { snapshot: demoSnapshot, version: 3 };
    await start(server);
    const elsewhere = structuredClone(demoSnapshot); elsewhere.people[0].phone = '88888888';
    server.record = { snapshot: elsewhere, version: 4 };
    const changed = structuredClone(demoSnapshot); changed.people[0].phone = '12345678';
    useWorkspace.getState().importSnapshot(changed);
    await vi.waitFor(() => expect(useWorkspace.getState().pendingConflicts).toHaveLength(1));
    // Nothing is written while the question is open, and the account端 keeps its version.
    expect(server.record?.version).toBe(4);
    expect((server.record!.snapshot as typeof demoSnapshot).people[0].phone).toBe('88888888');
    const [conflict] = useWorkspace.getState().pendingConflicts;
    useWorkspace.getState().resolveConflicts({ [conflict.key]: 'local' });
    await vi.waitFor(() => expect(server.record?.version).toBe(5));
    expect((server.record!.snapshot as typeof demoSnapshot).people[0].phone).toBe('12345678');
    expect(useWorkspace.getState().pendingConflicts).toHaveLength(0);
    expect(useWorkspace.getState().conflictsOpen).toBe(false);
  });

  it('lets the person close the banner', async () => {
    const server = serverStub();
    server.record = { snapshot: demoSnapshot, version: 1 };
    await start(server);
    server.fail(500);
    const changed = structuredClone(demoSnapshot); changed.people[0].phone = '12345678';
    useWorkspace.getState().importSnapshot(changed);
    await vi.waitFor(() => expect(useWorkspace.getState().storageError).toContain('未能同步到帳號端'));
    useWorkspace.getState().dismissStorageError();
    expect(useWorkspace.getState().storageError).toBeUndefined();
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
