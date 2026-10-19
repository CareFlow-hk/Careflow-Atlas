import type { OutreachSnapshot } from '../domain/types';

/**
 * Field-level encryption of the institution's workspace, done in the browser.
 *
 * Only the fields that name or describe a person are encrypted. Ids, structure, dates,
 * choices, `createdBy` and `deleted` stay readable, because the server checks every write
 * against the role of the person making it (server/workspaceAccess.mjs) and cannot do that
 * through ciphertext. See docs/ENCRYPTION.md.
 *
 * Server copy: server/workspaceSealed.mjs SENSITIVE_FIELDS, which refuses any of these in
 * the clear. The server cannot be bundled, so a test keeps the two lists equal.
 */
export const SENSITIVE_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  people: ['displayName', 'phone', 'addressNote', 'contactNote'],
  households: ['label'],
  householdMemberships: ['relationship'],
  householdResidences: ['locationNote'],
  visits: ['note'],
  observations: ['note', 'evidence[]', 'optionNotes.*', 'followUp.action', 'followUp.assignee', 'followUp.timingNote', 'correctionReason', 'paperLine', 'photoSource.line'],
  followUpEvents: ['reason'],
});
export const SEALED_PREFIX = 'enc:v1:';

/** Encrypts a workspace on its way to the server and decrypts it on its way back. */
export interface WorkspaceCipher {
  /** Fingerprint of the key in use; the server's copy names the one it was locked with. */
  readonly keyId: string;
  seal(snapshot: OutreachSnapshot): Promise<unknown>;
  open(value: unknown): Promise<unknown>;
}

/** The workspace could not be opened with this key: a wrong key, or the data was altered. */
export class WorkspaceKeyError extends Error {
  constructor(message = '帳號端的資料無法用目前的機構密語解開。') { super(message); this.name = 'WorkspaceKeyError'; }
}

const encoder = new TextEncoder(), decoder = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** The two keys the workspace is encrypted with, both derived from the institution's data key. */
export interface WorkspaceKeys { keyId: string; enc: CryptoKey; mac: CryptoKey }

/**
 * Derive the working keys from the 32-byte data key. Neither can be exported again: once
 * unlocked on a device, the keys can be used there but not copied out of the browser.
 */
export async function deriveKeys(master: Uint8Array<ArrayBuffer>): Promise<WorkspaceKeys> {
  const base = await subtle().importKey('raw', master, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const params = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(`careflow-atlas ${info}`) });
  const enc = await subtle().deriveKey(params('workspace encryption v1'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const mac = await subtle().deriveKey(params('workspace nonce v1'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  const id = new Uint8Array(await subtle().deriveBits(params('workspace key id v1'), base, 128));
  return { keyId: [...id].map(byte => byte.toString(16).padStart(2, '0')).join(''), enc, mac };
}

/** Every string a path reaches in one record, with its own name. Same rules as the server's `valuesAt`. */
function locations(row: Row, path: string): { name: string; get: () => unknown; set: (value: unknown) => void }[] {
  const dot = path.indexOf('.');
  const head = dot < 0 ? path : path.slice(0, dot), rest = dot < 0 ? undefined : path.slice(dot + 1);
  if (head.endsWith('[]')) {
    const list = row[head.slice(0, -2)];
    return Array.isArray(list) ? list.map((_, index) => ({ name: `${head.slice(0, -2)}.${index}`, get: () => list[index], set: value => { list[index] = value; } })) : [];
  }
  if (rest === undefined) return head in row ? [{ name: head, get: () => row[head], set: value => { row[head] = value; } }] : [];
  const inner = row[head];
  if (!isRow(inner)) return [];
  const keys = rest === '*' ? Object.keys(inner) : rest in inner ? [rest] : [];
  return keys.map(key => ({ name: `${head}.${key}`, get: () => inner[key], set: value => { inner[key] = value; } }));
}

async function eachSensitive(value: unknown, change: (text: string, where: string) => Promise<string>): Promise<unknown> {
  const copy = structuredClone(value);
  if (!isRow(copy)) return copy;
  const work: Promise<void>[] = [];
  for (const [collection, paths] of Object.entries(SENSITIVE_FIELDS)) {
    const rows = copy[collection];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!isRow(row)) continue;
      for (const path of paths) {
        for (const spot of locations(row, path)) {
          const text = spot.get();
          // Blank carries nothing; the server lets it through and so do we.
          if (typeof text !== 'string' || text === '') continue;
          work.push(change(text, `${collection}\u0000${String(row.id)}\u0000${spot.name}`).then(spot.set));
        }
      }
    }
  }
  await Promise.all(work);
  return copy;
}

/**
 * The nonce is derived from the value and where it sits, not drawn at random: an unchanged
 * value encrypts to the same ciphertext every time, so the server's record-by-record
 * comparison still sees "unchanged" and a member's unrelated write is not mistaken for a
 * rewrite of someone else's record. The cost is that the server can tell whether one field
 * of one record changed between versions — which it can already tell from the version.
 *
 * The location is also bound in as associated data, so ciphertext moved to another record
 * or another field does not open there.
 */
export function createCipher(keys: WorkspaceKeys): WorkspaceCipher {
  const seal = async (text: string, where: string) => {
    if (text.startsWith(SEALED_PREFIX)) return text;
    const place = encoder.encode(where);
    const nonce = new Uint8Array(await subtle().sign('HMAC', keys.mac, encoder.encode(`${where}\u0000${text}`))).slice(0, 12);
    const body = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce, additionalData: place }, keys.enc, encoder.encode(text)));
    const out = new Uint8Array(nonce.length + body.length);
    out.set(nonce); out.set(body, nonce.length);
    return SEALED_PREFIX + toBase64(out);
  };
  const open = async (text: string, where: string) => {
    // Written before this workspace was encrypted: shown as it is, sealed on the next save.
    if (!text.startsWith(SEALED_PREFIX)) return text;
    try {
      const bytes = fromBase64(text.slice(SEALED_PREFIX.length));
      const plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(where) }, keys.enc, bytes.slice(12));
      return decoder.decode(plain);
    } catch { throw new WorkspaceKeyError(); }
  };
  return {
    keyId: keys.keyId,
    seal: snapshot => eachSensitive(snapshot, seal),
    open: value => eachSensitive(value, open),
  };
}
