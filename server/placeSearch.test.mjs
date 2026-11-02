import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALS_MAX_RESULTS, HA_CACHE_MS, PLACE_MAX_QUERY, PLACE_MAX_RESULTS, createPlaceSearch, parseAlsJson, parseAlsPayload, parseAlsXml, parseHaRows, placeSettings } from './placeSearch.mjs';

/*
 * The address lookup as it meets the rest of the server: what it sends, what it refuses, and
 * what it will not turn into a building. The fixtures below are shaped like an answer captured
 * from `https://www.als.gov.hk/lookup` on 2026-11-02 (docs/GEOCODING.md 3.1.2) — not like the
 * older shape the service was documented with. Only the captured one is real.
 */

const env = { PLACE_PROVIDER: 'als', ALS_ENDPOINT: 'https://als.example.org/lookup' };
const replied = (body, init = {}) => () => Promise.resolve(new Response(body, { status: 200, ...init }));

/** One premises: a block of 德朗邨, in the shape the live JSON answers in. */
const takYu = {
  Address: { PremisesAddress: {
    EngPremisesAddress: {
      EngBlock: { BlockDescriptor: 'BLK', BlockNo: '1', BlockDescriptorPrecedenceIndicator: 'Y' },
      BuildingName: 'TAK YU HOUSE',
      EngEstate: { EstateName: 'TAK LONG ESTATE' },
      EngStreet: { StreetName: 'SHING KAI ROAD', BuildingNoFrom: '28' },
      EngDistrict: { DcDistrict: 'KOWLOON CITY DISTRICT' },
      Region: 'KLN',
    },
    ChiPremisesAddress: {
      Region: '九龍',
      ChiDistrict: { DcDistrict: '九龍城區' },
      ChiStreet: { StreetName: '承啟道', BuildingNoFrom: '28' },
      ChiEstate: { EstateName: '德朗邨' },
      ChiBlock: { BlockDescriptor: '座', BlockNo: '1' },
      BuildingName: '德瑜樓',
    },
    GeoAddress: '3896321295T20131227',
    GeospatialInformation: { Northing: '821295', Easting: '838963', Latitude: '22.3307', Longitude: '114.20303' },
  } },
  ValidationInformation: { Score: 70.0 },
};

/** A second row for the same estate that names no building. */
const estateOnly = {
  Address: { PremisesAddress: {
    ChiPremisesAddress: {
      Region: '九龍',
      ChiDistrict: { DcDistrict: '九龍城區' },
      ChiStreet: { StreetName: '承啟道', BuildingNoFrom: '28' },
      ChiEstate: { EstateName: '德朗邨' },
    },
    GeospatialInformation: { Latitude: '22.32965', Longitude: '114.2036' },
  } },
  ValidationInformation: { Score: 66.44 },
};

const json = JSON.stringify({ RequestAddress: { AddressLine: ['德朗邨'] }, SuggestedAddress: [takYu, estateOnly] });

/** The same first row as XML, which is what a deployment that ignores `Accept` answers. */
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AddressLookupResult>
  <RequestAddress><AddressLine>德朗邨</AddressLine></RequestAddress>
  <SuggestedAddress>
    <Address><PremisesAddress>
      <EngPremisesAddress>
        <EngBlock><BlockDescriptor>BLK</BlockDescriptor><BlockNo>1</BlockNo></EngBlock>
        <BuildingName>TAK YU HOUSE</BuildingName>
        <EngEstate><EstateName>TAK LONG ESTATE</EstateName></EngEstate>
        <EngStreet><StreetName>SHING KAI ROAD</StreetName><BuildingNoFrom>28</BuildingNoFrom></EngStreet>
        <EngDistrict><DcDistrict>KOWLOON CITY DISTRICT</DcDistrict></EngDistrict>
        <Region>KLN</Region>
      </EngPremisesAddress>
      <ChiPremisesAddress>
        <Region>九龍</Region>
        <ChiDistrict><DcDistrict>九龍城區</DcDistrict></ChiDistrict>
        <ChiStreet><StreetName>承啟道</StreetName><BuildingNoFrom>28</BuildingNoFrom></ChiStreet>
        <ChiEstate><EstateName>德朗邨</EstateName></ChiEstate>
        <ChiBlock><BlockDescriptor>座</BlockDescriptor><BlockNo>1</BlockNo></ChiBlock>
        <BuildingName>德瑜樓</BuildingName>
      </ChiPremisesAddress>
      <GeoAddress>3896321295T20131227</GeoAddress>
      <GeospatialInformation><Latitude>22.3307</Latitude><Longitude>114.20303</Longitude></GeospatialInformation>
    </PremisesAddress></Address>
    <ValidationInformation><Score>70.00</Score></ValidationInformation>
  </SuggestedAddress>
