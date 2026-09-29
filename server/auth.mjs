import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const scrypt = promisify(scryptCallback);
export const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
/** A session ends after this long without a request, or 12 hours after login. */
export const SESSION_IDLE_MS = 6 * 60 * 60_000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60_000;
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const requireValue = (condition, status, message) => { if (!condition) throw new HttpError(status, message); };
export function emailValue(value) {
  requireValue(typeof value === 'string' && value.length <= 254, 400, '請輸入有效電郵。');
  const email = value.trim().toLowerCase();
  requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, '請輸入有效電郵。');
  return email;
}
export function nameValue(value) {
  requireValue(typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80, 400, '姓名須為 1–80 個字元。');
  return value.trim();
}
function passwordValue(value) {
  requireValue(typeof value === 'string' && [...value].length >= 15 && value.length <= 128, 400, '密碼須為 15–128 個字元，可使用長句。');
}
// Asynchronous memory-hard hashing; bounded concurrency limits memory use.
let hashing = 0;
async function derive(password, salt) {
  requireValue(hashing < 4, 503, '服務繁忙，請稍後重試。');
  hashing++;
  try { return await scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }); }
  finally { hashing--; }
}
async function hashPassword(password) {
  passwordValue(password);
  const salt = secret();
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [, salt, expected] = (encoded ?? `scrypt$unassigned-account$${'0'.repeat(128)}`).split('$');
  const actual = await derive(typeof password === 'string' ? password.slice(0, 128) : '', salt);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export const publicUser = user => ({ id: user.id, email: user.email, name: user.name, role: user.role, disabled: !!user.disabled, pending: !user.password_hash, createdAt: user.created_at });

export function openAuth(path, { now = Date.now } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 });
  if (path !== ':memory:') chmodSync(path, 0o600);
  if (db.prepare('PRAGMA user_version').get().user_version > 1) { db.close(); throw new Error('帳號庫版本高於目前程式，拒絕降級打開。'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN','MEMBER')), disabled INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
      csrf TEXT NOT NULL, created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS grants (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, time INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, target TEXT);
    PRAGMA user_version=1;`);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const audit = (actor, action, target = null) => run('INSERT INTO audit(time,actor,action,target) VALUES(?,?,?,?)', now(), actor, action, target);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function clean() {
    run('DELETE FROM sessions WHERE expires_at<=? OR seen_at<=?', now(), now() - SESSION_IDLE_MS);
    run('DELETE FROM grants WHERE expires_at<=?', now());
    run('DELETE FROM rate_limits WHERE expires_at<=?', now());
  }
  function limit(key, max, window = 15 * 60_000) {
    const hashed = digest(key);
    run(`INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`, hashed, now() + window, now(), now());
    requireValue(get('SELECT count FROM rate_limits WHERE key=?', hashed).count <= max, 429, '嘗試過於頻繁，請稍後重試。');
  }
  const userById = id => get('SELECT * FROM users WHERE id=?', id);
  function grant(userId, actor) {
    const token = secret();
    run('DELETE FROM grants WHERE user_id=?', userId);
    run('INSERT INTO grants VALUES(?,?,?)', digest(token), userId, now() + 60 * 60_000);
    audit(actor, 'password_link_created', userId);
    return token;
  }
  function createUser(input, actor = null) {
    const email = emailValue(input.email), name = nameValue(input.name);
    requireValue(['ADMIN', 'MEMBER'].includes(input.role), 400, '無效角色。');
    return transaction(() => {
      requireValue(!get('SELECT id FROM users WHERE email=?', email), 409, '該電郵已存在。');
      const id = randomUUID();
      run('INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,?,?)', id, email, name, input.role, now());
      audit(actor, 'user_created', id);
      return { user: publicUser(userById(id)), token: grant(id, actor) };
    });
  }
  function session(token, touch = true) {
    if (!token || !/^[\w-]{43}$/.test(token)) return undefined;
    const row = get(`SELECT s.*, u.version FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.hash=? AND u.disabled=0 AND s.expires_at>? AND s.seen_at>?`, digest(token), now(), now() - SESSION_IDLE_MS);
    if (row && touch) run('UPDATE sessions SET seen_at=? WHERE hash=?', now(), row.hash);
    return row;
  }
  function assertSession(row, admin = false) {
    const fresh = get(`SELECT s.hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=?
      AND u.disabled=0 AND s.expires_at>? AND s.seen_at>?`, row.hash, now(), now() - SESSION_IDLE_MS);
    requireValue(fresh, 401, '登入已過期，請重新登入。');
    const user = userById(row.user_id);
    requireValue(!admin || user.role === 'ADMIN', 403, '需要管理員權限。');
    return user;
  }
  function newSession(userId) {
    const token = secret(), timestamp = now();
    // At most ten active sessions per account, oldest first.
    const old = all('SELECT hash FROM sessions WHERE user_id=? ORDER BY created_at DESC', userId);
    for (const row of old.slice(9)) run('DELETE FROM sessions WHERE hash=?', row.hash);
    run('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)', digest(token), randomUUID(), userId, secret(), timestamp, timestamp, timestamp + SESSION_ABSOLUTE_MS);
    return { token, row: session(token) };
  }
  async function login(email, password, ip) {
    clean(); limit(`login-ip:${ip}`, 60);
    email = emailValue(email); limit(`login-email:${email}`, 10);
    const user = get('SELECT * FROM users WHERE email=?', email);
    const valid = await verifyPassword(password, user?.password_hash);
    const current = user && userById(user.id);
    if (!valid || !current || current.disabled || !current.password_hash || current.version !== user.version) {
      audit(null, 'login_failed');
      throw new HttpError(401, '電郵或密碼不正確，或帳號不可用。');
    }
    return transaction(() => { audit(user.id, 'login'); return newSession(user.id); });
  }
  async function redeem(token, password, ip) {
    clean(); limit(`redeem:${ip}`, 20);
    requireValue(typeof token === 'string' && /^[\w-]{43}$/.test(token), 400, '連結無效或已過期。');
    const hashed = await hashPassword(password);
    return transaction(() => {
      const row = get('SELECT * FROM grants WHERE hash=? AND expires_at>?', digest(token), now());
      requireValue(row && !userById(row.user_id).disabled, 400, '連結無效或已過期。');
      run('UPDATE users SET password_hash=?,version=version+1 WHERE id=?', hashed, row.user_id);
      run('DELETE FROM grants WHERE user_id=?', row.user_id);
      run('DELETE FROM sessions WHERE user_id=?', row.user_id);
      audit(row.user_id, 'password_set');
    });
  }
  async function changePassword(row, oldPassword, password) {
    const user = assertSession(row);
    limit(`password:${user.id}`, 10);
    requireValue(await verifyPassword(oldPassword, user.password_hash), 400, '目前密碼不正確。');
    const hashed = await hashPassword(password);
    return transaction(() => {
      const current = assertSession(row);
      requireValue(current.version === user.version, 409, '帳號已發生變化，請重新登入。');
      run('UPDATE users SET password_hash=?,version=version+1 WHERE id=?', hashed, user.id);
      run('DELETE FROM sessions WHERE user_id=?', user.id);
      run('DELETE FROM grants WHERE user_id=?', user.id);
      audit(user.id, 'password_changed');
    });
  }
  function updateUser(actor, id, input) {
    return transaction(() => {
      assertSession(actor, true);
      const user = userById(id);
      requireValue(user, 404, '帳號不存在。');
      requireValue(['ADMIN', 'MEMBER'].includes(input.role) && typeof input.disabled === 'boolean', 400, '無效帳號設定。');
      const name = nameValue(input.name);
      if (user.role === 'ADMIN' && !user.disabled && user.password_hash && (input.role !== 'ADMIN' || input.disabled)) {
        requireValue(get("SELECT COUNT(*) AS n FROM users WHERE role='ADMIN' AND disabled=0 AND password_hash IS NOT NULL").n > 1, 409, '不能停用或降級最後一位已啟用管理員。');
      }
      run('UPDATE users SET role=?,disabled=?,name=?,version=version+1 WHERE id=?', input.role, Number(input.disabled), name, id);
      run('DELETE FROM sessions WHERE user_id=?', id);
      if (input.disabled) run('DELETE FROM grants WHERE user_id=?', id);
      audit(actor.user_id, 'user_updated', id);
      return publicUser(userById(id));
    });
  }
  return { db, run, get, all, clean, audit, limit, transaction, createUser, userById, session, assertSession, login, redeem, changePassword, updateUser, grant,
    close: () => db.close() };
}
