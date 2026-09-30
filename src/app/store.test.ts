import { beforeEach, describe, expect, it, vi } from 'vitest';
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
