/**
 * Compare two stored values regardless of key order and absent optional fields.
 *
 * Two snapshots that mean the same thing must compare equal wherever the sync decides
 * whether a record changed. Written once, shared by the Excel merge and the account端 merge,
 * so the two paths cannot disagree about what "the same record" means.
 */
const normalize = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(normalize)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]))
      : value;

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
