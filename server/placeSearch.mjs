import { HttpError, requireValue } from './auth.mjs';

/**
 * Building-name search for the add-building panel (`docs/GEOCODING.md`).
 *
 * The browser never calls a geocoder itself: the query goes to this server, which decides
 * where it is asked, how long it may take, and how often. That is the same rule as every
 * other feature that sends data somewhere new (CLAUDE.md §6) — the switch is enforced here,
 * not by hiding a box — and it also keeps a key out of the page if one is ever needed.
 *
 * Two sources, chosen by `PLACE_PROVIDER`:
 *
 * - `als` (default) — the government's address lookup, `https://www.als.gov.hk/lookup`.
 *   Verified live on 2026-11-02: no key, `q` for the words and `n` for the ceiling, and
 *   `Accept: application/json` returns the same answer as the documented XML without needing
 *   an XML reader in this server. Each row is a **premises** — a block, a building, a shop —
 *   which is exactly what the panel adds, and it covers private buildings, not just public
 *   housing. The shape it actually returns is written up in docs/GEOCODING.md 3.1.2.
 * - `ha` — the Housing Authority's estate list (`docs/ha_hahdweb_dataspec.pdf`), covering
 *   public housing only. Nothing is sent but the fetch itself: the service has no query
 *   parameter, so the list is held for a day and the words are matched here.
 *
 * Whichever is in use, an unreachable or unrecognised answer is a `502` with a readable
 * reason — never an empty list dressed up as "no such building".
 */

/** A query is a building name, not a paragraph; the longest 大廈 name in Hong Kong is well under this. */
export const PLACE_MAX_QUERY = 80;
export const PLACE_MAX_RESULTS = 8;
export const PLACE_TIMEOUT_MS = 8_000;

/**
 * Where the address lookup lives. The host that answers today is `www.als.gov.hk`; the older
 * `www.als.ogcio.gov.hk` does not resolve (docs/GEOCODING.md 3.1.1).
 */
export const DEFAULT_ALS_ENDPOINT = 'https://www.als.gov.hk/lookup';

/**
 * How many rows to ask the service for. It answers with premises, not buildings — one estate
 * comes back as one row per block — and the same building can appear twice at one position,
 * so ask for more than are shown and let the dedupe below bring it down to `PLACE_MAX_RESULTS`.
 * The service caps an unqualified query at 200 rows; 24 is a page, not a dump.
 */
export const ALS_MAX_RESULTS = PLACE_MAX_RESULTS * 3;

/**
 * The Housing Authority's estate list (`docs/ha_hahdweb_dataspec.pdf`). A different service
 * from ALS with a different shape: it answers with **the whole list**, not with a search
 * result, so the words are matched here rather than upstream. It needs no key, and unlike ALS
 * it resolves and answers today — which is why it is the default source.
 */
export const HA_BASE = 'https://data.housingauthority.gov.hk/psi/rest/criteriafilter';
/** Every resource the service offers; only the residential ones are searched by default. */
export const HA_RESOURCES = ['prh-estates', 'hos-courts', 'shopping-centres', 'flatted-factory'];
export const HA_DEFAULT_RESOURCES = ['prh-estates', 'hos-courts'];
/**
 * The whole list is ~300 kB per language per resource, and the service says
 * `Cache-Control: no-cache`. Asking it on every keystroke would be rude and slow, so the
 * list is held here and refetched once a day — the portal updates "as and when there are
 * new entries", not by the minute.
 */
export const HA_CACHE_MS = 24 * 60 * 60 * 1000;
/** A whole list takes longer than a single lookup. */
export const HA_TIMEOUT_MS = 15_000;

/** HTTPS, or plain HTTP only to this machine — which is how `scripts/als-mock.mjs` stands in. */
function usable(endpoint) {
  try {
    const url = new URL(endpoint);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost';
    return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) && !url.username && !url.password;
  } catch { return false; /* an endpoint that is not a URL cannot be asked anything */ }
}

/**
 * `configured` is about the endpoint only: a key is accepted when the environment has one,
 * but its absence is not treated as "cannot search". The live check on 2026-11-02 confirmed
 * ALS answers without one, and the Housing Authority's specification says 「Requires
 * authentication: No」, so the same rule fits both.
 */
