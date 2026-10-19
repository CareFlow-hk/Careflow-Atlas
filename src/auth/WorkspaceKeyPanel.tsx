import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { createOrgKey, forgetKeys, keysFor, lock, MIN_PASSPHRASE, readRecoveryCode, recoveryCode, rememberKeys, unlockMaster, type LockedKey } from '../data/orgKey';
import type { WorkspaceKeys } from '../data/workspaceCipher';

/** A key made in this browser and shown once, waiting for the administrator to confirm they copied the code. */
interface Draft { locked: LockedKey; keys: WorkspaceKeys; code: string }
type Stored = LockedKey & { updatedAt: number };

/**
 * The administrator's side of the institution passphrase: set it the first time, change it,
 * or — while the workspace holds nothing — replace the key outright, which is how it is
 * handed over to the institution (docs/ENCRYPTION.md).
 */
export function WorkspaceKeyPanel({ orgId, onChanged }: { orgId: string; /** The key on this device changed; sync is resolved again. */ onChanged: () => void }) {
  const [stored, setStored] = useState<Stored | null>();
  const [draft, setDraft] = useState<Draft>();
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'idle' | 'change' | 'replace'>('idle');
  const [useCode, setUseCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => setStored((await api<{ key: Stored | null }>('/workspace/key')).key), []);
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : '未能讀取機構密鑰。')); }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失敗。'); } finally { setBusy(false); }
  }
  function twice(data: FormData) {
    const passphrase = String(data.get('passphrase') ?? '');
    if (passphrase !== data.get('confirm')) throw new Error('兩次輸入的密語不一致。');
    return passphrase;
  }
  // Nothing is sent yet: the code is shown first, and only a confirmed copy is put in place.
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void run(async () => {
      const { master, locked, keys } = await createOrgKey(twice(data));
      setDraft({ locked, keys, code: recoveryCode(master) }); setCopied(false);
    });
  }
  function confirm() {
    if (!draft) return;
    void run(async () => {
      await api('/workspace/key', 'PUT', draft.locked);
      await forgetKeys(); await rememberKeys(orgId, draft.keys);
      setDraft(undefined); setMode('idle'); await load(); onChanged();
      setMessage('機構密語已設定。同事下次開啟工作台時，要輸入這句密語才能同步。');
    });
  }
  function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const form = event.currentTarget;
    if (!stored) return;
    void run(async () => {
      const passphrase = twice(data);
      const old = String(data.get('current') ?? '');
      const master = useCode ? readRecoveryCode(old) : await unlockMaster(stored, old);
      const keys = await keysFor(master, stored);
      await api('/workspace/key', 'PUT', await lock(master, passphrase, stored.keyId, stored.iterations));
      await rememberKeys(orgId, keys);
      form.reset(); setMode('idle'); await load(); onChanged();
      setMessage('機構密語已更改。資料不用重新加密；同事下次要用新密語解鎖。恢復碼不變。');
    });
  }

  const newKeyForm = <form onSubmit={prepare} className="account-key__form">
    <label>機構密語<input name="passphrase" type="password" autoComplete="new-password" required minLength={MIN_PASSPHRASE} maxLength={256} /></label>
    <label>再輸入一次<input name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSPHRASE} maxLength={256} /></label>
    <p>最少 {MIN_PASSPHRASE} 個字元，建議用一句只有機構同事知道的話。伺服器不會收到這句密語，我們也無法替你找回。</p>
    <button disabled={busy}>{busy ? '正在產生…' : '下一步：產生恢復碼'}</button>
  </form>;

  return <section className="account-key"><h2>資料加密（機構密語）</h2>
    <p>開啟「跨裝置同步」後，住戶姓名、電話、備註和記錄文字會先在瀏覽器加密，才存到伺服器。伺服器、VPS 管理員和開發團隊都看不到內容。</p>
    {error && <p role="alert" className="account-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {stored === undefined ? <p>正在讀取…</p> : draft ? <div className="account-key__code">
      <h3>恢復碼（只顯示這一次）</h3>
      <p>忘記密語時，只有這組恢復碼能打開資料。請抄下或列印，交給機構負責人保管；不要拍照傳訊息，也不要存在這部電腦上。</p>
      <output aria-label="恢復碼">{draft.code}</output>
      <label className="account-key__check"><input type="checkbox" checked={copied} onChange={e => setCopied(e.target.checked)} />我已抄下恢復碼，並交給負責人保管</label>
      <div className="account-key__actions"><button type="button" onClick={() => setDraft(undefined)} disabled={busy}>取消</button><button type="button" className="is-primary" onClick={confirm} disabled={!copied || busy}>啟用這句密語</button></div>
    </div> : !stored ? <>
      <p className="account-features__warn">尚未設定。未設定前，即使開啟跨裝置同步，伺服器也不會儲存任何資料。</p>
      {newKeyForm}
    </> : <>
      <p>已設定，最後更新：{new Date(stored.updatedAt).toLocaleString('zh-HK')}。</p>
      {mode === 'idle' && <div className="account-key__actions">
        <button type="button" onClick={() => { setMode('change'); setUseCode(false); }}>更改密語…</button>
        <button type="button" onClick={() => setMode('replace')}>換一把新密鑰（交接用）…</button>
      </div>}
      {mode === 'change' && <form onSubmit={change} className="account-key__form">
        <label>{useCode ? '恢復碼' : '目前的密語'}<input name="current" type={useCode ? 'text' : 'password'} autoComplete={useCode ? 'off' : 'current-password'} required /></label>
        <button type="button" className="account-text-button" onClick={() => setUseCode(!useCode)}>{useCode ? '改用目前的密語' : '忘記了？改用恢復碼'}</button>
        <label>新密語<input name="passphrase" type="password" autoComplete="new-password" required minLength={MIN_PASSPHRASE} maxLength={256} /></label>
        <label>再輸入一次<input name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSPHRASE} maxLength={256} /></label>
        <div className="account-key__actions"><button type="button" onClick={() => setMode('idle')}>取消</button><button disabled={busy}>{busy ? '正在處理…' : '更改密語'}</button></div>
      </form>}
      {mode === 'replace' && <>
        <p className="account-features__warn">換新密鑰後，舊密語和舊恢復碼全部作廢。為免資料打不開，<b>只有工作區是空的時候才可以換</b>：請先匯出 Excel，再清空工作區。交給機構時，由機構負責人在這裡設定自己的密語。</p>
        {newKeyForm}
        <button type="button" onClick={() => setMode('idle')}>取消</button>
      </>}
    </>}
  </section>;
}
