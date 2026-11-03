import type { PlaceResult } from './placeSearch';

/**
 * The state of the search box at the top of the add-building panel, kept apart from the panel
 * so each transition can be asserted without a browser.
 *
 * One rule it exists to keep: 「找不到」 is something said about a search that came back empty,
 * not about a box that happens to be empty now. Choosing a result empties the list, and if that
 * left the flag alone the panel would deny the building one line under the name it just filled
 * in (2026-11-03).
 */
export interface SearchBox {
  query: string;
  results: PlaceResult[];
  searching: boolean;
  /** A search has finished; whether it found anything is `results`. */
  searched: boolean;
  /** Why the search failed, in words the person can act on. */
  problem?: string;
}

export const CLOSED: SearchBox = { query: '', results: [], searching: false, searched: false };

export type SearchEvent =
  /** The person typed; whatever the last search said no longer applies to these words. */
  | { kind: 'typed'; words: string }
  | { kind: 'asked' }
  | { kind: 'found'; results: PlaceResult[] }
  | { kind: 'failed'; message: string }
  /** A result was chosen: the list closes, and so does anything said about it. */
  | { kind: 'chosen' };

export function searchBox(state: SearchBox, event: SearchEvent): SearchBox {
  switch (event.kind) {
    case 'typed': return { ...state, query: event.words, searched: false };
    case 'asked': return { ...state, searching: true, problem: undefined };
    case 'found': return { ...state, searching: false, results: event.results, searched: true };
    // A failure is said out loud: an empty list would read as 「沒有這幢大廈」, which is a different thing.
    case 'failed': return { ...state, searching: false, results: [], searched: true, problem: event.message };
    case 'chosen': return { ...state, searching: false, results: [], searched: false, problem: undefined };
  }
}

/** Whether to say 「找不到」: only when a finished search actually came back empty. */
export const showsNothing = (state: SearchBox) => state.searched && !state.searching && !state.problem && state.results.length === 0;