export function placeSettings(env = process.env) {
  // `als` by default: it covers private buildings as well as public housing (GEOCODING.md 3.1).
  const provider = (env.PLACE_PROVIDER || 'als').trim();
  const endpoint = (env.ALS_ENDPOINT || DEFAULT_ALS_ENDPOINT).trim();
  const key = (env.ALS_API_KEY || '').trim();
  const base = (env.HA_BASE || HA_BASE).trim();
  const asked = (env.HA_RESOURCES || '').split(',').map(item => item.trim()).filter(Boolean);
  const resources = asked.length ? asked.filter(item => HA_RESOURCES.includes(item)) : HA_DEFAULT_RESOURCES;
  const configured = provider === 'ha' ? usable(base) : usable(endpoint);
  return { provider, endpoint, key, base, resources, configured };
}

const decode = text => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&amp;/g, '&').trim();

const textOf = (block, tag) => {
  const found = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return found ? decode(found[1]) : '';
};
const allOf = (text, tag) => [...text.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map(match => decode(match[1]));

const finite = value => {
  // `Number('')` is 0, which would put a place with a blank coordinate off the coast of Africa;
  // a missing coordinate is missing, and the row is dropped rather than placed at zero.
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : undefined;
};

/** One result, or nothing: a place without a position cannot be shown as somewhere to go. */
function place(raw) {
  const lng = finite(raw.lng), lat = finite(raw.lat);
  if (lng === undefined || lat === undefined) return undefined;
  // Hong Kong only. A geocoder that answers with a same-named building in Guangzhou would
  // otherwise put a marker in the sea off the district.
  if (lng < 113.8 || lng > 114.5 || lat < 22.1 || lat > 22.6) return undefined;
  const address = String(raw.address ?? '').trim();
  const name = String(raw.name ?? '').trim() || address;
  if (!name) return undefined;
  return { id: String(raw.id ?? `${lng},${lat}`), name, address, lng, lat };
}

/** A field the service wrote as a string, or as a number (its JSON is not consistent). */
const valueOf = value => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};
const field = (row, key) => valueOf(row?.[key]);
const inner = (row, key) => (row && typeof row === 'object' ? row[key] : undefined);

/**
 * One premises row, in the terms the panel uses.
 *
 * The service answers with a premises — a block, a building, a shop — not with a district or
 * an estate centroid, and it names the same place twice in two languages. Chinese is what the
 * panel shows, so it is preferred; English stands in when a row has only that. The estate name
 * is kept in the address rather than the name, because 「德瑜樓」 alone does not say which
 * estate, and a worker standing at the wrong 德瑜樓 is a wasted visit.
 */
function alsPlace(raw) {
  // A street-only premises has no name of its own; the street and number are a name a person
  // can recognise, unlike the whole address repeated in the name column.
  const name = raw.chiName || raw.chiEstate || raw.engName || raw.engEstate
    || [raw.street, raw.number].filter(Boolean).join(' ');
  const address = [
    raw.region,
    raw.district,
    raw.location && raw.location !== raw.district ? raw.location : '',
    raw.chiEstate && raw.chiEstate !== name ? raw.chiEstate : '',
    raw.block,
    [raw.street, raw.number].filter(Boolean).join(' '),
  ].filter(Boolean).join(' · ');
  const built = place({ id: raw.geoAddress ? `als-${raw.geoAddress}` : `${raw.lng},${raw.lat}`, name, address, lng: raw.lng, lat: raw.lat });
  if (!built) return undefined;
  // Everything the answer says about the place, in both languages, for the relevance filter
  // below. The service always returns *some* nearest rows — 「不存在的地方」 comes back as a
  // hotel, a mansion and a factory — so the words have to appear in the answer, or the panel
  // would offer a person a building they did not ask for.
  const match = [
    raw.chiName, raw.engName, raw.chiEstate, raw.engEstate,
    raw.region, raw.engRegion, raw.district, raw.engDistrict,
    raw.location, raw.engLocation, raw.street, raw.engStreet, raw.block,
  ].filter(Boolean).join(' ');
  return { ...built, match };
}

/** 「1座」, or 「BLK 1」 when the row has no Chinese block; blank when it is not a blocked building. */
function alsBlock(chiNo, chiDescriptor, engNo) {
  if (chiNo) return `${chiNo}${chiDescriptor}`;
  return engNo ? `BLK ${engNo}` : '';
}

/**
 * The JSON answer (`Accept: application/json`). The root is `AddressLookupResult` in XML and
 * becomes `{ RequestAddress, SuggestedAddress }` here; an address the service cannot find
 * comes back as the echoed request **with no `SuggestedAddress` key at all**, which is an
 * empty answer and not a broken one. Anything that is not that shape is `undefined`, and the
 * caller answers 502 rather than showing a false 「找不到」.
 */
