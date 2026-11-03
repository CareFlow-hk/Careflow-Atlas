import { describe, expect, it } from 'vitest';
import { capabilities, type Capabilities, type Role } from './capabilities';
// @ts-expect-error The server is plain JavaScript without type declarations.
import { assertWorkspaceWrite } from '../../server/workspaceAccess.mjs';

/**
 * The button table must say what the server does. Every capability is exercised as a real
 * write against `server/workspaceAccess.mjs`: `false` here must come back `403` there, and
 * `true` must not. A rule changed on one side alone fails this file rather than showing a
 * colleague a button that refuses them.
 *
 * `mayManageAccounts` is not in the list: it is not a workspace rule but the `/api/admin/*`
 * guard in `server/http.mjs` (`assertSession(row, true)`, role must be `ADMIN`).
 */

type Capability = keyof Omit<Capabilities, 'mayManageAccounts'>;
type User = { id: string; name: string; role: Role };
type Workspace = Record<string, unknown[]>;

const staff: User = { id: 'acc-staff', name: '同事', role: 'MEMBER' };
const manager: User = { id: 'acc-manager', name: '管理員', role: 'ADMIN' };

/**
 * A workspace with one of everything. The record and the follow-up event were saved by
 * someone else, so neither role can treat them as its own work.
 */
function workspace(): Workspace {
  return {
    buildings: [{ id: 'B1', name: '一幢大廈' }],
    floors: [{ id: 'F1', buildingId: 'B1', label: '1 樓', level: 1 }],
    units: [{ id: 'U1', floorId: 'F1', label: '1樓 A室' }],
    people: [{ id: 'P1', displayName: '陳' }],
    households: [{ id: 'H1' }],
    householdMemberships: [{ id: 'HM1' }],
    householdResidences: [{ id: 'HR1' }],
    memberships: [{ id: 'M1' }],
    visits: [{ id: 'V1', buildingId: 'B1' }],
    observations: [{ id: 'O1', note: '第一次到訪', createdBy: { accountId: 'acc-other', name: '同事甲' } }],
    followUpEvents: [{ id: 'E1', operator: { accountId: 'acc-other', name: '同事甲' }, action: 'RESOLVE' }],
  };
}

interface Case { capability: Capability; what: string; change: (ws: Workspace, user: User) => Workspace }
const cases: Case[] = [
  { capability: 'mayRemoveStructure', what: '刪除一個樓層', change: ws => ({ ...ws, floors: [] }) },
  { capability: 'mayRemoveRows', what: '刪除一個人', change: ws => ({ ...ws, people: [] }) },
  { capability: 'mayRewriteRecords', what: '改寫別人的記錄', change: ws => ({ ...ws, observations: [{ ...ws.observations[0] as object, note: '改寫' }] }) },
  { capability: 'mayWithdrawAnyRecord', what: '撤回別人的記錄', change: (ws, user) => ({ ...ws, observations: [{ ...ws.observations[0] as object, deleted: { at: '2026-11-01T00:00:00.000Z', by: { accountId: user.id, name: user.name } } }] }) },
  { capability: 'mayChangeVisitEvents', what: '修改已儲存的到訪', change: ws => ({ ...ws, visits: [{ ...ws.visits[0] as object, note: '後補' }] }) },
  { capability: 'mayClearWorkspace', what: '清空整個工作區', change: () => ({}) },
];

/** Whether the server takes the write, and that a refusal is a `403` and not something else. */
function serverAllows(user: User, next: Workspace): boolean {
  try {
    assertWorkspaceWrite(user, workspace(), next);
    return true;
  } catch (error) {
    expect((error as { status?: number }).status, (error as Error).message).toBe(403);
    return false;
  }
}

describe('能力表與伺服器規則一致', () => {
  for (const user of [staff, manager]) {
    for (const item of cases) {
      it(`${user.role}：${item.what}`, () => {
        const allowed = serverAllows(user, item.change(workspace(), user));
        expect(capabilities(user.role)[item.capability], `${item.capability} 與伺服器判定不一致`).toBe(allowed);
      });
    }
  }
});

describe('沒有登入帳號的示範路徑', () => {
  /*
   * Tests and the retired demo run without an account and have no server to arbitrate. The
   * table keeps what that path already did: structure and rows may be removed, a record may
   * still only be withdrawn by its author.
   */
  const demo = capabilities(undefined);
  it('可以刪除結構與其他資料', () => {
    expect(demo.mayRemoveStructure).toBe(true);
    expect(demo.mayRemoveRows).toBe(true);
    expect(demo.mayClearWorkspace).toBe(true);
  });
  it('記錄仍只可撤回自己建立、未被改動的', () => {
    expect(demo.mayWithdrawAnyRecord).toBe(false);
    expect(demo.mayRewriteRecords).toBe(true);
  });
  it('帳號管理不對任何沒有角色的路徑開放', () => {
    expect(demo.mayManageAccounts).toBe(false);
    expect(capabilities('MEMBER').mayManageAccounts).toBe(false);
    expect(capabilities('ADMIN').mayManageAccounts).toBe(true);
  });
});
