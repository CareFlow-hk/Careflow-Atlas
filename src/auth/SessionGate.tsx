import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, SESSION_IDLE_MS, setCsrf, type Session } from './api';
import { pullWorkspace, setWorkspaceAccount } from '../app/store';
import { AccountPanel } from './AccountPanel';
import { AccountContext, type FeatureSwitches } from './accountContext';
import { WorkspaceAdvancedSettings } from '../components/WorkspaceAdvancedSettings';
import { WorkspaceUnlock } from './WorkspaceUnlock';
import { forgetKeys, recalledKeys, type LockedKey } from '../data/orgKey';
import { createCipher, type WorkspaceCipher } from '../data/workspaceCipher';
import './accounts.css';

/**
 * Where this device's workspace lives. `local` until every condition for sync holds: the
 * switch is on, the institution has a key, and this device has unlocked it.
 */
type Sync =
  | { mode: 'checking' }
  | { mode: 'local'; reason: 'off' | 'nokey' | 'error' }
  | { mode: 'locked'; key: LockedKey }
  | { mode: 'on'; key: LockedKey };
const accountOf = (session: Session) => ({ id: session.user.id, name: session.user.name, role: session.user.role, orgId: session.user.orgId });
/** Unlocked keys are remembered per institution; an account without one keeps its own. */
const keyScope = (session: Session) => session.user.orgId ?? session.user.id;

