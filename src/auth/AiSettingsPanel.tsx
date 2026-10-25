import { useEffect, useState } from 'react';
import { api } from './api';

/** What the server says about the assistant. It never includes any part of the key. */
interface AiStatus {
  provider: string;
  configured: boolean;
  enabled: boolean;
  model: string;
  fallbackModel: string | null;
}

/** Provider ids as they appear in the status; mirrors `AI_ASSIST_PROVIDERS` in server/aiAssist.mjs. */
const providerLabel = (id: string) => ({ 'azure-openai': 'Azure OpenAI', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek' } as Record<string, string>)[id] ?? id;

/**
 * The assistant's state, read-only since phase 5 (`docs/AI_ASSISTANT.md` 5.3).
 *
 * The key used to be an institution's own, sealed in this browser and stored on the server.
 * It now lives only in the server's `.env`, so there is nothing here to set, seal or reveal:
 * whoever runs the site configures the key, and turns the switch in the switches section.
 * Leaving a form here would promise a control nobody has.
 */
export function AiSettingsPanel() {
  const [status, setStatus] = useState<AiStatus>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void api<AiStatus>('/ai/status')
      .then(value => { if (live) setStatus(value); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : '讀取失敗。'); });
    return () => { live = false; };
  }, []);
  return <section className="account-key account-ai">
    <h2>AI 助手</h2>
    <p>AI 只用來在「AI 助手」對話框裡整理文字或建議 Excel 欄位對應，不會自行寫入資料；寫入前會列出「將執行的目標」，由同事看過、按確認後署名寫入。AI 由伺服器代為呼叫，密鑰只存放在伺服器，瀏覽器和機構密語都不涉及。</p>
    {status === undefined ? <p className="account-note">{error || '讀取中…'}</p> : <>
      <p className="account-note">{status.configured
        ? <>服務已設定：<strong>{providerLabel(status.provider)}</strong> · {status.model}{status.fallbackModel ? `（備用 ${status.fallbackModel}）` : ''}</>
        : '伺服器尚未設定 AI 密鑰，AI 助手暫時無法使用；請聯絡平台管理員。'}</p>
      <p className="account-note">本機構目前{status.enabled ? '已開啟' : '未開啟'}。開關由平台管理員決定，你在「功能開關」看得到狀態。</p>
    </>}
    {error && status !== undefined && <p role="alert" className="account-error">{error}</p>}
  </section>;
}
