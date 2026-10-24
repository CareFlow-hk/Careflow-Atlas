/** The institution's AI key, unsealed on this device for one page lifetime.
 *
 * The server hands out only the sealed copy (`GET /api/org/ai/key`); opening it needs the
 * institution keys this device already unlocked with the passphrase. The plaintext lives
 * in this module's memory and nowhere else — not localStorage, not IndexedDB, not a
 * component's state — and signing out drops it (`forgetAiKey`). That does not hide the key
 * from a determined member, and the interface never claims it does; the point is that a
 * device that gets picked up does not keep a second usable credential (`docs/AI_ASSISTANT.md` 3).
 */
import { api } from '../auth/api';
import { recalledKeys, unlockedKeys, type LockedKey } from '../data/orgKey';
import { openSecret } from '../data/workspaceCipher';
import { providerSpec, type ProviderId } from './providers';

export interface AiCredential { provider: ProviderId; model: string; key: string }

interface SealedCredential { provider: string; model: string; sealedKey: string }

let cached: { orgId: string; credential: AiCredential } | undefined;

/** Drops the unsealed key. Called on sign-out, expiry and any change of institution. */
export function forgetAiKey(): void { cached = undefined; }

/** The institution keys this device holds; the same lookup the settings panel uses to seal. */
async function deviceKeys(orgId: string) {
  const ready = unlockedKeys(orgId);
  if (ready) return ready;
  const { key } = await api<{ key: LockedKey | null }>('/workspace/key');
  return key ? await recalledKeys(orgId, key.keyId) : undefined;
}

/** Fetches, checks and unseals the credential. Throws a plain Error with a sentence for the person. */
export async function aiCredential(orgId: string): Promise<AiCredential> {
  if (cached?.orgId === orgId) return cached.credential;
  // A refusal here is already a sentence for the person: the switch is off, or no key is set.
  const sealed = await api<SealedCredential>('/org/ai/key');
  const spec = providerSpec(sealed.provider);
  if (!spec) throw new Error(`不支援的 AI 供應商「${sealed.provider}」，請機構管理員重新設定。`);
  if (!spec.browserDirect) throw new Error(`「${spec.label}」尚未通過瀏覽器直連實測，暫時不能使用（${spec.cors}）。`);
  const keys = await deviceKeys(orgId).catch(() => undefined);
  if (!keys) throw new Error('這部裝置尚未解鎖機構密語，無法解開 AI 密鑰。請先到「設定 › 機構密語」解鎖，再回來使用 AI 建議。');
  let key: string;
  try { key = await openSecret(keys, sealed.sealedKey); }
  catch { throw new Error('無法解開 AI 密鑰，可能是機構密語已更換。請機構管理員重新設定密鑰。'); }
  const credential: AiCredential = { provider: spec.id, model: sealed.model, key };
  cached = { orgId, credential };
  return credential;
}
