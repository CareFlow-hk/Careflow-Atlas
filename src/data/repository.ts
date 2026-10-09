import type { OutreachSnapshot, SaveObservationInput } from '../domain/types';
import { observationSchema, validateSnapshot } from '../domain/schema';
import { alignDemoSnapshot } from './demoGeometry';

export class PersistenceError extends Error {
  constructor(message: string, public readonly cause?: unknown) { super(message); this.name = 'PersistenceError'; }
}
export interface PersistenceAdapter { read(key: string): string | null; write(key: string, value: string): void; remove?(key: string): void; }
export class LocalStoragePersistenceAdapter implements PersistenceAdapter {
  constructor(private readonly storage?: Storage) {}
  read(key: string): string | null {
    try { return (this.storage ?? globalThis.localStorage).getItem(key); }
    catch (error) { throw new PersistenceError('未能讀取本機資料，原有記錄仍保留。', error); }
  }
  write(key: string, value: string): void {
    try { (this.storage ?? globalThis.localStorage).setItem(key, value); }
    catch (error) { throw new PersistenceError('本機儲存失敗。草稿仍保留，請確認瀏覽器儲存空間後重試。', error); }
  }
  remove(key: string): void {
    try { (this.storage ?? globalThis.localStorage).removeItem(key); }
    catch (error) { throw new PersistenceError('未能清空本機資料，原有記錄仍保留。', error); }
  }
}

/** Save once, then publish to application state. Failures never look successful. */
export class OutreachRepository {
  constructor(private readonly adapter: PersistenceAdapter, private readonly key = 'careflow-field-outreach.snapshot') {}
  getSnapshot(): OutreachSnapshot | undefined {
    const raw = this.adapter.read(this.key);
    if (!raw) return undefined;
    try { return alignDemoSnapshot(validateSnapshot(JSON.parse(raw))); }
    catch (error) { throw new PersistenceError('本機資料格式不完整，尚未取代或刪除。', error); }
  }
  replaceSnapshot(snapshot: OutreachSnapshot): OutreachSnapshot { return this.persist(snapshot); }
  /** Delete this workspace from this browser. Only an explicit person action calls this. */
  clear(): void {
    if (!this.adapter.remove) throw new PersistenceError('此儲存方式不支援清空。');
    this.adapter.remove(this.key);
  }
  saveObservation(input: SaveObservationInput): OutreachSnapshot {
    const snapshot = this.getSnapshot();
    if (!snapshot) throw new PersistenceError('請先匯入合成資料再記錄到訪。');
    const result = observationSchema.safeParse({ ...input, isSynthetic: true, provisional: true });
    if (!result.success) throw new PersistenceError('記錄格式不完整，請檢查結果、時間及跟進內容。', result.error);
    const observation = result.data;
    const existing = snapshot.observations.find(item => item.id === observation.id);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(observation)) return snapshot;
      throw new PersistenceError('這個記錄編號已被其他內容使用，請重新開啟表格。');
    }
    const visits = snapshot.visits.some(v => v.id === input.visitId) ? snapshot.visits : [...snapshot.visits, {
      id: input.visitId, occurredAt: input.occurredAt, recordedAt: input.recordedAt, workerName: input.workerName,
      isSynthetic: true as const, provisional: true as const,
    }];
    return this.persist({ ...snapshot, visits, observations: [...snapshot.observations, observation] });
  }
  private persist(value: OutreachSnapshot): OutreachSnapshot {
    let snapshot: OutreachSnapshot;
    try { snapshot = alignDemoSnapshot(validateSnapshot(value)); }
    catch (error) { throw new PersistenceError('資料關聯或格式不正確，原有資料未改動。', error); }
    try { this.adapter.write(this.key, JSON.stringify(snapshot)); }
    catch (error) { if (error instanceof PersistenceError) throw error; throw new PersistenceError('本機儲存失敗，原有資料未改動。', error); }
    return snapshot;
  }
}
