import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, SESSION_IDLE_MS, setCsrf, type Session } from './api';
import { setWorkspaceAccount } from '../app/store';
import { AccountPanel } from './AccountPanel';
import { AccountContext } from './accountContext';
import { WorkspaceAdvancedSettings } from '../components/WorkspaceAdvancedSettings';
import './accounts.css';

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
    setCsrf(); setSession(undefined); setSettings(false); setWorkspaceAccount();
  }, []);
  const accept = useCallback((next: Session) => {
    setCsrf(next.csrf); setWorkspaceAccount(next.user.id, next.user.name); setSession(next);
  }, []);
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
    const expired = () => { drop(); setNotice('登入已結束，請重新登入。'); };
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
    const expiry = window.setTimeout(() => { drop(); setNotice('登入已過期，請重新登入。'); }, Math.min(session.expiresAt - Date.now(), SESSION_IDLE_MS));
    window.addEventListener('pointerdown', active); window.addEventListener('keydown', active); window.addEventListener('focus', focus);
    return () => { clearInterval(timer); clearTimeout(expiry); window.removeEventListener('pointerdown', active); window.removeEventListener('keydown', active); window.removeEventListener('focus', focus); };
  }, [session, refresh, drop]);
  function broadcast() { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('atlas-account'); channel.postMessage('changed'); channel.close(); } }
  function signedOut() { drop(); broadcast(); setNotice('請重新登入。'); }
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
    <p className="account-note">目前工作台僅用於合成資料示範。帳號不會讓業務資料自動跨裝置同步。</p>
  </section></main>;
  // The workspace header shows the account; this gate only supplies what it needs.
  const controls = { name: session.user.name, role: session.user.role, busy, openSettings: () => setSettings(true), logout: () => void logout() };
  return <AccountContext.Provider value={controls}><div className="authenticated-app">
    {error && <p role="alert" className="account-error">{error}</p>}
    {settings ? <AccountPanel session={session} onClose={() => setSettings(false)} onSignedOut={signedOut} advanced={<WorkspaceAdvancedSettings />} /> : <div key={session.user.id} className="authenticated-workspace">{children}</div>}
  </div></AccountContext.Provider>;
}
