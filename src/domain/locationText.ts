/** Closed, deterministic vocabulary. A count in a floor cell is not a room address. */
export interface StructureHint { unit: string; rooms?: number }
export type LocationText =
  | { ok: true; floor?: string; unit?: string; scope: 'BUILDING' | 'FLOOR' | 'UNIT'; structures: StructureHint[] }
  | { ok: false; reason: string };
const fail = (reason: string): LocationText => ({ ok: false, reason });
const digits: Record<string, number> = { '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
function chineseNumber(text: string): number | undefined {
  if (/^\d{1,3}$/.test(text)) return Number(text);
  if (text in digits) return digits[text];
  const m = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(text);
  return m ? (m[1] ? digits[m[1]] : 1) * 10 + (m[2] ? digits[m[2]] : 0) : undefined;
}
export function parseLocationText(raw: string, source: 'floor' | 'address' | 'unit' = 'floor', givenFloor?: string): LocationText {
  let text = raw.trim().toUpperCase().replace(/（/g, '(').replace(/）/g, ')');
  if (!text) return { ok: true, scope: 'BUILDING', structures: [] };
  if (/^(全幢|整幢|全棟|整棟)$/.test(text)) return { ok: true, scope: 'BUILDING', structures: [] };
  if (/後座|后座/.test(text)) return fail('「後座」未能對應到明確樓層／單位，請人手核對。');
  if (/\d\s*(?:F|樓)?\s*[-–—至]\s*\d\s*(?:F|樓)/.test(text)) return fail('這一行涵蓋多個樓層，請分開核對各層記錄，不會猜成其中一層。');
  if (/\d\s*FH(?:\s|$)/.test(text)) return fail('「FH」可能是樓層附註或 H 單位，請寫清楚。');
  let floor = givenFloor;
  const floorMatch = /^(G\s*\/\s*F|地下|[\d零一二兩三四五六七八九十]+\s*(?:\/\s*F|F|樓|層))/.exec(text);
  if (floorMatch) {
    const token = floorMatch[1].replace(/\s/g, '');
    const n = /^(G\/F|地下)$/.test(token) ? 0 : chineseNumber(token.replace(/(?:\/F|F|樓|層)$/, ''));
    if (n === undefined) return fail('樓層寫法未能確定，請人手核對。');
    const found = n === 0 ? '地下' : `${n}樓`;
    if (floor && parseLocationText(floor).ok && parseFloorNumber(floor) !== n) return fail('房間寫法與樓層欄的層數不同，請人手核對。');
    floor = found;
    text = text.slice(floorMatch[0].length).trim().replace(/^[-/]/, '').trim();
  } else if (source === 'floor' && /^\d{1,3}$/.test(text)) {
    return { ok: true, floor: `${Number(text)}樓`, scope: 'FLOOR', structures: [] };
  }
  // Explicit room paths include their floor, never a count of subdivisions.
  const path = /^(\d{1,3})-?([A-Z])-?(\d{1,2})$/.exec(text.replace(/\s/g, ''));
  if (path) {
    if (floor && parseFloorNumber(floor) !== Number(path[1])) return fail('房間寫法與樓層欄的層數不同，請人手核對。');
    return { ok: true, floor: `${Number(path[1])}樓`, unit: `${path[2]}${Number(path[3])}室`, scope: 'UNIT', structures: [] };
  }
  if (!text) return { ok: true, floor, scope: floor ? 'FLOOR' : 'BUILDING', structures: [] };
  const compact = text.replace(/\s/g, '');
  const room = /^([A-Z])(?:-(\d{1,2})|室(\d{1,2})號房|\((\d{1,2})\))$/.exec(compact);
  if (room) {
    const number = Number(room[2] ?? room[3] ?? room[4]);
    if (number < 1) return fail('房間編號必須大於零。');
    return { ok: true, floor, unit: `${room[1]}${number}室`, scope: 'UNIT', structures: [] };
  }
  if (source !== 'floor') {
    const unit = /^([A-Z])(\d{1,2})?(?:室|號|房)?$/.exec(compact);
    if (!unit) return fail('單位／房間寫法未能確定，請人手核對。');
    if (unit[2] && Number(unit[2]) < 1) return fail('房間編號必須大於零。');
    return { ok: true, floor, unit: `${unit[1]}${unit[2] ? Number(unit[2]) : ''}室`, scope: 'UNIT', structures: [] };
  }
  if (!floor) return fail('只有單位或房間，缺少樓層；請補樓層後核對。');
  const normal = /^([A-Z])(?:室)?$/.exec(compact);
  if (normal) return { ok: true, floor, unit: `${normal[1]}室`, scope: 'UNIT', structures: [] };
  // ABC, A4, A3 B C, AB2: letters are ordinary units, attached numbers are counts.
  if (!/^(?:[A-Z](?:\d{1,2})?)+$/.test(compact)) return fail('混合位置寫法未能確定，請人手拆開核對。');
  const structures: StructureHint[] = [];
  for (const token of compact.matchAll(/([A-Z])(\d{1,2})?/g)) {
    const rooms = token[2] ? Number(token[2]) : undefined;
    if (rooms !== undefined && (rooms < 1 || rooms > 40)) return fail('分間數目超出可核對範圍，請人手核對。');
    if (structures.some(item => item.unit === token[1])) return fail('同一單位重複出現，請人手核對。');
    structures.push({ unit: token[1], rooms });
  }
  return { ok: true, floor, scope: 'FLOOR', structures };
}
export function parseFloorNumber(text: string): number | undefined {
  const compact = text.trim().toUpperCase().replace(/\s/g, '');
  if (/^(地下|G\/F)$/.test(compact)) return 0;
  return chineseNumber(compact.replace(/(?:\/F|F|樓|層)$/, ''));
}
