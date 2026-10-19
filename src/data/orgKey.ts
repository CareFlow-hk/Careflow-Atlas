import { deriveKeys, fromBase64, toBase64, type WorkspaceKeys } from './workspaceCipher';

/**
 * The institution's data key and how it is locked, unlocked and remembered on a device.
 *
 * A random 32-byte data key encrypts the workspace. The server keeps it only locked with a
 * key derived from the institution's passphrase (PBKDF2-SHA-256), so a copy of the server
 * opens nothing. The data key itself is also shown once, as a recovery code, for the day the
 * passphrase is forgotten; there is no other way back. See docs/ENCRYPTION.md.
 */
export interface LockedKey { keyId: string; salt: string; iterations: number; wrapped: string }
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 12;
const LOCK_LABEL = new TextEncoder().encode('careflow-atlas org key v1');

export class PassphraseError extends Error {
  constructor(message = '機構密語不正確。') { super(message); this.name = 'PassphraseError'; }
}

async function lockKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Lock a data key with a passphrase. A fresh salt every time, so an old locked copy says nothing about a new one. */
export async function lock(master: Uint8Array<ArrayBuffer>, passphrase: string, keyId: string, iterations = PBKDF2_ITERATIONS): Promise<LockedKey> {
  if (passphrase.trim().length < MIN_PASSPHRASE) throw new PassphraseError(`機構密語最少 ${MIN_PASSPHRASE} 個字元，可以用一句話。`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: LOCK_LABEL }, await lockKey(passphrase, salt, iterations), master));
  const wrapped = new Uint8Array(iv.length + body.length);
  wrapped.set(iv); wrapped.set(body, iv.length);
  return { keyId, salt: toBase64(salt), iterations, wrapped: toBase64(wrapped) };
}

/** A new institution key: the data key, its locked copy for the server, and the keys to use now. */
export async function createOrgKey(passphrase: string): Promise<{ master: Uint8Array<ArrayBuffer>; locked: LockedKey; keys: WorkspaceKeys }> {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const keys = await deriveKeys(master);
  return { master, locked: await lock(master, passphrase, keys.keyId), keys };
}

/** The data key behind a locked copy. A wrong passphrase fails the AES-GCM check, so it is never mistaken for a key. */
export async function unlockMaster(locked: LockedKey, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = fromBase64(locked.wrapped);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: LOCK_LABEL }, await lockKey(passphrase, fromBase64(locked.salt), locked.iterations), bytes.slice(12));
    return new Uint8Array(plain);
  } catch { throw new PassphraseError(); }
}

/** Check that a data key is the institution's, by its fingerprint, before anything is encrypted with it. */
export async function keysFor(master: Uint8Array<ArrayBuffer>, locked: LockedKey): Promise<WorkspaceKeys> {
  const keys = await deriveKeys(master);
  if (keys.keyId !== locked.keyId) throw new PassphraseError('恢復碼不是這個機構的。');
  return keys;
}

/*
 * The recovery code is the data key itself, written in Crockford base32 (no I, L, O or U, so
 * nothing reads as another letter) in groups of four. Anyone holding it can read the
 * workspace: it is printed once and kept with the institution, never stored by the app.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function recoveryCode(master: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const byte of master) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}
export function readRecoveryCode(code: string): Uint8Array<ArrayBuffer> {
  const text = code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (text.length !== 52 || [...text].some(c => !ALPHABET.includes(c))) throw new PassphraseError('恢復碼格式不正確，應有 52 個字元（13 組，每組 4 個）。');
  const out = new Uint8Array(32);
  let bits = 0, value = 0, index = 0;
  for (const c of text) {
    value = ((value << 5) | ALPHABET.indexOf(c)) & 0xffff; bits += 5;
    if (bits >= 8 && index < 32) { out[index++] = (value >>> (bits - 8)) & 255; bits -= 8; }
  }
  return out;
}

/*
 * The unlocked keys are kept on this device so a colleague does not type the passphrase on
 * every visit. IndexedDB stores the CryptoKey objects themselves, which were made
 * non-extractable: script on this page can use them, but nobody can read the key bytes out.
 * Signing out forgets them. Where IndexedDB is missing (private windows on some phones), the
 * keys live only until the page is closed.
 */
const DB = 'careflow-atlas-keys', STORE = 'keys';
const memory = new Map<string, WorkspaceKeys>();
function openDb(): Promise<IDBDatabase | undefined> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(undefined); return; }
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
async function withStore<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    return await new Promise<T | undefined>(resolve => {
      const request = act(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
  } catch { return undefined; } finally { db.close(); }
}
export async function rememberKeys(orgId: string, keys: WorkspaceKeys) {
  memory.set(orgId, keys);
  await withStore('readwrite', store => store.put(keys, orgId));
}
/** The keys this device unlocked for the institution, if they are still its current key. */
export async function recalledKeys(orgId: string, keyId: string): Promise<WorkspaceKeys | undefined> {
  const keys = memory.get(orgId) ?? await withStore<WorkspaceKeys>('readonly', store => store.get(orgId));
  return keys?.keyId === keyId ? keys : undefined;
}
export async function forgetKeys() {
  memory.clear();
  await withStore('readwrite', store => store.clear());
}
