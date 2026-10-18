import { api } from '../auth/api';
import { validateSnapshot } from '../domain/schema';
import type { OutreachSnapshot } from '../domain/types';

export interface WorkspaceRecord { snapshot: OutreachSnapshot; version: number }

/**
 * The account's workspace, read and written over HTTP.
 *
 * Intentionally a Promise interface, separate from the synchronous PersistenceAdapter:
 * the production path must not pretend a network round-trip is a synchronous Storage
 * write (BACKEND_GAP_ANALYSIS.md §10.1). The server scopes every call to the session's
 * account, so this class never names an account id itself.
 */
export class RemoteWorkspaceRepository {
  async load(): Promise<WorkspaceRecord | undefined> {
    const value = await api<{ snapshot?: unknown; version?: number }>('/workspace');
    if (!value.snapshot) return undefined;
    // Parse at the boundary: anything stored by an older or broken writer is refused here,
    // not carried into the editor as if it were valid.
    return { snapshot: validateSnapshot(value.snapshot), version: value.version ?? 1 };
  }
  /** Returns the new version. A stale baseVersion is a 409 the caller must not ignore. */
  async save(snapshot: OutreachSnapshot, baseVersion?: number): Promise<number> {
    return (await api<{ version: number }>('/workspace', 'PUT', { snapshot, baseVersion })).version;
  }
  async clear(): Promise<void> { await api('/workspace', 'DELETE'); }
}
