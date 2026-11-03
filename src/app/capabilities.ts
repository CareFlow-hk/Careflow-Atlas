/**
 * What one account may do, in one place.
 *
 * 《C 方案》: a member may change, never take away (CLAUDE.md 3.5). The rule itself lives on
 * the server, where it is enforced row by row (`server/workspaceAccess.mjs`); this table only
 * says which buttons to draw. Hiding a button is not the permission — the server refuses the
 * write either way — so the two must agree, and `capabilities.test.ts` holds them together:
 * every capability that reads `false` here is a change the server answers `403`, and every
 * one that reads `true` is a change it never refuses.
 *
 * Data visibility is deliberately not here. One institution sees one workspace; a member
 * reading every household in it is the agreed design, not a gap.
 */
export type Role = 'ADMIN' | 'MEMBER';

export interface Capabilities {
  /** Remove a floor, a unit, or a 劏房 room — even one added a minute ago. */
  mayRemoveStructure: boolean;
  /** Remove anything else: a building, a person, a household, a residence, a membership. */
  mayRemoveRows: boolean;
  /** Rewrite a record that already exists. A member may only withdraw their own, below. */
  mayRewriteRecords: boolean;
  /** Withdraw anyone's record, not only one this account saved and nobody has touched. */
  mayWithdrawAnyRecord: boolean;
  /** Change a visit or a follow-up event once saved; both roles may still add them. */
  mayChangeVisitEvents: boolean;
  /** Empty the whole institution workspace, account-side copy included. */
  mayClearWorkspace: boolean;
  /** Invite accounts, change roles, stop accounts, read the audit log. */
  mayManageAccounts: boolean;
}

/**
 * `role` is absent only where there is no signed-in account — the demo repository used by
 * tests. That path has no server to arbitrate, so it keeps the behaviour it had before this
 * table existed: structure may be removed, and a record may only be withdrawn by its author.
 * A real session always carries a role.
 */
export function capabilities(role: Role | undefined): Capabilities {
  const admin = role === 'ADMIN';
  const demo = role === undefined;
  return {
    mayRemoveStructure: admin || demo,
    mayRemoveRows: admin || demo,
    mayRewriteRecords: admin || demo,
    mayWithdrawAnyRecord: admin,
    mayChangeVisitEvents: admin || demo,
    mayClearWorkspace: admin || demo,
    mayManageAccounts: admin,
  };
}
