import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { blockedProviders, callableProviders, providerSpec } from '../ai/providers';
import { recalledKeys, unlockedKeys, type LockedKey } from '../data/orgKey';
import { sealSecret, type WorkspaceKeys } from '../data/workspaceCipher';

/** What the server says about the institution's credential. It never includes any part of the key. */
interface AiStatus {
  configured: boolean;
  provider?: string;
  providerLabel?: string;
  model?: string;
  updatedAt?: number;
  updatedBy?: string | null;
}

/**
 * The AI credential, set by an institution's administrator. The key is sealed in this browser
 * with the institution keys before it is sent, so the server stores a value it cannot read
 * (`docs/AI_ASSISTANT.md` 第 5 節). Members use the assistant but never see or change the key.
 *
 * The input is cleared as soon as it is saved, and the plaintext is never put in state that
 * outlives the submit: what stays is the sealed copy on the server.
 */
export function AiSettingsPanel({ orgId, admin }: { orgId: string; admin: boolean }) {
  const [status, setStatus] = useState<AiStatus>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    setStatus(await api<AiStatus>('/org/ai'));
  }, []);
  useEffect(() => { void reload().catch(e => setError(e instanceof Error ? e.message : '讀取失敗。')); }, [reload]);

  /**
   * The institution keys to seal with. Usually the workspace has already unlocked them; when
   * sync is off the page never settles the workspace, so look for what this device stored —
   * but only the key the server currently names, or a rotated passphrase would seal a value
   * nobody can open.
   */
  async function keysForSealing(): Promise<WorkspaceKeys | undefined> {
    const ready = unlockedKeys(orgId);
    if (ready) return ready;
    try {
      const { key } = await api<{ key: LockedKey | null }>('/workspace/key');
      return key ? await recalledKeys(orgId, key.keyId) : undefined;
    } catch { return undefined; }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失敗。'); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    const provider = String(data.get('provider') ?? ''), model = String(data.get('model') ?? '').trim(), key = String(data.get('key') ?? '').trim();
    if (!key) { setError('請貼上 API key。'); return; }
    void run(async () => {
      // Without the institution keys the key could only live in this tab, so it is not saved at
      // all: storing it some other way would be exactly the leak this design avoids.
      const keys = await keysForSealing();
      if (!keys) { setError('這部裝置尚未解鎖機構密語，無法安全保存 AI 密鑰。請先到下面「機構密語」解鎖或設定，再回來設定。'); return; }
      const sealedKey = await sealSecret(keys, key);
      form.reset();
      setStatus(await api<AiStatus>('/org/ai', 'PUT', { provider, model, sealedKey }));
      setEditing(false);
      setMessage('AI 密鑰已加密保存，機構內同事都可以使用 AI 建議。');
    });
  }
  function remove() {
    void run(async () => {
      setStatus(await api<AiStatus>('/org/ai', 'DELETE'));
      setMessage('AI 密鑰已移除，AI 建議即時停用。');
    });
  }
  const set = status?.configured === true;
  return <section className="account-key account-ai">
    <h2>AI 助手</h2>
    <p>AI 只用來在「AI 助手」對話框裡整理文字或建議 Excel 欄位對應，不會自行寫入資料；寫入前會列出「將執行的目標」，由同事看過、按確認後署名寫入。密鑰在瀏覽器用機構密語加密後才上傳，伺服器讀不到內容。</p>
    {status === undefined ? <p className="account-note">讀取中…</p> : <>
      <p className="account-note">{set
        ? <>已設定：<strong>{status.providerLabel}</strong> · {status.model} · 最後修改 {status.updatedAt ? new Date(status.updatedAt).toLocaleString('zh-HK') : '—'}{status.updatedBy ? `（${status.updatedBy}）` : ''}</>
        : '尚未設定 API key。'}</p>
      {set && providerSpec(status.provider ?? '')?.browserDirect === false && <p className="account-error" role="alert">目前設定的供應商尚未通過瀏覽器直連實測，AI 建議會無法使用；請更換為 {callableProviders()[0]?.label}。</p>}
      {!admin && <p className="account-note">{set ? '密鑰由機構管理員維護；你可以使用 AI 建議，但看不到也改不了這把 key。' : '請聯絡機構管理員設定 API key。'}</p>}
      {admin && !editing && <div className="account-key__actions">
        <button type="button" className="is-primary" disabled={busy} onClick={() => { setEditing(true); setError(''); setMessage(''); }}>{set ? '更換密鑰…' : '設定密鑰…'}</button>
        {set && <button type="button" disabled={busy} onClick={remove}>移除密鑰</button>}
      </div>}
      {admin && editing && <form className="account-key__form" onSubmit={save}>
        <label>供應商<select name="provider" defaultValue={status.provider ?? callableProviders()[0]?.id} required>
          {callableProviders().map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          {blockedProviders().map(provider => <option key={provider.id} value={provider.id} disabled>{provider.label}（未通過瀏覽器直連實測）</option>)}
        </select></label>
        <small className="account-note">第一版只開放已實測可由瀏覽器直連的供應商；其餘暫時停用（原因見 docs/AI_ASSISTANT.md 第 4 節）。</small>
        <label>型號<input name="model" defaultValue={status.model ?? ''} placeholder={providerSpec(status.provider ?? '')?.modelHint ?? '例如 deepseek-flash'} required maxLength={80} autoComplete="off" spellCheck={false} /></label>
        {/* Not `type="password"`: a password manager would offer to save and later autofill it. */}
        <label>API key<input name="key" autoComplete="off" spellCheck={false} required maxLength={4096} /></label>
        <p>只存放在這間機構。儲存後輸入框會清空，之後任何人也看不到這把 key。</p>
        <div className="account-key__actions">
          <button type="button" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>取消</button>
          <button className="is-primary" disabled={busy}>加密並儲存</button>
        </div>
      </form>}
    </>}
    {error && <p role="alert" className="account-error">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
