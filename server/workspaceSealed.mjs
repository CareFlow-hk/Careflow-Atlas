import { requireValue } from './auth.mjs';

/**
 * The fields of the institution's workspace that name or describe a person, and so are only
 * ever stored encrypted. Everything else — ids, buildings, floors, units, dates, choices,
 * who saved a record and who withdrew it — stays readable, because the server checks each
 * write against the role of the person making it (workspaceAccess.mjs) and cannot do that
 * through ciphertext.
 *
 * Browser copy: src/data/workspaceCipher.ts SENSITIVE_FIELDS. The server cannot be
 * bundled, so the two lists are kept equal by a test (workspaceCipher.test.ts).
 *
 * A path is a property (`note`), a nested property (`followUp.action`), every item of an
 * array (`evidence[]`) or every value of an object (`optionNotes.*`).
 */
export const SENSITIVE_FIELDS = Object.freeze({
  people: ['displayName', 'phone', 'addressNote', 'contactNote'],
  households: ['label'],
  householdMemberships: ['relationship'],
  householdResidences: ['locationNote'],
  visits: ['note'],
  observations: ['note', 'evidence[]', 'optionNotes.*', 'followUp.action', 'followUp.assignee', 'followUp.timingNote', 'correctionReason', 'paperLine', 'photoSource.line'],
  followUpEvents: ['reason'],
});
export const SEALED_PREFIX = 'enc:v1:';

/** Every string a path reaches in one record, with where it was found. */
export function valuesAt(row, path) {
  const [head, rest] = path.split('.', 2);
  if (head.endsWith('[]')) {
    const list = row?.[head.slice(0, -2)];
    return Array.isArray(list) ? list.map((value, index) => [`${head.slice(0, -2)}.${index}`, value]) : [];
  }
  if (rest === undefined) return row && head in row ? [[head, row[head]]] : [];
  const inner = row?.[head];
  if (!inner || typeof inner !== 'object') return [];
  if (rest === '*') return Object.entries(inner).map(([key, value]) => [`${head}.${key}`, value]);
  return rest in inner ? [[path, inner[rest]]] : [];
}

/**
 * Refuse a workspace that carries a sensitive field in the clear. An empty or absent value
 * carries nothing and is let through; anything else must be ciphertext. This is the line
 * that keeps a browser that forgot to encrypt — or a request made by hand — from parking a
 * name or a phone number on the VPS in plain text.
 */
export function assertSealed(snapshot) {
  for (const [collection, paths] of Object.entries(SENSITIVE_FIELDS)) {
    const rows = Array.isArray(snapshot?.[collection]) ? snapshot[collection] : [];
    for (const row of rows) {
      for (const path of paths) {
        for (const [, value] of valuesAt(row, path)) {
          if (value === undefined || value === null || value === '') continue;
          requireValue(typeof value === 'string' && value.startsWith(SEALED_PREFIX), 400,
            `工作區有未加密的敏感資料（${collection}.${path}），伺服器不會儲存。請重新整理後再試。`);
        }
      }
    }
  }
}
