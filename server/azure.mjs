/**
 * The one place the server reads its Azure OpenAI settings.
 *
 * Photo recognition and the AI assistant share one resource and one key, so they read the
 * same four variables and the same validation. `docs/AI_ASSISTANT.md` 5.1: the key lives
 * here and only here — not in the database, not in an audit row, not in a response.
 *
 * `configured` is false when the key is missing **or** the endpoint is not the exact
 * `/openai/v1` shape, so a mistyped endpoint cannot quietly become a request to somewhere
 * else. A caller that sees `configured: false` must refuse rather than try.
 */
export function azureSettings(env = process.env) {
  const endpoint = env.AZURE_OPENAI_ENDPOINT || 'https://CareFlow-VPS.services.ai.azure.com/openai/v1';
  const model = env.AZURE_OPENAI_DEPLOYMENT || 'gpt-6-luna';
  const fallbackModel = (env.AZURE_OPENAI_FALLBACK_DEPLOYMENT ?? 'gpt-6.1-sol').trim();
  const key = env.AZURE_OPENAI_API_KEY?.trim();
  let valid = false;
  try {
    const url = new URL(endpoint);
    valid = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.replace(/\/$/, '') === '/openai/v1';
  } catch { /* unavailable configuration */ }
  return { endpoint: endpoint.replace(/\/$/, ''), model, fallbackModel, key, configured: Boolean(key && valid) };
}
