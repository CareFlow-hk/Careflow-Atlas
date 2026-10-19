import { requireValue } from './auth.mjs';

/**
 * Who may change what inside the institution's shared snapshot.
 *
 * The workspace is written as a whole document, so the check compares the stored copy with
 * the incoming one record by record. Two roles differ in two places:
 *
 * - a member may only withdraw (soft-delete) a record they created, never remove one;
 * - a member may not take a floor, a unit or a 劏房 room away at all — not even an empty
 *   unit they added themselves (2026-10-19 review). Adding structure, editing records,
 *   follow-ups, photo intake and Excel import stay open to both roles, because the team
 *   works on the same buildings.
 *
 * A structure delete reaches the server as removed floors/units plus the records that went
 * with them; both are refused here, so neither route can be used to get around the other.
 *
 * The comparison is canonical JSON, not raw text: property order must not decide whether a
 * record changed. Records are matched by id, never by content.
 */
export const WORKSPACE_COLLECTIONS = [
  'buildings', 'floors', 'units', 'people', 'households', 'householdMemberships',
  'householdResidences', 'memberships', 'visits', 'observations', 'followUpEvents',
];

const rowsOf = (snapshot, collection) => Array.isArray(snapshot?.[collection]) ? snapshot[collection] : [];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function index(rows) {
  return new Map(rows.filter(row => row && typeof row.id === 'string').map(row => [row.id, row]));
}

/** Added, changed and removed rows, matched by id. */
export function diffSnapshots(previous, next) {
  const changes = [];
  for (const collection of WORKSPACE_COLLECTIONS) {
    const before = index(rowsOf(previous, collection));
    const after = index(rowsOf(next, collection));
    for (const [id, row] of after) {
      const old = before.get(id);
      if (!old) changes.push({ collection, id, kind: 'added', next: row });
      else if (canonical(old) !== canonical(row)) changes.push({ collection, id, kind: 'changed', previous: old, next: row });
    }
    for (const [id, row] of before) {
      if (!after.has(id)) changes.push({ collection, id, kind: 'removed', previous: row });
    }
  }
  return changes;
}

/** Everything except the withdrawal marker; a member may not change any of it. */
function withoutDeletion(row) {
  const rest = { ...row };
  delete rest.deleted;
  return rest;
}

function isOwnWithdrawal(change, user) {
  const owner = change.previous?.createdBy?.accountId;
  if (owner !== user.id) return false;
  if (canonical(withoutDeletion(change.previous)) !== canonical(withoutDeletion(change.next))) return false;
  // The person who withdrew it is the person acting now; a marker naming someone else is
  // not a withdrawal this account is allowed to have written.
  if (change.next.deleted) {
    const by = change.next.deleted.by;
    if (!by || by.accountId !== user.id) return false;
    if (typeof change.next.deleted.at !== 'string' || change.next.deleted.at.length > 64) return false;
  }
  return true;
}

/**
 * Refuse a write that steps outside the caller's role. Returns nothing; throws `HttpError`.
 * Only a real change is checked, so a merge that carries another device's rows back
 * unchanged costs nothing.
 */
export function assertWorkspaceWrite(user, previous, next) {
  if (user.role === 'ADMIN' || !previous) return;
  for (const change of diffSnapshots(previous, next)) {
    if (change.collection === 'observations') {
      if (change.kind === 'added') continue;
      requireValue(change.kind === 'changed', 403, '員工不能刪除記錄；如需移除，請聯絡管理員。');
      requireValue(isOwnWithdrawal(change, user), 403, '員工只能撤回自己建立、且內容未被改動的記錄。');
      continue;
    }
    /*
     * Structure is additive for a member: floors, units and 劏房 rooms can be added, never
     * taken away. The removal is refused on its own, whether or not records sit there, so
     * an empty unit somebody added a minute ago is protected the same way. A structure
     * delete that carries records also shows up above as a removed observation or visit,
     * and is refused there too — either message is true; this one names the action.
     */
    if (change.collection === 'floors' || change.collection === 'units' || change.collection === 'buildings') {
      requireValue(change.kind !== 'removed', 403, '員工不能刪除樓層、單位或劏房，即使是自己新增的也一樣。如需刪除，請聯絡管理員。');
    }
    /*
     * A visit or follow-up event is only removed when a record they belong to is removed
     * (a structure delete). Members may add them through their own entries, but removing
     * one would take a record with it.
     */
    if (change.collection === 'visits' || change.collection === 'followUpEvents') {
      requireValue(change.kind === 'added', 403, '員工不能移除到訪或跟進記錄；如需刪除帶記錄的結構，請聯絡管理員。');
    }
  }
}