export function parseAlsJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const list = value.SuggestedAddress;
  if (!Array.isArray(list)) return 'RequestAddress' in value ? [] : undefined;
  return list.map(item => {
    const premises = inner(inner(item, 'Address'), 'PremisesAddress');
    if (!premises) return undefined;
    const chi = inner(premises, 'ChiPremisesAddress') ?? {};
    const eng = inner(premises, 'EngPremisesAddress') ?? {};
    const geo = inner(premises, 'GeospatialInformation') ?? {};
    return alsPlace({
      chiName: field(chi, 'BuildingName'),
      engName: field(eng, 'BuildingName'),
      chiEstate: field(inner(chi, 'ChiEstate'), 'EstateName'),
      engEstate: field(inner(eng, 'EngEstate'), 'EstateName'),
      region: field(chi, 'Region') || field(eng, 'Region'),
      engRegion: field(eng, 'Region'),
      district: field(inner(chi, 'ChiDistrict'), 'DcDistrict') || field(inner(eng, 'EngDistrict'), 'DcDistrict'),
      engDistrict: field(inner(eng, 'EngDistrict'), 'DcDistrict'),
      location: field(inner(chi, 'ChiStreet'), 'LocationName') || field(inner(eng, 'EngStreet'), 'LocationName'),
      engLocation: field(inner(eng, 'EngStreet'), 'LocationName'),
      street: field(inner(chi, 'ChiStreet'), 'StreetName') || field(inner(eng, 'EngStreet'), 'StreetName'),
      engStreet: field(inner(eng, 'EngStreet'), 'StreetName'),
      number: field(inner(chi, 'ChiStreet'), 'BuildingNoFrom') || field(inner(eng, 'EngStreet'), 'BuildingNoFrom'),
      block: alsBlock(
        field(inner(chi, 'ChiBlock'), 'BlockNo'), field(inner(chi, 'ChiBlock'), 'BlockDescriptor'),
        field(inner(eng, 'EngBlock'), 'BlockNo'),
      ),
      lng: field(geo, 'Longitude'),
      lat: field(geo, 'Latitude'),
      geoAddress: field(premises, 'GeoAddress'),
    });
  }).filter(Boolean);
}

/**
 * The same answer as XML, for a deployment that ignores `Accept`. Which block comes first
 * (`EngPremisesAddress` or `ChiPremisesAddress`) changes from row to row, so each language is
 * read inside its own block rather than by taking the first `<BuildingName>` in the row.
 */
export function parseAlsXml(text) {
  if (!/<AddressLookupResult\b/i.test(text)) return undefined;
  const one = (scope, tag) => (scope ? textOf(scope, tag) : '');
  return allOf(text, 'SuggestedAddress').map(block => {
    const chi = textOf(block, 'ChiPremisesAddress');
    const eng = textOf(block, 'EngPremisesAddress');
    const premises = textOf(block, 'PremisesAddress');
    return alsPlace({
      chiName: one(chi, 'BuildingName'),
      engName: one(eng, 'BuildingName'),
      chiEstate: one(chi, 'EstateName'),
      engEstate: one(eng, 'EstateName'),
      region: one(chi, 'Region') || one(eng, 'Region'),
      engRegion: one(eng, 'Region'),
      district: one(chi, 'DcDistrict') || one(eng, 'DcDistrict'),
      engDistrict: one(eng, 'DcDistrict'),
      location: one(chi, 'LocationName') || one(eng, 'LocationName'),
      engLocation: one(eng, 'LocationName'),
      street: one(chi, 'StreetName') || one(eng, 'StreetName'),
      engStreet: one(eng, 'StreetName'),
      number: one(chi, 'BuildingNoFrom') || one(eng, 'BuildingNoFrom'),
      block: alsBlock(
        one(textOf(chi, 'ChiBlock'), 'BlockNo'), one(textOf(chi, 'ChiBlock'), 'BlockDescriptor'),
        one(textOf(eng, 'EngBlock'), 'BlockNo'),
      ),
      lng: one(premises, 'Longitude'),
      lat: one(premises, 'Latitude'),
      geoAddress: one(premises, 'GeoAddress'),
    });
  }).filter(Boolean);
}

/** XML, JSON, or nothing this server is willing to read. */
export function parseAlsPayload(text) {
  const body = text.trim();
  // The service always writes a root element, even when it finds nothing. A blank body is a
  // proxy or an error page, not 「沒有這幢大廈」, so it is refused rather than read as empty.
  if (!body) return undefined;
  if (body.startsWith('<')) return parseAlsXml(body);
  if (body.startsWith('{')) {
    try { return parseAlsJson(JSON.parse(body)); } catch { return undefined; }
  }
  return undefined;
}

