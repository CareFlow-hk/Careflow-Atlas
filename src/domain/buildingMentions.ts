/**
 * Which building a person named in what they typed next to a file.
 *
 * A sheet often has no 大廈 column — the wording lives in how the paper was filed, not in
 * the rows — so the person types it: 「在裕安樓」. That sentence is how the file they are
 * uploading gets a building, and it is the only way it can get one: a building needs a
 * position on the map and a sheet never supplies one, so nothing here creates a building.
 *
 * The match is literal and local, not a model's guess (`CLAUDE.md` §4). A name is only
 * recognised when the person actually wrote it, and only when the workspace already has
 * exactly one building by that name; two names in one sentence, or a name that is part of
 * a longer one («裕安樓» inside «裕安樓二期»), is ambiguous and returns nothing rather than
 * picking. Whitespace is not part of a name: 「裕 安 樓」 is the same building.
 */

export interface NamedBuilding { id: string; name: string }

// Whitespace is not part of a name: 「裕 安 樓」 and 「裕安樓」 are the same building, the
// same normalisation the structure rules use (`floorUnitColumns` et al., CLAUDE.md §4).
const normal = (text: string) => text.replace(/[\s\u3000·・]/g, '').toLowerCase();

/**
 * The buildings whose name the text contains, longest name first so a short name does not
 * shadow the longer one it sits inside. Empty when nothing is named, or when the text names
 * more than one building — then the person must say which, and nothing is assumed.
 */
export function buildingsNamedIn(buildings: readonly NamedBuilding[], text: string): NamedBuilding[] {
  const haystack = normal(text);
  if (!haystack) return [];
  const hits = buildings.filter(building => {
    const name = normal(building.name);
    return name.length > 1 && haystack.includes(name);
  });
  return hits.filter(building => !hits.some(other =>
    other.id !== building.id && normal(other.name) !== normal(building.name) && normal(other.name).includes(normal(building.name))));
}

/**
 * The one building a note names, or nothing. `names` carries what was found when there was
 * more than one, so the dialog can say「你寫了兩幢大廈」rather than quietly ignoring them.
 */
export function namedBuilding(buildings: readonly NamedBuilding[], text: string): { building?: NamedBuilding; names: string[] } {
  const named = buildingsNamedIn(buildings, text);
  if (named.length === 1) return { building: named[0], names: [] };
  return { names: named.map(building => building.name) };
}
