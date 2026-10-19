import { api } from '../auth/api';
import { validateSnapshot } from '../domain/schema';
import type { OutreachSnapshot } from '../domain/types';
import type { WorkspaceCipher } from './workspaceCipher';

export interface WorkspaceRecord { snapshot: OutreachSnapshot; version: number }

/**
 * The account's workspace, read and written over HTTP.
 *
 * Intentionally a Promise interface, separate from the synchronous PersistenceAdapter:
 * the production path must not pretend a network round-trip is a synchronous Storage
 * write (BACKEND_GAP_ANALYSIS.md §10.1). The server scopes every call to the session's
 * account, so this class never names an account id itself.
 *
 * This is also the one place a workspace crosses to the server, so it is where names, phones
 * and notes are encrypted on the way out and decrypted on the way in (workspaceCipher.ts).
 * Everything above this class only ever sees the plain workspace.
 */
export class RemoteWorkspaceRepository {
  constructor(private readonly cipher: WorkspaceCipher) {}
  async load(): Promise<WorkspaceRecord | undefined> {
    const value = await api<{ snapshot?: unknown; version?: number }>('/workspace');
    if (!value.snapshot) return undefined;
    // Parse at the boundary, after decrypting: anything stored by an older or broken writer
    // is refused here, not carried into the editor as if it were valid.
    return { snapshot: validateSnapshot(await this.cipher.open(value.snapshot)), version: value.version ?? 1 };
  }
  /** Returns the new version. A stale baseVersion is a 409 the caller must not ignore. */
  async save(snapshot: OutreachSnapshot, baseVersion?: number): Promise<number> {
    return (await api<{ version: number }>('/workspace', 'PUT', { snapshot: await this.cipher.seal(snapshot), baseVersion })).version;
  }
  /**
   * Empty the institution's copy. The server keeps an empty version rather than removing the
   * row, so other browsers cannot mistake their stale copy for the first write. Returns that
   * version, which the caller must use as the base of its next write.
   */
  async clear(): Promise<number | undefined> {
    return (await api<{ version?: number }>('/workspace', 'DELETE')).version;
  }
}
