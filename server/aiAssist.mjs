import { requireValue } from './auth.mjs';

/**
 * What an `aiAssist` marker on a record may say (`docs/AI_ASSISTANT.md` 6.3).
 *
 * Phase 5 moved this out of `server/orgAi.mjs`: that file holds the sealed-key store the
 * proxy replaces, and it is scheduled for deletion, but this whitelist must outlive it.
 * The reason is the shape of a workspace save — the whole snapshot is written every time,
 * so **every** record carrying a marker is re-checked on **every** save. Dropping a value
 * that was legal when a record was written would not reject that record once; it would
 * reject every future save of that institution's workspace, for a change nobody made.
 *
 * So the whitelist answers «was this value ever legal to write?», not «which providers may
 * be used now?». Only the server proxy writes markers from phase 5 on, and it writes
 * `azure-openai`; the rest are history that must keep saving.
 */
export const AI_ASSIST_PROVIDERS = Object.freeze({
  'azure-openai': 'Azure OpenAI',
  // Historical (phases 1–4, browser-direct). No code produces these any more.
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
});

/** The only provider the server proxy writes. */
export const AI_ASSIST_PROVIDER = 'azure-openai';

const AI_ASSIST_KEYS = new Set(['at', 'provider', 'model', 'requestId']);
/** The same model-name shape the settings accepted before phase 5. */
export const AI_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
/** The proxy issues this; Azure's own request id is a uuid. Shape only, never a proof. */
export const AI_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

/**
 * The AI disclosure a record carries, checked for shape only.
 *
 * The server cannot know whether an assistant was really used, so this is a disclosure,
 * not a proof, and it never decides who may write. It stays plain text — a sealed value
 * would be unreadable to the administrator who must see it — which is also why the
 * whitelist check rejects anything the browser wrapped.
 *
 * `requestId` is accepted here from phase 5 on but not yet verified against the server's
 * own record of issued requests; that check lands with `ai_requests` (phase 5 PR5).
 */
export function assertAiAssist(row) {
  const value = row?.aiAssist;
  if (value === undefined) return;
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 400, 'AI 協助標記格式不正確。');
  requireValue(Object.keys(value).every(key => AI_ASSIST_KEYS.has(key)), 400, 'AI 協助標記含有多餘的欄位。');
  requireValue(typeof value.provider === 'string' && Object.hasOwn(AI_ASSIST_PROVIDERS, value.provider), 400, 'AI 協助標記的供應商不在允許清單內。');
  requireValue(typeof value.model === 'string' && AI_MODEL.test(value.model), 400, 'AI 協助標記的型號格式不正確。');
  requireValue(typeof value.at === 'string' && value.at.length <= 40 && Number.isFinite(Date.parse(value.at)), 400, 'AI 協助標記的時間格式不正確。');
  if (value.requestId !== undefined) requireValue(typeof value.requestId === 'string' && AI_REQUEST_ID.test(value.requestId), 400, 'AI 協助標記的請求編號格式不正確。');
}
