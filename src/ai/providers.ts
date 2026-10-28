/** What to call the provider written on a record's `aiAssist` marker.
 *
 * The browser used to hold a callable provider list — endpoints, headers and body shapes —
 * and phase 5 removed it: the server makes every call, so this bundle has no endpoint and
 * no key to protect (`docs/AI_ASSISTANT.md` 5.3). What is left is display only.
 *
 * The ids mirror `AI_ASSIST_PROVIDERS` in `server/aiAssist.mjs`, including the historical
 * ones: records written before phase 5 carry `deepseek`／`openai`／`anthropic`, and those
 * must keep showing the name they were written with.
 */
const LABELS: Record<string, string> = {
  'azure-openai': 'Azure OpenAI',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
};

/** The label for a stored marker, or the raw id when this build has never heard of it. */
export function providerLabel(id: string): string {
  return Object.hasOwn(LABELS, id) ? LABELS[id] : id;
}