function readGrant() {
  const match = location.hash.match(/^#set-password=([\w-]{43})$/);
  if (!match) return '';
  history.replaceState(null, '', location.pathname + location.search);
  return match[1];
}
export function SessionGate({ children }: { children: ReactNode }) {
  // Capture once outside the state updater: StrictMode replays updater functions.
  const grantRef = useRef<string | undefined>(undefined);
  if (grantRef.current === undefined) grantRef.current = readGrant();
  const [grant, setGrant] = useState(grantRef.current);
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState(false);
  // Off until the server says otherwise: a feature never appears just because a request failed.
  const [features, setFeatures] = useState<FeatureSwitches>({});
  const [featuresLoaded, setFeaturesLoaded] = useState(false);
  const [sync, setSync] = useState<Sync>({ mode: 'checking' });
  /** Bumped when this device's key changed (set or replaced in 設定), so sync is resolved again. */
  const [syncRound, setSyncRound] = useState(0);
  const cipher = useRef<WorkspaceCipher | undefined>(undefined);
  const sessionRef = useRef<Session | undefined>(undefined);
  // The account a password link is for: shown read-only and marked as the username, so a
  // password manager saves this account's password and does not overwrite another one.
  const [grantAccount, setGrantAccount] = useState<{ email: string; name: string }>();
  useEffect(() => {
    setGrantAccount(undefined);
    if (!grant) return;
    let live = true;
    api<{ email: string; name: string }>('/grant-info', 'POST', { token: grant })
      .then(info => { if (live) setGrantAccount(info); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : '連結無效或已過期。'); });
    return () => { live = false; };
  }, [grant]);
  const generation = useRef(0);
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    const navigate = () => { const token = readGrant(); if (token) { setGrant(token); setError(''); } };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const drop = useCallback(() => {
    generation.current++;
    cipher.current = undefined; sessionRef.current = undefined;
    setCsrf(); setSession(undefined); setSettings(false); setFeatures({}); setFeaturesLoaded(false); setSync({ mode: 'checking' }); setWorkspaceAccount();
  }, []);
  /*
   * The institution, not the account, owns the shared working copy; the role decides whose
   * records this person may withdraw. The cipher is whatever this device has unlocked: none
   * on a fresh login, so the workspace stays local until the sync check below settles.
   */
  const accept = useCallback((next: Session) => {
    sessionRef.current = next;
    setCsrf(next.csrf); setWorkspaceAccount(accountOf(next), undefined, cipher.current); setSession(next);
    void api<{ features: FeatureSwitches }>('/features').then(value => setFeatures(value.features)).catch(() => setFeatures({}))
      .finally(() => setFeaturesLoaded(true));
  }, []);
  /*
   * Decide where the workspace lives. The workspace is not shown until this has settled, so
   * it never opens on the local copy and then jumps to the shared one.
   */
  const userId = session?.user.id, syncOn = features.workspaceSync === true;
  const settle = useCallback((next: Sync, nextCipher?: WorkspaceCipher) => {
    const current = sessionRef.current;
    if (!current) return;
    cipher.current = nextCipher;
    setWorkspaceAccount(accountOf(current), undefined, nextCipher);
    setSync(next);
  }, []);
  useEffect(() => {
    const current = sessionRef.current;
    if (!userId || !featuresLoaded || !current) return;
    if (!syncOn) { settle({ mode: 'local', reason: 'off' }); return; }
    let live = true;
    void (async () => {
      try {
        const { key } = await api<{ key: LockedKey | null }>('/workspace/key');
        if (!live) return;
        if (!key) { settle({ mode: 'local', reason: 'nokey' }); return; }
        const keys = await recalledKeys(keyScope(current), key.keyId);
        if (!live) return;
        if (keys) settle({ mode: 'on', key }, createCipher(keys));
        else settle({ mode: 'locked', key });
      } catch { if (live) settle({ mode: 'local', reason: 'error' }); }
    })();
    return () => { live = false; };
  }, [userId, featuresLoaded, syncOn, syncRound, settle]);
  const refresh = useCallback(async () => {
    const version = generation.current;
    try { const value = await api<Session>('/session'); if (version === generation.current) accept(value); }
    catch (e) {
      if (version !== generation.current) return;
      drop();
      if (!(e instanceof ApiError && e.status === 401)) setError('無法連接帳號服務。請檢查網絡後重試。');
    } finally { setLoading(false); }
  }, [accept, drop]);
  useEffect(() => {
    void refresh();
    const expired = () => { void forgetKeys(); drop(); setNotice('登入已結束，請重新登入。'); };
    window.addEventListener('atlas-session-expired', expired);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('atlas-account') : undefined;
    if (channel) channel.onmessage = () => { drop(); void refresh(); };
    return () => { window.removeEventListener('atlas-session-expired', expired); channel?.close(); };
  }, [drop, refresh]);
  useEffect(() => {
    if (!session) return;
    const active = () => { lastActivity.current = Date.now(); };
    const check = () => { if (!document.hidden && Date.now() - lastActivity.current < 60_000) void refresh(); };
    const focus = () => { active(); void refresh(); };
    const timer = window.setInterval(check, 30_000);
    const expiry = window.setTimeout(() => { void forgetKeys(); drop(); setNotice('登入已過期，請重新登入。'); }, Math.min(session.expiresAt - Date.now(), SESSION_IDLE_MS));
    window.addEventListener('pointerdown', active); window.addEventListener('keydown', active); window.addEventListener('focus', focus);
    return () => { clearInterval(timer); clearTimeout(expiry); window.removeEventListener('pointerdown', active); window.removeEventListener('keydown', active); window.removeEventListener('focus', focus); };
  }, [session, refresh, drop]);
  /*
   * Colleagues' saves arrive without anyone pressing reload: when this window comes back into
   * view, and every half minute while it is in view. A hidden tab asks nothing.
   */
  const syncing = sync.mode === 'on';
  useEffect(() => {
    if (!syncing) return;
    const pull = () => { if (!document.hidden) void pullWorkspace(); };
    const timer = window.setInterval(pull, 30_000);
    window.addEventListener('focus', pull); document.addEventListener('visibilitychange', pull);
    return () => { clearInterval(timer); window.removeEventListener('focus', pull); document.removeEventListener('visibilitychange', pull); };
  }, [syncing]);
  function broadcast() { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('atlas-account'); channel.postMessage('changed'); channel.close(); } }
  // Signing out forgets the unlocked institution key on this device, too.
  function signedOut() { void forgetKeys(); drop(); broadcast(); setNotice('請重新登入。'); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    if (grant && data.get('password') !== data.get('confirm')) { setError('兩次密碼不一致。'); return; }
    setBusy(true); setError('');
    try {
      if (grant) {
        await api('/set-password', 'POST', { token: grant, password: data.get('password') });
        setGrant(''); signedOut(); setNotice('密碼已設定，請使用電郵和新密碼登入。');
      } else { const next = await api<Session>('/login', 'POST', { email: data.get('email'), password: data.get('password') }); generation.current++; lastActivity.current = Date.now(); accept(next); broadcast(); setNotice(''); }
    } catch (e) { setError(e instanceof Error ? e.message : '操作失敗。'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try { await api('/logout', 'POST'); signedOut(); }
    catch (e) { setError(e instanceof Error ? e.message : '登出失敗，請重試。'); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="account-loading" role="status">正在連接帳號服務…</main>;
  if (!session || grant) return <main className="login-page"><section className="login-card">
    <p className="account-brand">CareFlow Atlas</p><h1>{grant ? '設定帳號密碼' : '登入工作台'}</h1>
    <p>{grant ? '邀請和重設連結僅可使用一次，1 小時內有效。' : '使用管理員為你開通的機構帳號。'}</p>
    {error && <p role="alert" className="account-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form onSubmit={submit} key={grant ? 'set' : 'login'}>
      {!grant && <label>電郵<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>}
      {grant && <label>帳號<input name="username" type="email" autoComplete="username" readOnly value={grantAccount?.email ?? ''} placeholder="正在核對連結…" /></label>}
      <label>{grant ? '新密碼' : '密碼'}<input name="password" type="password" autoComplete={grant ? 'new-password' : 'current-password'} required minLength={grant ? 15 : undefined} maxLength={128} /></label>
      {grant && <><label>確認密碼<input name="confirm" type="password" autoComplete="new-password" required minLength={15} maxLength={128} /></label><p>15–128 個字元，可使用長句。</p></>}
      <button disabled={busy}>{busy ? '正在處理…' : grant ? '設定密碼' : '登入'}</button>
    </form>
    {grant ? <button className="account-text-button" onClick={() => { setGrant(''); setError(''); }}>返回登入</button> : <details><summary>忘記密碼或沒有帳號？</summary><p>請聯絡機構管理員核對身份，獲取一次性邀請或重設連結。管理員無法登入時，由 VPS 運維人員執行恢復命令。</p></details>}
    <p className="account-note">目前工作台僅用於合成資料示範。管理員開啟「跨裝置同步」後，同一機構的成員在不同裝置會看到同一份，住戶姓名、電話和記錄文字先在瀏覽器加密才存到伺服器；未開啟時資料只留在這部裝置。這仍不是正式的業務資料庫。</p>
  </section></main>;
  if (sync.mode === 'checking') return <main className="account-loading" role="status">正在確認同步設定…</main>;
  const admin = session.user.role === 'ADMIN';
  const scope = keyScope(session);
  // The workspace header shows the account; this gate only supplies what it needs.
  const where = sync.mode === 'on' ? 'shared' : 'device';
  const controls = { name: session.user.name, role: session.user.role, busy, features, workspace: where, openSettings: () => setSettings(true), logout: () => void logout() } as const;
  return <AccountContext.Provider value={controls}><div className="authenticated-app">
    {error && <p role="alert" className="account-error">{error}</p>}
    {!settings && sync.mode === 'locked' && <WorkspaceUnlock orgId={scope} locked={sync.key} onUnlocked={keys => settle({ mode: 'on', key: sync.key }, createCipher(keys))} />}
    {!settings && sync.mode === 'local' && sync.reason !== 'off' && <p className="workspace-unlock is-later" role="status">{sync.reason === 'error'
      ? '未能讀取機構密鑰，資料暫時只留在這部裝置。請稍後重新整理。'
      : admin ? '跨裝置同步已開啟，但尚未設定機構密語，資料只留在這部裝置。請到「設定」設定機構密語。' : '管理員尚未設定機構密語，資料暫時只留在這部裝置，不會同步給同事。'}</p>}
    {settings ? <AccountPanel session={session} features={features} onFeaturesChanged={setFeatures} onKeyChanged={() => setSyncRound(round => round + 1)} onClose={() => setSettings(false)} onSignedOut={signedOut} advanced={<WorkspaceAdvancedSettings />} />
      // Keyed on where the workspace lives, so switching to the shared copy loads it afresh.
      : <div key={`${session.user.id}:${sync.mode === 'on' ? sync.key.keyId : 'local'}`} className="authenticated-workspace">{children}</div>}
  </div></AccountContext.Provider>;
}
