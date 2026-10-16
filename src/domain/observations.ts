/**
 * Appending observations — one at a time, or as the batch a multi-unit selection writes.
 *
 * A batch is all of it or none of it. Every entry is checked against the schema and against
 * the ids already in the snapshot before any of them is added, so a batch the snapshot would
 * refuse is not written in part and then reported as a success. The caller persists what
 * comes back, once.
 */
import { observationSchema } from './schema';
import type { OutreachSnapshot, SaveObservationInput } from './types';

/** `cause` carries the schema failure for the console; it is never spoken to staff. */
export type AppendResult = { snapshot: OutreachSnapshot } | { error: string; cause?: unknown };

function appendOne(snapshot: OutreachSnapshot, input: SaveObservationInput): AppendResult {
  const result = observationSchema.safeParse({ ...input, isSynthetic: true, provisional: true });
  if (!result.success) return { error: '記錄格式不完整，請檢查結果、時間及跟進內容。', cause: result.error };
  const observation = result.data;
  const existing = snapshot.observations.find(item => item.id === observation.id);
  if (existing) {
    // Sending the same entry again is not a mistake: a save retried after a slow write must
    // not record the same visit twice, so it lands on the snapshot that is already there.
    return JSON.stringify(existing) === JSON.stringify(observation)
      ? { snapshot }
      : { error: '這個記錄編號已被其他內容使用，請重新開啟表格。' };
  }
  // The visit is appended with the first entry that names it; a batch shares one visit.
  const visits = snapshot.visits.some(v => v.id === input.visitId) ? snapshot.visits : [...snapshot.visits, {
    id: input.visitId, occurredAt: input.occurredAt, recordedAt: input.recordedAt, workerName: input.workerName,
    isSynthetic: true as const, provisional: true as const,
  }];
  return { snapshot: { ...snapshot, visits, observations: [...snapshot.observations, observation] } };
}

export function appendObservations(snapshot: OutreachSnapshot, inputs: readonly SaveObservationInput[]): AppendResult {
  let next = snapshot;
  /*
   * A repeated id inside one batch would otherwise pass: the second entry would look like
   * the same record sent twice and quietly collapse into the first, and the caller would
   * report one more unit recorded than there are records. So it is refused by name.
   */
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.id)) return { error: '同一批記錄中有重複的記錄編號，請重新開啟表格。' };
    seen.add(input.id);
    const added = appendOne(next, input);
    if ('error' in added) return added;
    next = added.snapshot;
  }
  return { snapshot: next };
}
