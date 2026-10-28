/** The topic gate's sentence, and the shape of what the page asks the server to read.
 *
 * The gate itself is the model's (`docs/AI_ASSISTANT.md` 7): a reply carries
 * `status: 'REFUSE'` and the page shows this one fixed sentence, so a refusal never becomes
 * an explanation, a hint or a redirection. Nothing here inspects text beforehand — the
 * keyword list that used to sit in this module is gone (2026-10-24), because it was wrong
 * in both directions and the file path never consulted it at all. What actually holds is
 * that a suggestion has no write path and a person confirms the target list first.
 *
 * The prompts moved to `server/aiPrompts.mjs` in phase 5: the browser no longer writes the
 * system prompt, and having a second copy here would be a second thing to keep true. What
 * stays is the request shape, which is the contract between this page and that server.
 */
export const SCOPE_REFUSAL = '與本項目無關，無法回答。';

export interface MappingRequest {
  sheetName: string;
  /** Index into `rows` of the header, or null when this part does not contain it. */
  headerRow: number | null;
  /** Header labels when the header is in an earlier part; the column order is unchanged. */
  headers?: readonly string[];
  /** Which part of the worksheet this is, so a reply can be tied to its slice. */
  part: { index: number; count: number };
  rows: readonly (readonly string[])[];
  columnCount: number;
  profileIds: readonly string[];
  fields: readonly { key: string; label: string }[];
  /** Columns withheld by the person; their cells are blank and must not be guessed. */
  withheldColumns: readonly number[];
  /**
   * What the person typed alongside the file, as a data block. It may explain the sheet
   * («大廈是裕安樓»), but it cannot add a column or a value: the mapping contract still only
   * accepts fields that exist and indexes inside the sheet.
   */
  context?: string;
}

export interface DraftRequest {
  text: string;
  /** The device's Hong Kong day, as `YYYY-MM-DD`; the only anchor for relative words. */
  today: string;
  /** Buildings the person can choose from; the reply may only name one of these ids. */
  buildings: readonly { id: string; name: string }[];
  /** Units already on record, as the app labels them, for the reply to copy verbatim. */
  locations: readonly { buildingId: string; floorLabel: string; unitLabel: string }[];
  coverage: readonly { key: string; label: string }[];
  contacts: readonly { key: string; label: string }[];
  assessments: readonly { key: string; label: string }[];
  categories: readonly { key: string; label: string }[];
}

export interface PatchRequest {
  /** What the person typed in the plan's chat. Every date and time must come from it. */
  text: string;
  /** The device's Hong Kong day, the only anchor for a relative word the person wrote. */
  today: string;
  sheetName: string;
  /** Columns that may be changed. A withheld column is absent, header included. */
  columns: readonly { columnIndex: number; header: string; field: string | null; label: string | null }[];
  /** Rows the person can change, with one value per entry of `columns`. */
  rows: readonly { row: number; values: readonly string[] }[];
  coverage: readonly { key: string; label: string }[];
  contacts: readonly { key: string; label: string }[];
  assessments: readonly { key: string; label: string }[];
  categories: readonly { key: string; label: string }[];
  /** Rows left out of `rows` because the sheet is long; they cannot be changed this turn. */
  omitted: number;
}
