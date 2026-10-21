import { requireValue } from './auth.mjs';

/**
 * Institutions, managed from the server's command line (server/manage.mjs) by whoever runs
 * the site. There is deliberately no API for creating one or moving an account between
 * them: an institution's data is locked with its own passphrase, and who belongs to it
 * decides who can read it once unlocked.
 *
 * Moving an account starts it on an empty workspace in the new institution; it does not
 * carry records across. The workspace, its key and every device's local copy stay with the
 * institution they belong to, which is why a partner's institution is renamed in place and
 * never re-created under a new id.
 */
const ORG_ID = /^org-[a-z0-9][a-z0-9-]{1,39}$/;

function nameValue(value) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80, 400, '機構名稱要有 1–80 個字。');
  return value.trim();
}

export function listOrgs(auth) {
  return auth.all(`SELECT o.id, o.name, o.created_at,
      SUM(CASE WHEN u.role='ADMIN' AND u.disabled=0 AND u.password_hash IS NOT NULL THEN 1 ELSE 0 END) AS admins,
      SUM(CASE WHEN u.role='MEMBER' AND u.disabled=0 THEN 1 ELSE 0 END) AS members,
      SUM(CASE WHEN u.id IS NOT NULL THEN 1 ELSE 0 END) AS accounts
    FROM organizations o LEFT JOIN users u ON u.org_id=o.id GROUP BY o.id ORDER BY o.created_at, o.id`)
    .map(row => ({ id: row.id, name: row.name, createdAt: row.created_at, admins: row.admins ?? 0, members: row.members ?? 0, accounts: row.accounts ?? 0 }));
}

export function createOrg(auth, id, name) {
  requireValue(typeof id === 'string' && ORG_ID.test(id), 400, '機構編號要以 org- 開頭，只用小寫英文、數字和「-」，例如 org-careflow。');
  const label = nameValue(name);
  return auth.transaction(() => {
    requireValue(!auth.get('SELECT 1 FROM organizations WHERE id=?', id), 409, '這個機構編號已經存在。');
    auth.run('INSERT INTO organizations(id,name,created_at) VALUES(?,?,?)', id, label, Date.now());
    auth.audit(null, 'org_created', id);
    return listOrgs(auth).find(org => org.id === id);
  });
}

export function renameOrg(auth, id, name) {
  const label = nameValue(name);
  return auth.transaction(() => {
    requireValue(auth.get('SELECT 1 FROM organizations WHERE id=?', id), 404, '沒有這個機構。');
    auth.run('UPDATE organizations SET name=? WHERE id=?', label, id);
    auth.audit(null, 'org_renamed', id);
    return listOrgs(auth).find(org => org.id === id);
  });
}

/**
 * Move one account to another institution. Its sessions and any open password link go, so it
 * signs in again into the new institution. Refused when it would leave the old institution
 * with no active administrator: nobody there could then manage accounts or the passphrase.
 */
export function moveUser(auth, email, orgId) {
  return auth.transaction(() => {
    const user = auth.get('SELECT * FROM users WHERE email=?', typeof email === 'string' ? email.trim().toLowerCase() : '');
    requireValue(user, 404, '帳號不存在。');
    requireValue(auth.get('SELECT 1 FROM organizations WHERE id=?', orgId), 404, '沒有這個機構。');
    requireValue(user.org_id !== orgId, 409, '帳號已經在這個機構。');
    if (user.role === 'ADMIN' && !user.disabled && user.password_hash) {
      const left = auth.get("SELECT COUNT(*) AS n FROM users WHERE org_id=? AND role='ADMIN' AND disabled=0 AND password_hash IS NOT NULL AND id<>?", user.org_id, user.id).n;
      requireValue(left > 0, 409, '移走之後，原機構就沒有任何已啟用的機構管理員。請先為原機構開設或啟用另一位機構管理員。');
    }
    auth.run('UPDATE users SET org_id=?, version=version+1 WHERE id=?', orgId, user.id);
    auth.run('DELETE FROM sessions WHERE user_id=?', user.id);
    auth.run('DELETE FROM grants WHERE user_id=?', user.id);
    auth.audit(null, 'user_moved', user.id);
    return { email: user.email, from: user.org_id, to: orgId };
  });
}
