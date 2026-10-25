/**
 * Where a person said a file belongs, read from what they typed beside it.
 *
 * A sheet is often filed under a building the rows never repeat, and sometimes under one
 * place in it: 「在裕安樓 5 樓 B 室」. That sentence is how the uploaded file gets a
 * building and a floor/unit — it is not a second record. The reading is literal and local,
 * not a model's guess (`CLAUDE.md` §4): a place is only returned when the person actually
 * wrote a floor and a unit, and when exactly one of each appears.
 *
 * Nothing here creates or validates a place against the workspace. The parser does that,
 * with the same rules a cell would go through: a place that is there is used, a missing one
 * is offered for creation only when it makes a row writable, and wording nobody can read is
 * refused rather than guessed.
 */
import { namedBuilding, type NamedBuilding } from './buildingMentions';

export interface MentionedPlace {
  /** The one building the text names, if the workspace has exactly one by that name. */
  building?: NamedBuilding;
  /**
   * The one floor and unit the text names, in the sheet's own short wording («5樓»,
   * «B室»). Only present when the text named exactly one place and one building.
   */
  place?: { floorLabel: string; unitLabel: string };
  /**
   * Places the text named but that were not applied because there was more than one.
   * The dialog says so rather than letting a row fall back to a whole-building record.
   */
  ambiguousPlaces?: string[];
}

const DIGITS: Record<string, number> = {
  一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 「五」「十五」「二十」— only the forms a floor number is actually written in. */
function chineseNumber(text: string): number | undefined {
  if (text === '十') return 10;
  if (!text.includes('十')) return text.length === 1 ? DIGITS[text] : undefined;
  const [tens, ones] = text.split('十');
  const ten = tens === '' ? 1 : DIGITS[tens];
  const one = ones === '' ? 0 : DIGITS[ones];
  return ten === undefined || one === undefined ? undefined : ten * 10 + one;
}

/** «5樓 B室», «5/F B室», «5 樓 B 室». The unit is required; a floor alone is not a place. */
const NUMERIC_PLACE = /(\d{1,3})\s*(?:樓|層|F|\/F)\s*([A-Za-z])\s*(\d{1,2})?\s*(?:室|房|號|單位)?/gi;
/** The same wording with a spoken floor number: «五樓 B室». */
const SPOKEN_PLACE = /([一二三四五六七八九十兩]{1,3})\s*(?:樓|層)\s*([A-Za-z])\s*(\d{1,2})?\s*(?:室|房|號|單位)?/g;

/**
 * Every place the text explicitly names, deduped by what it points at. A date is not a
 * place: the floor token has to be followed by 樓/層/F, so «5/10/2026» never matches.
 */
export function mentionedPlaces(text: string): { floorLabel: string; unitLabel: string }[] {
  const found = new Map<string, { floorLabel: string; unitLabel: string }>();
  const add = (floor: number, letter: string, room?: string) => {
    if (!Number.isInteger(floor) || floor < 1 || floor > 999) return;
    const unitLabel = `${letter.toUpperCase()}${room ?? ''}室`;
    found.set(`${floor}|${unitLabel}`, { floorLabel: `${floor}樓`, unitLabel });
  };
  for (const match of text.matchAll(NUMERIC_PLACE)) add(Number(match[1]), match[2], match[3]);
  for (const match of text.matchAll(SPOKEN_PLACE)) {
    const floor = chineseNumber(match[1]);
    if (floor !== undefined) add(floor, match[2], match[3]);
  }
  return [...found.values()];
}

/**
 * The building and place a note names, or nothing. A place is only returned with a
 * building: «5樓 B室» on its own does not say which building's 5樓, so nothing is assumed.
 */
export function mentionedPlace(buildings: readonly NamedBuilding[], text: string): MentionedPlace {
  const { building } = namedBuilding(buildings, text);
  if (!building) return {};
  const places = mentionedPlaces(text);
  if (places.length === 1) return { building, place: places[0] };
  if (places.length > 1) return { building, ambiguousPlaces: places.map(place => `${place.floorLabel} ${place.unitLabel}`) };
  return { building };
}