/** `https://…/lookup` with the two parameters the service takes: the words, and how many. */
function lookupUrl(endpoint, query) {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('n', String(ALS_MAX_RESULTS));
  return url;
}

/**
 * The provider registry. `google` is deliberately inert (2026-11-01): Google's terms forbid
 * keeping its names, addresses or coordinates in a non-Google map, and this workspace keeps
 * them for years (`docs/GEOCODING.md` 1). The slot stays so a licensed source can be dropped
 * in without touching the route, the switch or the panel.
 */
const providers = {
  google: () => { throw new HttpError(501, 'Google 地址搜尋未接入：條款不允許把它的名稱、地址和座標長期存進工作區，需先取得授權或改用其他服務。'); },
};

/**
 * One field of a Housing Authority row. The service is not consistent with itself:
 * `prh-estates` answers in `Estate_Name`, the other three in `estate_name`
 * (`docs/ha_hahdweb_dataspec.pdf` 2.1 shows the first, the live API the second), so both
 * spellings are read rather than betting on one.
 */
const snake = (row, name) => {
  if (!row || typeof row !== 'object') return '';
  const pascal = name.replace(/(^|_)([a-z])/g, (_, lead, letter) => `${lead}${letter.toUpperCase()}`);
  const value = row[pascal] ?? row[name];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};

/**
 * The estate list as the panel needs it. The specification's nested
 * `{en, zh-Hant, zh-Hans}` shape is what the data dictionary describes; the live service
 * answers one flat language per URL instead, so a row here carries the one language the
 * caller asked for and the two are joined afterwards.
 */
export function parseHaRows(text) {
  const body = text.trim();
  // A resource or language the service does not know comes back as **200 with an empty
  // body**, not as the 400 its specification promises. Read as "no results" that would be a
  // silent lie, so it is refused here and answered 502.
  if (!body) return undefined;
  let value;
  try { value = JSON.parse(body); } catch { return undefined; }
  const list = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : undefined;
  if (!list) return undefined;
  return list.map(row => {
    const lng = finite(snake(row, 'map_longitude'));
    const lat = finite(snake(row, 'map_latitude'));
    if (lng === undefined || lat === undefined) return undefined;
    // Out of the Hong Kong box is not ours to place; the same guard as every other source.
    if (lng < 113.8 || lng > 114.5 || lat < 22.1 || lat > 22.6) return undefined;
    const name = snake(row, 'estate_name').replace(/\s+/g, ' ');
    if (!name) return undefined;
    return { name, district: snake(row, 'district_name').replace(/\s+/g, ' '), region: snake(row, 'region_name').replace(/\s+/g, ' '), lng, lat };
  }).filter(Boolean);
}