</AddressLookupResult>`;

test('the lookup asks the configured endpoint with the words, a ceiling, and for JSON', async () => {
  let seen;
  const place = createPlaceSearch({ env, fetcher: (url, init) => { seen = { url: String(url), init }; return Promise.resolve(new Response(json, { status: 200 })); } });
  await place.search('德朗邨');
  const url = new URL(seen.url);
  assert.equal(url.origin + url.pathname, 'https://als.example.org/lookup');
  assert.equal(url.searchParams.get('q'), '德朗邨');
  assert.equal(url.searchParams.get('n'), String(ALS_MAX_RESULTS));
  // JSON is asked for rather than the XML the service documents; the same answer, no XML reader.
  assert.equal(seen.init.headers.Accept, 'application/json');
});

test('no key is sent when none is configured', async () => {
  let seen;
  const place = createPlaceSearch({ env, fetcher: (url, init) => { seen = { url: String(url), init }; return Promise.resolve(new Response(json, { status: 200 })); } });
  await place.search('德朗邨');
  assert.equal(seen.init.headers.Authorization, undefined);
});

test('a configured key goes in a header, never in the query string', async () => {
  let seen;
  const place = createPlaceSearch({ env: { ...env, ALS_API_KEY: 'secret-key' }, fetcher: (url, init) => { seen = { url: String(url), init }; return Promise.resolve(new Response(json, { status: 200 })); } });
  await place.search('德朗邨');
  assert.equal(seen.init.headers.Authorization, 'Bearer secret-key');
  assert.ok(!seen.url.includes('secret-key'), '金鑰不得出現在網址');
});

test('a block keeps its building name, its estate, and its block number', async () => {
  const { places } = await createPlaceSearch({ env, fetcher: replied(json) }).search('德朗邨');
  assert.deepEqual(places[0], {
    id: 'als-3896321295T20131227',
    name: '德瑜樓',
    address: '九龍 · 九龍城區 · 德朗邨 · 1座 · 承啟道 28',
    lng: 114.20303,
    lat: 22.3307,
  });
});

test('a premises with no building name falls back to its estate, not to a blank', async () => {
  const { places } = await createPlaceSearch({ env, fetcher: replied(json) }).search('德朗邨');
  assert.equal(places[1].name, '德朗邨');
  assert.equal(places[1].address, '九龍 · 九龍城區 · 承啟道 28');
});

test('a row with no Chinese block still gets a name and an address', () => {
  const english = parseAlsJson({ RequestAddress: {}, SuggestedAddress: [{ Address: { PremisesAddress: {
    EngPremisesAddress: { BuildingName: 'PATERSON BUILDING', EngStreet: { StreetName: 'PATERSON STREET', BuildingNoFrom: '37' }, EngDistrict: { DcDistrict: 'WAN CHAI DISTRICT' }, Region: 'HK' },
    GeospatialInformation: { Latitude: '22.28095', Longitude: '114.18525' },
  } } }] });
  assert.equal(english[0].name, 'PATERSON BUILDING');
  assert.equal(english[0].address, 'HK · WAN CHAI DISTRICT · PATERSON STREET 37');
});

test('the XML answer reads the same as the JSON one', () => {
  assert.deepEqual(parseAlsXml(xml), parseAlsPayload(xml));
  assert.equal(parseAlsXml(xml)[0].name, '德瑜樓');
  assert.equal(parseAlsXml(xml)[0].address, '九龍 · 九龍城區 · 德朗邨 · 1座 · 承啟道 28');
  assert.equal(parseAlsXml(xml)[0].lng, 114.20303);
});

test('a place outside Hong Kong is dropped', () => {
  const out = parseAlsJson({ RequestAddress: {}, SuggestedAddress: [{ Address: { PremisesAddress: {
    ChiPremisesAddress: { BuildingName: '同名大廈', Region: '廣州' },
    GeospatialInformation: { Latitude: '23.13', Longitude: '113.26' },
  } } }] });
  assert.deepEqual(out, []);
});

test('a place with no position is dropped rather than placed at zero', () => {
  const out = parseAlsJson({ RequestAddress: {}, SuggestedAddress: [{ Address: { PremisesAddress: {
    ChiPremisesAddress: { BuildingName: '無座標大廈' },
  } } }] });
  assert.deepEqual(out, []);
  // `Number('')` is 0: a blank coordinate must not become a point at 0,0 either.
  const blank = parseAlsJson({ RequestAddress: {}, SuggestedAddress: [{ Address: { PremisesAddress: {
    ChiPremisesAddress: { BuildingName: '空白座標大廈' },
    GeospatialInformation: { Latitude: '', Longitude: '' },
  } } }] });
  assert.deepEqual(blank, []);
});

test('an address the service cannot find is an empty list, not a format error', async () => {
  // The live service echoes the request back with no `SuggestedAddress` key at all.
  const empty = JSON.stringify({ RequestAddress: { AddressLine: ['不存在的地方'] } });
  assert.deepEqual(await createPlaceSearch({ env, fetcher: replied(empty) }).search('不存在的地方'), { places: [] });
  assert.deepEqual(parseAlsPayload('<?xml version="1.0"?><AddressLookupResult><RequestAddress><AddressLine>x</AddressLine></RequestAddress></AddressLookupResult>'), []);
});

test('a blank body is a failure, not "no such building"', async () => {
  const place = createPlaceSearch({ env, fetcher: replied('') });
  await assert.rejects(place.search('德朗邨'), error => error.status === 502 && /格式未能識別/.test(error.message));
});

test('a body this server cannot read is refused rather than called "no results"', async () => {
  const place = createPlaceSearch({ env, fetcher: replied('<html><body>404</body></html>') });
  await assert.rejects(place.search('德朗邨'), error => error.status === 502 && /格式未能識別/.test(error.message));
  assert.equal(parseAlsPayload('{"unexpected":true}'), undefined);
});

test('the same building at the same point is offered once', async () => {
  const twice = JSON.stringify({ RequestAddress: {}, SuggestedAddress: [takYu, takYu] });
  const { places } = await createPlaceSearch({ env, fetcher: replied(twice) }).search('德朗邨');
  assert.equal(places.length, 1);
});

test('a query shorter than two characters or longer than the limit is refused', async () => {
  const place = createPlaceSearch({ env, fetcher: replied(json) });
  await assert.rejects(place.search('樓'), /至少兩個字/);
  await assert.rejects(place.search('樓'.repeat(PLACE_MAX_QUERY + 1)), /不可超過/);
});

test('an unreachable service is reported as unreachable, not as nothing found', async () => {
  const place = createPlaceSearch({ env, fetcher: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) });
  await assert.rejects(place.search('德朗邨'), error => error.status === 502 && /未能連接地址服務/.test(error.message));
});

test('a timeout says so rather than hanging or pretending to be empty', async () => {
  const place = createPlaceSearch({ env, fetcher: () => Promise.reject(new Error('The operation was aborted due to timeout')) });
  await assert.rejects(place.search('德朗邨'), error => error.status === 502 && /逾時/.test(error.message));
});

test('a refusal from the service is reported as itself', async () => {
  const place = createPlaceSearch({ env, fetcher: () => Promise.resolve(new Response('nope', { status: 503 })) });
  await assert.rejects(place.search('德朗邨'), error => error.status === 502 && error.message.includes('503'));
});

test('the list is cut at the ceiling the panel shows', async () => {
  const many = Array.from({ length: PLACE_MAX_RESULTS + 5 }, (_, index) => ({ Address: { PremisesAddress: {
    ChiPremisesAddress: { BuildingName: `大廈${index}`, Region: '香港' },
    GeospatialInformation: { Latitude: '22.28', Longitude: `114.${140 + index}` },
  } } }));
  const { places } = await createPlaceSearch({ env, fetcher: replied(JSON.stringify({ RequestAddress: {}, SuggestedAddress: many })) }).search('大廈');
  assert.equal(places.length, PLACE_MAX_RESULTS);
});

test('the Google slot is visibly unimplemented rather than silently empty', async () => {
  const place = createPlaceSearch({ env: { ...env, PLACE_PROVIDER: 'google' }, fetcher: replied(json) });
  await assert.rejects(place.search('德朗邨'), error => error.status === 501 && /Google/.test(error.message));
});

test('an unknown provider is refused rather than guessed at', async () => {
  const place = createPlaceSearch({ env: { ...env, PLACE_PROVIDER: 'nominatim' }, fetcher: replied(json) });
  await assert.rejects(place.search('德朗邨'), error => error.status === 503);
});

test('a loopback endpoint is allowed so the mock can stand in for the real service', () => {
  assert.equal(placeSettings({ PLACE_PROVIDER: 'als', ALS_ENDPOINT: 'http://127.0.0.1:5199/lookup' }).configured, true);
  assert.equal(placeSettings({ PLACE_PROVIDER: 'als', ALS_ENDPOINT: 'http://localhost:5199/lookup' }).configured, true);
  // Only loopback: plain HTTP to anywhere else is refused like any other unencrypted endpoint.
  assert.equal(placeSettings({ PLACE_PROVIDER: 'als', ALS_ENDPOINT: 'http://als.example.org/lookup' }).configured, false);
  assert.equal(placeSettings({ PLACE_PROVIDER: 'als', ALS_ENDPOINT: 'http://127.0.0.1.evil.test/lookup' }).configured, false);
});

test('an endpoint that is not an https URL is not put to work', async () => {
  const place = createPlaceSearch({ env: { PLACE_PROVIDER: 'als', ALS_ENDPOINT: 'not a url' }, fetcher: replied(json) });
  await assert.rejects(place.search('德朗邨'), error => error.status === 503);
  assert.equal(placeSettings({ PLACE_PROVIDER: 'als', ALS_ENDPOINT: 'not a url' }).configured, false);
  assert.equal(placeSettings({ PLACE_PROVIDER: 'als', ALS_ENDPOINT: 'http://als.example.org/lookup' }).configured, false);
  assert.equal(placeSettings({ PLACE_PROVIDER: 'als', ALS_ENDPOINT: 'https://user:pass@als.example.org/lookup' }).configured, false);
});

test('markup in the answer is decoded into text, not carried into the panel', () => {
  const escaped = '<AddressLookupResult><SuggestedAddress><Address><PremisesAddress><ChiPremisesAddress><BuildingName>福滿大廈 &amp; 車房</BuildingName></ChiPremisesAddress><GeospatialInformation><Latitude>22.2867</Latitude><Longitude>114.1422</Longitude></GeospatialInformation></PremisesAddress></Address></SuggestedAddress></AddressLookupResult>';
  assert.equal(parseAlsXml(escaped)[0].name, '福滿大廈 & 車房');
});


/*
 * The Housing Authority estate list (`docs/ha_hahdweb_dataspec.pdf`). Unlike ALS it is not a
 * search: it answers with the whole list, so everything here is about reading that list
 * correctly and matching the words against it — including the ways the live service departs
 * from its own specification, which were measured against the running endpoint on 2026-11-01.
 */

const haEnv = { PLACE_PROVIDER: 'ha', HA_BASE: 'https://ha.example.org/psi/rest/criteriafilter' };

/** `prh-estates` answers in PascalCase … */
const prhTc = JSON.stringify({ data: [
  { Estate_Name: '德朗邨', District_Name: '九龍城', Region_Name: '九龍', Map_Latitude: '22.330105', Map_Longitude: '114.2031' },
  { Estate_Name: '啟晴邨', District_Name: '九龍城', Region_Name: '九龍', Map_Latitude: '22.33254', Map_Longitude: '114.20292' },
  { Estate_Name: '嘉田苑\u3000\u3000', District_Name: '沙田', Region_Name: '新界', Map_Latitude: '22.3801', Map_Longitude: '114.1902' },
] });
const prhEn = JSON.stringify({ data: [
  { Estate_Name: 'Tak Long Estate', District_Name: 'Kowloon City', Region_Name: 'Kowloon', Map_Latitude: '22.330105', Map_Longitude: '114.2031' },
  { Estate_Name: 'Kai Ching Estate', District_Name: 'Kowloon City', Region_Name: 'Kowloon', Map_Latitude: '22.33254', Map_Longitude: '114.20292' },
  { Estate_Name: 'Ka Tin Court', District_Name: 'Sha Tin', Region_Name: 'New Territories', Map_Latitude: '22.3801', Map_Longitude: '114.1902' },
] });
/** … and `hos-courts` answers in snake_case, which the specification does not show. */
const hosTc = JSON.stringify({ data: [
  { estate_name: '德雅苑', district_name: '大埔', region_name: '新界', map_latitude: '22.44446', map_longitude: '114.16782' },
] });

/** Answers the four URLs a search makes, by resource and language. */
const haFetcher = (seen = []) => url => {
  seen.push(String(url));
  const path = String(url).replace(haEnv.HA_BASE, '');
  const body = path === '/prh-estates/tc/json' ? prhTc
    : path === '/prh-estates/en/json' ? prhEn
      : path === '/hos-courts/tc/json' ? hosTc
        : JSON.stringify({ data: [] });
  return Promise.resolve(new Response(body, { status: 200 }));
};

test('the estate list reads both spellings the service uses for the same field', () => {
  const pascal = parseHaRows(prhTc);
  assert.equal(pascal[0].name, '德朗邨');
  assert.equal(pascal[0].district, '九龍城');
  assert.equal(pascal[0].lng, 114.2031);
  const snake = parseHaRows(hosTc);
  assert.equal(snake[0].name, '德雅苑');
  assert.equal(snake[0].region, '新界');
});

test('trailing ideographic spaces are not part of a name', () => {
  // The live list really does answer 「嘉田苑」 followed by two U+3000 ideographic spaces, which
  // would never match a typed 「嘉田苑」 — see the fixture above.
  assert.equal(parseHaRows(prhTc)[2].name, '嘉田苑');
});

test('a search finds a Chinese name, a partial name, and the English name of the same place', async () => {
  const place = createPlaceSearch({ env: haEnv, fetcher: haFetcher() });
  assert.deepEqual((await place.search('德朗邨')).places.map(p => p.name), ['德朗邨']);
  assert.deepEqual((await place.search('啟晴')).places.map(p => p.name), ['啟晴邨']);
  assert.deepEqual((await place.search('Tak Long')).places.map(p => p.name), ['德朗邨']);
  assert.deepEqual((await place.search('kai ching')).places.map(p => p.name), ['啟晴邨']);
});

test('the words are matched against every configured resource', async () => {
  const seen = [];
  const place = createPlaceSearch({ env: haEnv, fetcher: haFetcher(seen) });
  assert.deepEqual((await place.search('德雅')).places.map(p => p.name), ['德雅苑'], '居屋名冊也要查');
  assert.deepEqual([...new Set(seen.map(url => new URL(url).pathname.split('/').at(-3)))].sort(), ['hos-courts', 'prh-estates']);
});

test('a place carries the district the source knows, and nothing invented', async () => {
  const { places } = await createPlaceSearch({ env: haEnv, fetcher: haFetcher() }).search('德朗');
  assert.equal(places[0].address, '九龍 · 九龍城');
  assert.equal(places[0].lng, 114.2031);
});

test('the whole list is fetched once and then answered from memory', async () => {
  let calls = 0;
  const fetcher = url => { calls++; return haFetcher()(url); };
  const place = createPlaceSearch({ env: haEnv, fetcher });
  await place.search('德朗');
  const after = calls;
  await place.search('啟晴');
  await place.search('德雅');
  assert.equal(calls, after, '第二次起不應再問服務');
  assert.equal(after, 4, '兩個資源、兩種語言，各一次');
});

test('a list older than a day is fetched again', async () => {
  let clock = 0, calls = 0;
  const fetcher = url => { calls++; return haFetcher()(url); };
  const place = createPlaceSearch({ env: haEnv, fetcher, now: () => clock });
  await place.search('德朗');
  assert.equal(calls, 4);
  clock += HA_CACHE_MS - 1;
  await place.search('德朗');
  assert.equal(calls, 4, '未過期');
  clock += 2;
  await place.search('德朗');
  assert.equal(calls, 8, '過期後重取');
});

test('two searches that arrive together share one fetch', async () => {
  let calls = 0;
  const fetcher = url => { calls++; return haFetcher()(url); };
  const place = createPlaceSearch({ env: haEnv, fetcher });
  await Promise.all([place.search('德朗'), place.search('啟晴')]);
  assert.equal(calls, 4);
});

test('an empty body is a failure, not "this estate does not exist"', async () => {
  // The live service answers an unknown resource or language with HTTP 200 and no content,
  // although its specification promises 400. Read as "no results" it would hide a bad setting.
  const place = createPlaceSearch({ env: haEnv, fetcher: () => Promise.resolve(new Response('', { status: 200 })) });
  await assert.rejects(place.search('德朗'), error => error.status === 502 && /格式未能識別/.test(error.message));
});

test('a body whose type is not what the header claims is judged by the body', async () => {
  // Every format suffix answers `Content-Type: application/json`, including the XML one.
  const html = () => Promise.resolve(new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(createPlaceSearch({ env: haEnv, fetcher: html }).search('德朗'), error => error.status === 502);
});

test('an estate outside Hong Kong is dropped', () => {
  const row = { estate_name: '遠方邨', map_latitude: '23.13', map_longitude: '113.26' };
  assert.deepEqual(parseHaRows(JSON.stringify({ data: [row] })), []);
});

test('an estate with no position is dropped rather than placed at zero', () => {
  const row = { estate_name: '無座標邨', map_latitude: '', map_longitude: '' };
  assert.deepEqual(parseHaRows(JSON.stringify({ data: [row] })), []);
});

test('a failing English fetch still leaves the Chinese names searchable', async () => {
  const fetcher = url => String(url).endsWith('/en/json')
    ? Promise.reject(new Error('getaddrinfo ENOTFOUND'))
    : Promise.resolve(new Response(prhTc, { status: 200 }));
  const { places } = await createPlaceSearch({ env: haEnv, fetcher }).search('德朗');
  assert.deepEqual(places.map(p => p.name), ['德朗邨']);
});

test('a failing Chinese fetch is reported, not answered with an empty list', async () => {
  const fetcher = url => String(url).endsWith('/tc/json')
    ? Promise.reject(new Error('getaddrinfo ENOTFOUND'))
    : Promise.resolve(new Response(prhEn, { status: 200 }));
  await assert.rejects(createPlaceSearch({ env: haEnv, fetcher }).search('德朗'), error => error.status === 502 && /未能連接地址服務/.test(error.message));
});

test('only the resources the environment asks for are fetched', async () => {
  const seen = [];
  const place = createPlaceSearch({ env: { ...haEnv, HA_RESOURCES: 'hos-courts' }, fetcher: haFetcher(seen) });
  await place.search('德雅');
  assert.deepEqual([...new Set(seen.map(url => new URL(url).pathname.split('/').at(-3)))], ['hos-courts']);
});

test('an unknown resource name in the environment is ignored rather than asked for', () => {
  assert.deepEqual(placeSettings({ HA_RESOURCES: 'prh-estates,nope' }).resources, ['prh-estates']);
  assert.deepEqual(placeSettings({ HA_RESOURCES: '' }).resources, ['prh-estates', 'hos-courts']);
});

test('the address lookup is the default source and the estate list is opt-in', () => {
  // ALS covers private buildings too; the Housing Authority list only public housing.
  assert.equal(placeSettings({}).provider, 'als');
  assert.equal(placeSettings({}).configured, true);
  assert.equal(placeSettings({ PLACE_PROVIDER: 'ha', HA_BASE: 'http://ha.example.org' }).configured, false, '明文 HTTP 不接受');
});

test('a search that matches nothing says so plainly', async () => {
  assert.deepEqual(await createPlaceSearch({ env: haEnv, fetcher: haFetcher() }).search('不存在的地方'), { places: [] });
});

test('results are cut at the ceiling the panel shows', async () => {
  const many = { data: Array.from({ length: 20 }, (_, index) => ({ estate_name: `測試邨${index}`, map_latitude: '22.3', map_longitude: String(114 + index / 1000) })) };
  const fetcher = () => Promise.resolve(new Response(JSON.stringify(many), { status: 200 }));
  assert.equal((await createPlaceSearch({ env: { ...haEnv, HA_RESOURCES: 'prh-estates' }, fetcher }).search('測試')).places.length, PLACE_MAX_RESULTS);
});
