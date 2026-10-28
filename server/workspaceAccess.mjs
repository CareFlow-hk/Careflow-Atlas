import { requireValue } from './auth.mjs';
import { assertAiAssist } from './aiAssist.mjs';

/**
 * Who may change what inside the institution's shared snapshot.
 *
 * The workspace is written as a whole document, so the check compares the stored copy with
 * the incoming one record by record. A member may change, never take away (「C 方案」,
 * 2026-10-19 review):
 *
 * - correcting a phone number, a building name or a household is open to both roles;
 * - removing anything — a person, a household, a floor, a unit, a 劏房 room, a record — is
 *   for an administrator only, even an empty unit the member added a minute ago;
 * - records (observations) are append-only for a member: add, or withdraw (soft-delete)
 *   one they created themselves and nobody has changed since. Visits and follow-up events
 *   are only ever added.
 *
 * Both roles must sign their own work: a record added names the account saving it, a
 * follow-up event names the account that pressed the button, and a withdrawal names the
 * account withdrawing. Otherwise anyone could put a colleague's name on what they typed.
 *
 * A structure delete reaches the server as removed floors/units plus the records that went
 * with them; both are refused here, so neither route can be used to get around the other.
 *
 * The comparison is canonical JSON, not raw text: property order must not decide whether a
 * record changed. Records are matched by id, never by content. Encrypted fields compare the
 * same way: the browser encrypts an unchanged value to the same ciphertext.
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

const actsAs = (operator, user) => !!operator && typeof operator === 'object' && operator.accountId === user.id;

/** A withdrawal marker this account may have written: it names the person acting now. */
function ownMarker(deleted, user) {
  return actsAs(deleted?.by, user) && typeof deleted.at === 'string' && deleted.at.length <= 64;
}

function isOwnWithdrawal(change, user) {
  if (!actsAs(change.previous?.createdBy, user)) return false;
  if (canonical(withoutDeletion(change.previous)) !== canonical(withoutDeletion(change.next))) return false;
  return !change.next.deleted || ownMarker(change.next.deleted, user);
}

const hasRecords = snapshot => WORKSPACE_COLLECTIONS.some(collection => rowsOf(snapshot, collection).length > 0);

/**
 * The signatures both roles must get right. Skipped only when an administrator fills an
 * empty workspace — loading the demo, or putting a backup back after a clear — where the
 * rows were signed by whoever made them, not by the person restoring them.
 */
function assertSigned(user, change) {
  const { collection, kind, next, previous } = change;
  if (collection === 'observations') {
    if (kind === 'added') {
      // A member's record must say who saved it, or they could never withdraw it; any
      // name it carries must be theirs.
      if (next.createdBy !== undefined || user.role !== 'ADMIN') {
        requireValue(actsAs(next.createdBy, user), 403, '新增的記錄必須以登入的帳號名義儲存，不能用其他人的名字。');
      }
    } else if (kind === 'changed') {
      // How the row was produced is history: rewriting it later would falsify the trace.
      requireValue(canonical(next.aiAssist) === canonical(previous.aiAssist), 403, 'AI 協助標記寫入後不能修改；如需更正，請新增一筆更正記錄。');
      if (next.deleted && canonical(next.deleted) !== canonical(previous.deleted)) {
        requireValue(ownMarker(next.deleted, user), 403, '撤回記錄必須以登入的帳號名義進行。');
      }
    }
  }
  if (collection === 'followUpEvents' && kind === 'added') {
    requireValue(actsAs(next.operator, user), 403, '跟進操作必須以登入的帳號名義記錄。');
  }
}

/**
 * Refuse a write that steps outside the caller's role. Returns nothing; throws `HttpError`.
 * Only a real change is checked, so a merge that carries another device's rows back
 * unchanged costs nothing.
 */
export function assertWorkspaceWrite(user, previous, next) {
  // Checked on every write, including the first one: a marker that never passed the
  // whitelist would otherwise sit in the store with nothing able to correct it.
  for (const row of rowsOf(next, 'observations')) assertAiAssist(row);
  if (!previous) return;
  const seeding = user.role === 'ADMIN' && !hasRecords(previous);
  for (const change of diffSnapshots(previous, next)) {
    if (!seeding) assertSigned(user, change);
    if (user.role === 'ADMIN') continue;
    if (change.collection === 'floors' || change.collection === 'units' || change.collection === 'buildings') {
      // Named on its own: an empty unit is protected the same way as one with records.
      requireValue(change.kind !== 'removed', 403, '員工不能刪除樓層、單位或劏房，即使是自己新增的也一樣。如需刪除，請聯絡管理員。');
    }
    requireValue(change.kind !== 'removed', 403, '員工不能刪除資料（包括住戶、人員、記錄）；可以修改。如需刪除，請聯絡管理員。');
    if (change.collection === 'observations') {
      if (change.kind === 'added') continue;
      requireValue(isOwnWithdrawal(change, user), 403, '員工只能撤回自己建立、且內容未被改動的記錄。');
      continue;
    }
    if (change.collection === 'visits' || change.collection === 'followUpEvents') {
      requireValue(change.kind === 'added', 403, '到訪和跟進記錄只可新增，不能修改；如需更正，請新增一筆更正記錄。');
    }
  }
}
