import { useState, type FormEvent } from 'react';
import { keysFor, readRecoveryCode, rememberKeys, unlockMaster, type LockedKey } from '../data/orgKey';
import type { WorkspaceKeys } from '../data/workspaceCipher';

/**
 * Asks for the institution passphrase once per device. Until it is given the workspace
 * stays on this device, which is said plainly, so nobody believes a colleague can already
 * see what they type. "Later" is allowed: the field work does not wait for sync.
 */
export function WorkspaceUnlock({ orgId, locked, onUnlocked }: { orgId: string; locked: LockedKey; onUnlocked: (keys: WorkspaceKeys) => void }) {
  const [useCode, setUseCode] = useState(false);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (later) return <div className="workspace-unlock is-later" role="status">
    <span>未解鎖：改動只留在這部裝置，不會同步給同事。</span>
    <button type="button" onClick={() => setLater(false)}>輸入機構密語</button>
  </div>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secret = String(new FormData(event.currentTarget).get('secret') ?? '');
    setBusy(true); setError('');
    try {
      const master = useCode ? readRecoveryCode(secret) : await unlockMaster(locked, secret);
      const keys = await keysFor(master, locked);
      await rememberKeys(orgId, keys);
      onUnlocked(keys);
    } catch (e) { setError(e instanceof Error ? e.message : '未能解鎖。'); }
    finally { setBusy(false); }
  }
  return <form className="workspace-unlock" onSubmit={submit} aria-label="解鎖跨裝置同步">
    <p><strong>輸入機構密語，和同事同步</strong>住戶資料會加密後才存到伺服器。這部裝置解鎖一次就會記住，登出後要重新輸入。密語請向機構負責人查詢。</p>
    <div className="workspace-unlock__row">
      <input name="secret" type={useCode ? 'text' : 'password'} autoComplete={useCode ? 'off' : 'current-password'} aria-label={useCode ? '恢復碼' : '機構密語'} placeholder={useCode ? '恢復碼（13 組，每組 4 個字元）' : '機構密語'} required />
      <button className="is-primary" disabled={busy}>{busy ? '正在解鎖…' : '解鎖'}</button>
      <button type="button" onClick={() => setLater(true)}>稍後</button>
    </div>
    {error && <p role="alert" className="workspace-unlock__error">{error}</p>}
    <button type="button" className="workspace-unlock__link" onClick={() => { setUseCode(!useCode); setError(''); }}>{useCode ? '改用機構密語' : '用恢復碼解鎖'}</button>
  </form>;
}
