#!/usr/bin/env node
import { createServer } from 'node:http';

/**
 * A stand-in for the government address lookup, so the search path can be walked end to end
 * without pointing a test machine at the live service (`docs/GEOCODING.md` 3.1.2).
 *
 *   node scripts/als-mock.mjs            # http://127.0.0.1:5199/lookup
 *
 * Then, in `.env`:
 *
 *   PLACE_PROVIDER=als
 *   ALS_ENDPOINT=http://127.0.0.1:5199/lookup
 *
 * The server refuses a non-HTTPS endpoint unless it is a loopback address, so this is the one
 * place a plain-HTTP endpoint is allowed. Everything it returns is invented; it must never be
 * pointed at a deployment that holds real records.
 *
 * The answer copies the shape captured from `www.als.gov.hk` on 2026-11-02: a root
 * `AddressLookupResult` with one `SuggestedAddress` per premises, both languages, and the
 * position under `GeospatialInformation`. JSON is served when the caller asks for it (the
 * server does); XML otherwise, so the fallback reader can be exercised too.
 */

const PORT = Number(process.argv[2] || process.env.ALS_MOCK_PORT || 5199);

/**
 * Invented premises, inside the Hong Kong box the real answer would fall in. Two of them share
 * a name and a street and differ only by door number, which is what the server's number check
 * has to tell apart; one is a near miss, which the typo tolerance has to keep out when an exact
 * answer exists.
 */
const PLACES = [
  { id: 'MOCK-1', name: '示範大廈', en: 'DEMO BUILDING', street: '示範街', enStreet: 'DEMO STREET', no: '3', district: '中西區', enDistrict: 'CENTRAL AND WESTERN DISTRICT', region: '香港', enRegion: 'HK', lng: 114.1422, lat: 22.2867 },
  { id: 'MOCK-2', name: '示範大廈', en: 'DEMO BUILDING', street: '示範街', enStreet: 'DEMO STREET', no: '5', district: '中西區', enDistrict: 'CENTRAL AND WESTERN DISTRICT', region: '香港', enRegion: 'HK', lng: 114.1424, lat: 22.2869 },
  { id: 'MOCK-3', name: '富滿大廈', en: 'FU MUN BUILDING', street: '示範街', enStreet: 'DEMO STREET', no: '7', district: '中西區', enDistrict: 'CENTRAL AND WESTERN DISTRICT', region: '香港', enRegion: 'HK', lng: 114.1426, lat: 22.2871 },
  { id: 'MOCK-4', name: '測試中心', en: 'TEST CENTRE', street: '測試道', enStreet: 'TEST ROAD', no: '8', district: '油尖旺區', enDistrict: 'YAU TSIM MONG DISTRICT', region: '九龍', enRegion: 'KLN', lng: 114.1401, lat: 22.2881 },
];

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const premises = place => ({
  Address: { PremisesAddress: {
    EngPremisesAddress: {
      BuildingName: place.en,
      EngStreet: { StreetName: place.enStreet, BuildingNoFrom: place.no },
      EngDistrict: { DcDistrict: place.enDistrict },
      Region: place.enRegion,
    },
    ChiPremisesAddress: {
      Region: place.region,
      ChiDistrict: { DcDistrict: place.district },
      ChiStreet: { StreetName: place.street, BuildingNoFrom: place.no },
      BuildingName: place.name,
    },
    GeoAddress: place.id,
    GeospatialInformation: { Latitude: String(place.lat), Longitude: String(place.lng) },
  } },
  ValidationInformation: { Score: 70.0 },
});

const asJson = (query, found) => JSON.stringify({
  RequestAddress: { AddressLine: [query] },
  // The live service omits the key entirely when it finds nothing; copied rather than tidied.
  ...(found.length ? { SuggestedAddress: found.map(premises) } : {}),
});

const asXml = (query, found) => `<?xml version="1.0" encoding="UTF-8"?>
<AddressLookupResult>
  <RequestAddress><AddressLine>${esc(query)}</AddressLine></RequestAddress>
${found.map(place => `  <SuggestedAddress><Address><PremisesAddress>
    <EngPremisesAddress>
      <BuildingName>${esc(place.en)}</BuildingName>
      <EngStreet><StreetName>${esc(place.enStreet)}</StreetName><BuildingNoFrom>${esc(place.no)}</BuildingNoFrom></EngStreet>
      <EngDistrict><DcDistrict>${esc(place.enDistrict)}</DcDistrict></EngDistrict>
      <Region>${esc(place.enRegion)}</Region>
    </EngPremisesAddress>
    <ChiPremisesAddress>
      <Region>${esc(place.region)}</Region>
      <ChiDistrict><DcDistrict>${esc(place.district)}</DcDistrict></ChiDistrict>
      <ChiStreet><StreetName>${esc(place.street)}</StreetName><BuildingNoFrom>${esc(place.no)}</BuildingNoFrom></ChiStreet>
      <BuildingName>${esc(place.name)}</BuildingName>
    </ChiPremisesAddress>
    <GeoAddress>${esc(place.id)}</GeoAddress>
    <GeospatialInformation><Latitude>${place.lat}</Latitude><Longitude>${place.lng}</Longitude></GeospatialInformation>
  </PremisesAddress></Address></SuggestedAddress>`).join('\n')}
</AddressLookupResult>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/lookup') { res.writeHead(404).end('not found'); return; }
  const query = (url.searchParams.get('q') || '').trim();
  const lower = query.toLowerCase();
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('n') || 8)));
  const wantsJson = String(req.headers.accept || '').includes('application/json');
  const reply = (status, found, type = wantsJson ? 'application/json; charset=utf-8' : 'application/xml; charset=utf-8') =>
    res.writeHead(status, { 'content-type': type, ...(status === 200 ? {} : {}) })
      .end(status === 200 ? (wantsJson ? asJson(query, found) : asXml(query, found)) : 'mock upstream failure');
  // Three failure modes worth walking by hand, each one a different message in the panel.
  if (lower.includes('失敗') || lower.includes('fail')) { res.writeHead(500).end('mock upstream failure'); return; }
  if (lower.includes('慢') || lower.includes('slow')) { setTimeout(() => reply(200, []), 15_000); return; }
  if (lower.includes('壞') || lower.includes('garbage')) { res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>not an address answer</body></html>'); return; }
  // Like the real service, this answers with the nearest premises whether or not they are what
  // was asked for; deciding relevance is the server's job, and that is what the mock is here to
  // exercise. Nothing is invented per query, so the same rows come back for any words.
  reply(200, lower.length < 2 ? [] : PLACES.slice(0, limit));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ALS mock on http://127.0.0.1:${PORT}/lookup  (再在 .env 設 PLACE_PROVIDER=als、ALS_ENDPOINT=http://127.0.0.1:${PORT}/lookup)`);
  console.log('  q=示範大廈 → 示範街 3、5 號；q=示範街3號 → 只回 3 號；q=示範大樓 → 打錯一個字仍有結果；其他 → 空結果');
  console.log('  q=失敗 → HTTP 500；q=慢 → 15 秒後才回；q=壞 → 不是地址回應');
});
