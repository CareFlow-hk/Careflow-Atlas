import { parseCustomOptions, type CustomOptions } from '../domain/optionPrefs';
import { PersistenceError, type PersistenceAdapter } from './repository';

/**
 * Stored beside the snapshot and keyed by account, for the same reason: one person's
 * shortcuts are not another's. A shared institution-wide list would need the server
 * (see docs/ACCOUNTS.md); until then this stays local and per account.
 *
 * Preferences are a convenience, not a record. A read that fails or a value that no
 * longer resolves falls back to the built-in menu rather than blocking entry — losing
 * a shortcut must never cost someone their observation.
 */
export class OptionPrefsRepository {
  constructor(private readonly adapter: PersistenceAdapter, private readonly key = 'careflow-field-outreach.options') {}
  get(): CustomOptions {
    let raw: string | null;
    try { raw = this.adapter.read(this.key); }
    catch { return {}; }
    if (!raw) return {};
    try { return parseCustomOptions(JSON.parse(raw)); }
    catch { return {}; }
  }
  save(prefs: CustomOptions): CustomOptions {
    const next = parseCustomOptions(prefs);
    try { this.adapter.write(this.key, JSON.stringify(next)); }
    catch (error) { throw new PersistenceError('常用選項未能儲存，原有選項未改動。', error); }
    return next;
  }
}
