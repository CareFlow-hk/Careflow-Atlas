/** The AI providers this build may call, and the measured limits of each.
 *
 * The whitelist is closed and every endpoint is written here: there is no base-URL
 * field anywhere, because a settable URL would let anyone send an institution's data
 * to a host of their choosing (`docs/AI_ASSISTANT.md` 4). A provider is only offered
 * when a browser can actually read its answer — CORS is a hard requirement, and the
 * `cors` note records what was measured rather than what the vendor promises.
 *
 * The ids mirror `PROVIDERS` in `server/orgAi.mjs`; keep the two lists equal.
 */
export type ProviderId = 'azure-openai' | 'openai' | 'anthropic' | 'deepseek';

export interface ProviderRequest { model: string; system: string; user: string }

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** A model name worth typing, shown as the settings input's placeholder. */
  modelHint: string;
  /** True only when this build has both an endpoint and a measured browser path. */
  browserDirect: boolean;
  /** What was measured, and when; the settings panel shows this for blocked providers. */
  cors: string;
  endpoint?: string;
  headers?: (key: string) => Record<string, string>;
  body?: (request: ProviderRequest) => unknown;
  /** The assistant's text out of the provider's own envelope. */
  reply?: (value: unknown) => string;
}

const DEEPSEEK: ProviderSpec = {
  id: 'deepseek', label: 'DeepSeek', modelHint: '例如 deepseek-flash（或 deepseek-v4-pro）',
  browserDirect: true,
  cors: '2026-10-23 實測：預檢 200、帶無效 key 的 POST 401，兩者都回 access-control-allow-origin，瀏覽器可直接呼叫。',
  endpoint: 'https://api.deepseek.com/chat/completions',
  headers: key => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
  // Deterministic and JSON-only: the reply is parsed, never read as prose.
  body: ({ model, system, user }) => ({
    model, temperature: 0, stream: false, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }),
  reply: (value) => {
    const content = (value as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  },
};

/** Not callable from the browser yet, each for a reason that was measured rather than assumed. */
const BLOCKED: ProviderSpec[] = [
  {
    id: 'azure-openai', label: 'Azure OpenAI', modelHint: '例如 gpt-4.1-mini',
    browserDirect: false,
    cors: '需要在 Azure 資源上設定允許的來源網域（CORS），而且網址含資源名稱與部署名稱；第一版未開放瀏覽器直連。',
  },
  {
    id: 'openai', label: 'OpenAI', modelHint: '例如 gpt-4o-mini',
    browserDirect: false,
    cors: '2026-10-23 由測試機實測時被地區限制擋下（Country, region, or territory not supported），未能確認 CORS；確認前不開放。',
  },
  {
    id: 'anthropic', label: 'Anthropic', modelHint: '例如 claude-sonnet-4-5',
    browserDirect: false,
    cors: '2026-10-23 由測試機實測時回應 403 Request not allowed，未能確認 CORS；官方稱可加 anthropic-dangerous-direct-browser-access 直連，需在香港的瀏覽器再實測。',
  },
];

export const PROVIDER_SPECS: readonly ProviderSpec[] = [DEEPSEEK, ...BLOCKED];

export function providerSpec(id: string): ProviderSpec | undefined {
  return PROVIDER_SPECS.find(spec => spec.id === id);
}

/** The providers a person may actually pick: a stored key for any other id could never be used. */
export function callableProviders(): ProviderSpec[] {
  return PROVIDER_SPECS.filter(spec => spec.browserDirect);
}

/** Named separately so the settings panel can list a blocked provider with its reason. */
export function blockedProviders(): ProviderSpec[] {
  return PROVIDER_SPECS.filter(spec => !spec.browserDirect);
}
