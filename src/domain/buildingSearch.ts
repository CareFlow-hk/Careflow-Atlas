export interface BuildingSearchItem {
  id: string;
  name: string;
  address: string;
}

/** Normalise only for comparison; the original building records stay untouched. */
export function normalizeBuildingQuery(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\s/g, '')
    .toLowerCase()
    .replace(/(\d)號/g, '$1');
}

/** A street-number query must not stop in the middle of a longer number (1 號 ≠ 16 號). */
function includesWithNumberBoundaries(text: string, query: string): boolean {
  let start = 0;
  while (start <= text.length - query.length) {
    const index = text.indexOf(query, start);
    if (index < 0) return false;
    const before = text[index - 1] ?? '';
    const after = text[index + query.length] ?? '';
    const leftValid = !/^\d/.test(query) || !/\d/.test(before);
    const rightValid = !/\d$/.test(query) || !/\d/.test(after);
    if (leftValid && rightValid) return true;
    start = index + 1;
  }
  return false;
}

/** Filter by name or address without merging buildings or changing their order. */
export function filterBuildings<T extends BuildingSearchItem>(
  buildings: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeBuildingQuery(query);
  if (!normalizedQuery) return [...buildings];

  return buildings.filter(building =>
    includesWithNumberBoundaries(normalizeBuildingQuery(building.name), normalizedQuery)
    || includesWithNumberBoundaries(normalizeBuildingQuery(building.address), normalizedQuery));
}
