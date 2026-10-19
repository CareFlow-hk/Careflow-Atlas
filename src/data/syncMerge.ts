import { validateSnapshot } from '../domain/schema';
import type { OutreachSnapshot } from '../domain/types';
import { sameValue } from './snapshotValue';

/**
 * Merge the account端's workspace with this browser's copy, record by record.
 *
 * This is not the Excel merge: an Excel file is a snapshot of an unknown age, while here the
 * three inputs are known — the version this tab last agreed with the account端 (`base`), the
 * copy this browser has edited (`local`), and what the account端 holds now (`remote`). With
 * that ancestor each record's fate is decidable:
 *
 * - changed on one side only → take that side;
 * - added on one side → keep it;
 * - deleted on one side, untouched on the other → the deletion stands;
 * - changed on both sides, differently → **not decided here**. It is reported so the person
 *   can choose; guessing would be the silent overwrite this merge exists to prevent.
 *
 * Matching is by record id, never by content: two records that happen to look alike are two
 * records (CLAUDE.md §3.2). Without a `base` (a browser that predates this baseline) only
 * additions can be recognised, so the merge keeps both sides' rows and never deletes.
 */
type Row = { id: string } & Record<string, unknown>;

export const SYNC_COLLECTIONS = ['buildings', 'floors', 'units', 'people', 'households', 'householdMemberships', 'householdResidences', 'memberships', 'visits', 'observations', 'followUpEvents'] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

const COLLECTION_NAMES: Record<SyncCollection, string> = {
  buildings: '大廈', floors: '樓層', units: '單位', people: '個人', households: '住戶',
  householdMemberships: '住戶成員', householdResidences: '居住關係', memberships: '會員關係',
  visits: '到訪', observations: '記錄', followUpEvents: '跟進事件',
};

/** Which copy the person keeps for one conflicted record. */
export type SyncChoice = 'local' | 'remote';

export interface SyncConflict {
  /** `collection/id`: what the person's choice is recorded under. */
  key: string;
  collection: SyncCollection;
  /** What the person sees in the dialog. */
  label: string;
  /** One side no longer has the record; choosing that side means the record goes away. */
  localDeleted: boolean;
  remoteDeleted: boolean;
}

export interface SyncMergeResult {
  /** Absent when even keeping both sides could not produce a valid snapshot. */
  snapshot?: OutreachSnapshot;
  /** Records the merge will not decide. Empty when the merge was complete. */
  conflicts: SyncConflict[];
  /** True when a deletion broke a reference, so both sides' rows were kept instead. */
  keptBoth?: boolean;
  /** Why no snapshot could be produced; only set when `snapshot` is absent. */
  invalid?: string;
}

const rowsOf = (snapshot: OutreachSnapshot, collection: SyncCollection): Row[] =>
  ((snapshot as unknown as Record<string, Row[] | undefined>)[collection] ?? []);

function labelOf(collection: SyncCollection, row: Row | undefined): string {
  const name = COLLECTION_NAMES[collection];
  if (!row) return name;
  const text = collection === 'buildings' ? row.name
    : collection === 'people' ? row.displayName
      : collection === 'floors' || collection === 'units' || collection === 'households' ? row.label
        : collection === 'observations' ? (row.paperRef || row.occurredAt)
          : undefined;
  const detail = typeof text === 'string' && text.trim() ? text.trim() : row.id;
  return `${name}「${detail}」`;
}

function makeConflict(collection: SyncCollection, id: string, remoteRow: Row | undefined, localRow: Row | undefined): SyncConflict {
  return {
    key: `${collection}/${id}`,
    collection,
    label: labelOf(collection, remoteRow ?? localRow),
    localDeleted: !localRow,
    remoteDeleted: !remoteRow,
  };
}

function build(remote: OutreachSnapshot, local: OutreachSnapshot, base: OutreachSnapshot | undefined, choices?: Readonly<Record<string, SyncChoice>>) {
  const conflicts: SyncConflict[] = [];
  const next = structuredClone(remote) as unknown as Record<string, Row[]>;
  const pick = (conflict: SyncConflict): SyncChoice => choices?.[conflict.key] ?? 'remote';
  // A record the person has already answered for is decided, so it is not asked about again.
  const ask = (conflict: SyncConflict): SyncChoice => {
    if (!choices?.[conflict.key]) conflicts.push(conflict);
    return pick(conflict);
  };
  for (const collection of SYNC_COLLECTIONS) {
    const remoteRows = rowsOf(remote, collection);
    const localRows = rowsOf(local, collection);
    if (!remoteRows.length && !localRows.length) continue;
    const baseRows = base ? rowsOf(base, collection) : [];
    const baseIndex = new Map(baseRows.map(row => [row.id, row]));
    const localIndex = new Map(localRows.map(row => [row.id, row]));
    const remoteIndex = new Map(remoteRows.map(row => [row.id, row]));
    const rows: Row[] = [];
    // The account端's order comes first: it is the order other devices already see.
    for (const remoteRow of remoteRows) {
      const localRow = localIndex.get(remoteRow.id);
      const baseRow = baseIndex.get(remoteRow.id);
      if (localRow) {
        if (sameValue(remoteRow, localRow)) { rows.push(remoteRow); continue; }
        if (baseRow) {
          // Only one side moved away from what both agreed on last time.
          if (sameValue(localRow, baseRow)) { rows.push(remoteRow); continue; }
          if (sameValue(remoteRow, baseRow)) { rows.push(localRow); continue; }
        }
        const conflict = makeConflict(collection, remoteRow.id, remoteRow, localRow);
        rows.push(ask(conflict) === 'local' ? localRow : remoteRow);
        continue;
      }
      if (!baseRow) { rows.push(remoteRow); continue; } // added on another device
      if (sameValue(remoteRow, baseRow)) continue; // deleted here, untouched there: the deletion stands
      // Deleted here, edited there. Not ours to decide.
      const conflict = makeConflict(collection, remoteRow.id, remoteRow, undefined);
      if (ask(conflict) === 'remote') rows.push(remoteRow);
    }
    for (const localRow of localRows) {
      if (remoteIndex.has(localRow.id)) continue;
      const baseRow = baseIndex.get(localRow.id);
      if (!baseRow) { rows.push(localRow); continue; } // added on this device
      if (sameValue(localRow, baseRow)) continue; // deleted there, untouched here: the deletion stands
      // Edited here, deleted there. Not ours to decide.
      const conflict = makeConflict(collection, localRow.id, undefined, localRow);
      if (ask(conflict) === 'local') rows.push(localRow);
    }
    next[collection] = rows;
  }
  return { snapshot: validateSnapshot(next), conflicts };
}

export function mergeSync(remote: OutreachSnapshot, local: OutreachSnapshot, base?: OutreachSnapshot, choices?: Readonly<Record<string, SyncChoice>>): SyncMergeResult {
  try {
    return build(remote, local, base, choices);
  } catch (error) {
    /*
     * Honouring a deletion can leave a record pointing at the floor, unit or building it
     * named (a record added here for a floor deleted elsewhere). Dropping either side would
     * be the silent loss this merge exists to prevent, so keep both sides' rows — the same
     * merge with no ancestor — and say that a deletion was reversed.
     */
    if (!base) return { conflicts: [], invalid: message(error) };
    try { return { ...build(remote, local, undefined, choices), keptBoth: true }; }
    catch (fallback) { return { conflicts: [], invalid: message(fallback) }; }
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