/** Matching ignores case, width and every kind of space: the live list suffixes some names with U+3000. */
const fold = text => String(text ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/** The address a person sees: what the source knows, never a street number invented from it. */
const haAddress = row => [row.region, row.district].filter(Boolean).join(' · ');

/**
 * `search` takes the person's words and returns places, or throws `HttpError` with a reason
 * worth showing. Nothing is logged and nothing is written: the query and the answer live
 * only for the length of the request.
 */
export function createPlaceSearch({ fetcher = fetch, env = process.env, now = Date.now } = {}) {
  const settings = placeSettings(env);
  /** One entry per resource: the list, when it was fetched, and the fetch still in flight. */
  const lists = new Map();
  const loading = new Map();

  async function alsSearch(query, signal) {
    let response;
    try {
      response = await fetcher(lookupUrl(settings.endpoint, query), {
        // JSON rather than the XML the service documents: it is the same answer, and reading
        // it does not need a hand-written XML reader that breaks the first time a block nests.
        headers: { Accept: 'application/json', ...(settings.key ? { Authorization: `Bearer ${settings.key}` } : {}) },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(PLACE_TIMEOUT_MS)]) : AbortSignal.timeout(PLACE_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, /abort|timeout/i.test(message) ? '地址服務回應逾時，請再試一次。' : `未能連接地址服務（${message}）。`);
    }
    // A refusal from the service is reported as itself rather than folded into 「找不到」.
    if (!response.ok) throw new HttpError(502, `地址服務拒絕了這次查詢（HTTP ${response.status}）。`);

    let text;
    try { text = await response.text(); }
    catch { throw new HttpError(502, '地址服務的回應未能讀取。'); }
    const parsed = parseAlsPayload(text);
    if (parsed === undefined) throw new HttpError(502, '地址服務的回應格式未能識別，請聯絡平台管理員核對服務位址。');
    // The service answers with the nearest rows whether or not they are what was asked for, so
    // the words must appear somewhere in the answer (building, estate, street, district — either
    // language). Then one entry per name-and-place: the same building can come back twice at one
    // position, and a person picking a building does not need it listed twice.
    const wanted = fold(query);
    const seen = new Set();
    const kept = [];
    for (const item of parsed) {
      if (!fold(item.match).includes(wanted)) continue;
      const key = `${fold(item.name)}|${item.lng}|${item.lat}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push({ id: item.id, name: item.name, address: item.address, lng: item.lng, lat: item.lat });
    }
    return kept;
  }

  /** One resource, one language. */
  async function haRows(resource, lang) {
    const url = `${settings.base}/${resource}/${lang}/json`;
    let response;
    try {
      response = await fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(HA_TIMEOUT_MS) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, /abort|timeout/i.test(message) ? '地址服務回應逾時，請再試一次。' : `未能連接地址服務（${message}）。`);
    }
    if (!response.ok) throw new HttpError(502, `地址服務拒絕了這次查詢（HTTP ${response.status}）。`);
    let text;
    try { text = await response.text(); }
    catch { throw new HttpError(502, '地址服務的回應未能讀取。'); }
    const rows = parseHaRows(text);
    if (rows === undefined) throw new HttpError(502, '地址服務的回應格式未能識別，請聯絡平台管理員核對服務位址。');
    return rows;
  }

  /**
   * The resource's list, from the cache when it is fresh. The words are matched here because
   * the service has no query parameter: a request is the whole list or nothing.
   */
  async function haList(resource) {
    const held = lists.get(resource);
    if (held && now() - held.at < HA_CACHE_MS) return held.rows;
    const running = loading.get(resource);
    if (running) return running;
    const job = (async () => {
      // Traditional Chinese carries the name and the district that get shown; English is
      // fetched only so 「Tak Long Estate」 finds 德朗邨 too. If only the second fails the
      // search still works in Chinese, so that half is allowed to come back empty.
      const [tc, en] = await Promise.allSettled([haRows(resource, 'tc'), haRows(resource, 'en')]);
      if (tc.status === 'rejected') throw tc.reason;
      const english = en.status === 'fulfilled' ? en.value : [];
      // Joined on the position rather than the row number: today the two lists come back in
      // the same order, but that is not something the service promises.
      const byPoint = new Map(english.map(row => [`${row.lng},${row.lat}`, row.name]));
      return tc.value.map(row => ({ ...row, english: byPoint.get(`${row.lng},${row.lat}`) ?? '' }));
    })();
    loading.set(resource, job);
    try {
      const rows = await job;
      lists.set(resource, { at: now(), rows });
      return rows;
    } finally { loading.delete(resource); }
  }

  async function haSearch(query) {
    const groups = await Promise.all(settings.resources.map(haList));
    const wanted = fold(query);
    const seen = new Set();
    const hits = [];
    for (const row of groups.flat()) {
      const names = [row.name, row.english].filter(Boolean);
      if (!names.some(name => fold(name).includes(wanted))) continue;
      // A shopping centre can sit on its estate's coordinate; one entry per place is enough.
      const key = `${row.lng},${row.lat},${row.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ row, exact: names.some(name => fold(name).startsWith(wanted)) });
    }
    // Names that begin with the words first, then the shortest — 「德朗」 should offer 德朗邨
    // before anything that merely contains it.
    hits.sort((a, b) => Number(b.exact) - Number(a.exact) || a.row.name.length - b.row.name.length);
    return hits.map(({ row }, index) => ({
      id: `ha-${row.lng},${row.lat}-${index}`,
      name: row.name,
      address: haAddress(row),
      lng: row.lng,
      lat: row.lat,
    }));
  }

  async function search(rawQuery, signal) {
    const query = String(rawQuery ?? '').trim().replace(/\s+/g, ' ');
    requireValue(query.length >= 2, 400, '請輸入至少兩個字。');
    requireValue(query.length <= PLACE_MAX_QUERY, 400, `搜尋字串不可超過 ${PLACE_MAX_QUERY} 個字。`);
    const reserved = providers[settings.provider];
    if (reserved) reserved();
    if (settings.provider !== 'ha' && settings.provider !== 'als') throw new HttpError(503, '未設定地址搜尋服務。');
    requireValue(settings.configured, 503, '地址搜尋服務的位址設定不正確，請聯絡平台管理員。');
    const places = settings.provider === 'ha' ? await haSearch(query) : await alsSearch(query, signal);
    return { places: places.slice(0, PLACE_MAX_RESULTS) };
  }

  return { search, settings, status: () => ({ provider: settings.provider, configured: settings.configured, resources: settings.resources }) };
}
