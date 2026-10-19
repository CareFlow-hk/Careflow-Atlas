import { describe, expect, it } from 'vitest';
import { demoSnapshot } from './demoFixture';
import { createCipher, deriveKeys, SEALED_PREFIX, SENSITIVE_FIELDS, WorkspaceKeyError } from './workspaceCipher';
import { createOrgKey, keysFor, lock, PassphraseError, readRecoveryCode, recoveryCode, unlockMaster } from './orgKey';
import { validateSnapshot } from '../domain/schema';
import type { OutreachSnapshot } from '../domain/types';
// @ts-expect-error The server is plain JavaScript without type declarations.
import { assertSealed, SENSITIVE_FIELDS as SERVER_FIELDS } from '../../server/workspaceSealed.mjs';

const passphrase = '西營盤 測試用的機構密語 2026';
/** A workspace with every kind of sensitive field filled in, on top of the demo. */
function sample(): OutreachSnapshot {
  const snapshot = structuredClone(demoSnapshot);
  const observation = snapshot.observations.find(item => item.followUp) ?? snapshot.observations[0];
  Object.assign(observation, { note: '住戶說下月搬走', evidence: ['門口有鞋', '有人應門'], optionNotes: { coverage: '鄰居代答' }, paperLine: '3樓A 陳生 9123 4567', correctionReason: '日期寫錯' });
  observation.followUp = { action: '再訪', status: 'OPEN', assignee: '阿明', timingNote: '晚上七點後' };
  snapshot.people[0] = { ...snapshot.people[0], displayName: '陳大文', phone: '91234567', addressNote: '後門入', contactNote: '只說廣東話' };
  return snapshot;
}
const keys = async () => (await createOrgKey(passphrase)).keys;

describe('encrypting the workspace on its way to the server', () => {
  it('keeps the same list of sensitive fields as the server', () => {
    expect(SENSITIVE_FIELDS).toEqual(SERVER_FIELDS);
  });

  it('hides every sensitive field, and the server accepts what it sends', async () => {
    const cipher = createCipher(await keys());
    const snapshot = sample();
    const sealed = await cipher.seal(snapshot) as OutreachSnapshot;
    const text = JSON.stringify(sealed);
    for (const secret of ['陳大文', '91234567', '後門入', '只說廣東話', '住戶說下月搬走', '門口有鞋', '鄰居代答', '陳生', '再訪', '阿明', '晚上七點後', '日期寫錯']) expect(text).not.toContain(secret);
    expect(sealed.people[0].phone!.startsWith(SEALED_PREFIX)).toBe(true);
    expect(() => assertSealed(sealed)).not.toThrow();
    expect(() => assertSealed(snapshot)).toThrow(/未加密/);
    // What the server needs to check permissions stays readable.
    expect(sealed.observations.map(o => [o.id, o.buildingId, o.createdBy, o.coverage])).toEqual(snapshot.observations.map(o => [o.id, o.buildingId, o.createdBy, o.coverage]));
    expect(sealed.buildings).toEqual(snapshot.buildings);
    // The caller's copy is untouched.
    expect(snapshot.people[0].displayName).toBe('陳大文');
  });

  it('opens back to exactly what was sealed', async () => {
    const cipher = createCipher(await keys());
    const snapshot = sample();
    const opened = await cipher.open(await cipher.seal(snapshot));
    expect(opened).toEqual(snapshot);
    expect(() => validateSnapshot(opened)).not.toThrow();
  });

  /*
   * The server compares records to decide what a member changed. An unchanged value must
   * give the same ciphertext, or every save would look like a rewrite of everyone's records.
   */
  it('encrypts an unchanged value the same way every time, and a changed one differently', async () => {
    const cipher = createCipher(await keys());
    const snapshot = sample();
    const once = await cipher.seal(snapshot) as OutreachSnapshot, twice = await cipher.seal(structuredClone(snapshot)) as OutreachSnapshot;
    expect(twice).toEqual(once);
    const edited = structuredClone(snapshot); edited.people[0].phone = '98765432';
    const after = await cipher.seal(edited) as OutreachSnapshot;
    expect(after.people[0].phone).not.toBe(once.people[0].phone);
    expect(after.people[0].displayName).toBe(once.people[0].displayName);
    expect(after.people.slice(1)).toEqual(once.people.slice(1));
  });

  it('does not open ciphertext moved to another record or field', async () => {
    const cipher = createCipher(await keys());
    const sealed = await cipher.seal(sample()) as OutreachSnapshot;
    const swapped = structuredClone(sealed);
    swapped.people[0].phone = sealed.people[0].displayName;
    await expect(cipher.open(swapped)).rejects.toBeInstanceOf(WorkspaceKeyError);
  });

  it('does not open with another institution key', async () => {
    const sealed = await createCipher(await keys()).seal(sample());
    await expect(createCipher(await keys()).open(sealed)).rejects.toBeInstanceOf(WorkspaceKeyError);
  });

  it('shows a value written before encryption as it is', async () => {
    const cipher = createCipher(await keys());
    expect(await cipher.open(sample())).toEqual(sample());
  });
});

describe('the institution key', () => {
  it('unlocks with the passphrase and not with another', async () => {
    const { master, locked, keys } = await createOrgKey(passphrase);
    expect(await unlockMaster(locked, passphrase)).toEqual(master);
    await expect(unlockMaster(locked, `${passphrase}!`)).rejects.toBeInstanceOf(PassphraseError);
    expect((await keysFor(master, locked)).keyId).toBe(keys.keyId);
    // The locked copy the server keeps does not contain the key.
    expect(JSON.stringify(locked)).not.toContain(Buffer.from(master).toString('base64'));
  });

  it('refuses a short passphrase', async () => {
    await expect(createOrgKey('短密語')).rejects.toBeInstanceOf(PassphraseError);
  });

  it('changes passphrase without changing the key, so nothing needs encrypting again', async () => {
    const { master, locked } = await createOrgKey(passphrase);
    const relocked = await lock(master, '另一句新的機構密語 2027', locked.keyId);
    expect(relocked.keyId).toBe(locked.keyId);
    expect(relocked.salt).not.toBe(locked.salt);
    expect(await unlockMaster(relocked, '另一句新的機構密語 2027')).toEqual(master);
    await expect(unlockMaster(relocked, passphrase)).rejects.toBeInstanceOf(PassphraseError);
  });

  it('reads back a recovery code, forgiving dashes, spaces, case and look-alike letters', async () => {
    const { master, locked } = await createOrgKey(passphrase);
    const code = recoveryCode(master);
    expect(code).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    expect(readRecoveryCode(code)).toEqual(master);
    expect(readRecoveryCode(code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l'))).toEqual(master);
    expect((await keysFor(readRecoveryCode(code), locked)).keyId).toBe(locked.keyId);
    expect(() => readRecoveryCode(code.slice(0, -2))).toThrow(PassphraseError);
    const stranger = (await createOrgKey(passphrase)).master;
    await expect(keysFor(stranger, locked)).rejects.toBeInstanceOf(PassphraseError);
  });

  it('derives the same key fingerprint from the same data key', async () => {
    const master = crypto.getRandomValues(new Uint8Array(32));
    expect((await deriveKeys(master)).keyId).toBe((await deriveKeys(master.slice())).keyId);
  });
});
