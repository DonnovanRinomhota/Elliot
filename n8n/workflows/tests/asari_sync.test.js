// Tests for 0044: workflow 42 copies an agency's ASARI listings into Elliot.
// Plan Sync fetches only new and changed listings, Map Listings turns
// ASARI's fields into Elliot's, and Finish Sync gets the right counts on
// every path (ASARI error, nothing to fetch, after saving).
//
// Run: node n8n/workflows/tests/asari_sync.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '42-asari-sync.json'), 'utf8'));
const nodeOf = (name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node named ${name}`);
  return n;
};
const next = (name, branch = 0) => (wf.connections[name]?.main?.[branch] || []).map((x) => x.node);
function stubs(nodes) {
  return (name) => {
    if (!(name in nodes)) throw new Error(`node ${name} hasn't run`);
    const list = Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]];
    return { first: () => ({ json: list[0] }), all: () => list.map((j) => ({ json: j })) };
  };
}
function run(code, { items = [{}], nodes = {} } = {}) {
  const wrapped = items.map((json) => ({ json }));
  const $input = { first: () => wrapped[0], all: () => wrapped };
  return new Function('$input', '$', code)($input, stubs(nodes));
}
const expr = (value, { json = {}, nodes = {} } = {}) =>
  new Function('$json', '$', `return (${value.replace(/^=\{\{/, '').replace(/\}\}$/, '')});`)(json, stubs(nodes));

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const agency = { tenant_id: 't1', api_user_id: '777', api_token: 'tok_abcdefgh', known: { 10: '2026-11-01 10:00:00', 11: '2026-11-01 10:00:00' } };

test('wiring: both triggers → pick → list → plan → fetch or finish', () => {
  assert.deepStrictEqual(next('Every Hour'), ['Pick Agency']);
  assert.deepStrictEqual(next('Sync Now Webhook'), ['Pick Agency']);
  assert.deepStrictEqual(next('Pick Agency'), ['List Exported Listings']);
  assert.deepStrictEqual(next('Plan Sync'), ['Anything To Fetch?']);
  assert.deepStrictEqual(next('Anything To Fetch?', 0), ['Split Fetches']);
  assert.deepStrictEqual(next('Anything To Fetch?', 1), ['Finish Sync']);
  assert.deepStrictEqual(next('Split Fetches'), ['Get Listing']);
  assert.deepStrictEqual(next('Get Listing'), ['Map Listings']);
  assert.deepStrictEqual(next('Map Listings'), ['Save Listings']);
  assert.deepStrictEqual(next('Save Listings'), ['Finish Sync']);
  assert.strictEqual(nodeOf('Finish Sync').executeOnce, true);
  const hook = nodeOf('Sync Now Webhook');
  assert.strictEqual(hook.parameters.authentication, 'headerAuth');
  assert.strictEqual(hook.parameters.responseMode, 'onReceived');
  assert.strictEqual(hook.credentials.httpHeaderAuth.name, 'Elliot Internal Webhook Secret');
  const pick = nodeOf('Pick Agency').parameters;
  assert.match(pick.query, /asari_next_sync\(nullif\(\$1, ''\)::uuid\)/);
  assert.deepStrictEqual(expr(pick.options.queryReplacement, { json: { body: { tenant_id: 't9' } } }), ['t9']);
  assert.deepStrictEqual(expr(pick.options.queryReplacement, { json: { timestamp: 'x' } }), ['']);
});

test('ASARI calls: SiteAuth header, never throw, rate limit', () => {
  for (const name of ['List Exported Listings', 'Get Listing']) {
    const p = nodeOf(name).parameters;
    assert.strictEqual(p.headerParameters.parameters[0].name, 'SiteAuth');
    assert.strictEqual(expr(p.headerParameters.parameters[0].value, { nodes: { 'Pick Agency': agency } }), '777:tok_abcdefgh');
    assert.strictEqual(p.options.response.response.neverError, true);
    assert.strictEqual(p.options.response.response.fullResponse, true);
  }
  const get = nodeOf('Get Listing').parameters;
  assert.strictEqual(get.url, 'https://api.asari.pro/site/listing');
  assert.strictEqual(get.options.batching.batch.batchSize, 1);
  assert.ok(get.options.batching.batch.batchInterval >= 2400, '25 calls a minute at most');
  assert.strictEqual(nodeOf('List Exported Listings').parameters.url, 'https://api.asari.pro/site/exportedListingIdList');
});

const plan = (response) => run(nodeOf('Plan Sync').parameters.jsCode, { items: [response], nodes: { 'Pick Agency': agency } })[0].json;

test('plan: only new and changed listings are fetched', () => {
  const p = plan({ statusCode: 200, body: { success: true, data: [
    { id: 10, lastUpdated: '2026-11-01 10:00:00' }, // same
    { id: 11, lastUpdated: '2026-11-09 08:00:00' }, // changed
    { id: 12, lastUpdated: '2026-11-09 08:00:00' }, // new
  ] } });
  assert.deepStrictEqual([p.ok, p.to_fetch, p.exported_ids, p.total], [true, ['11', '12'], ['10', '11', '12'], 3]);
  // Plain ids (no version): only unknown ones are fetched.
  const q = plan({ statusCode: 200, body: JSON.stringify({ success: true, data: [10, 11, 13] }) });
  assert.deepStrictEqual(q.to_fetch, ['13']);
  // Known as a JSON string (Postgres node can return jsonb as text).
  const s = run(nodeOf('Plan Sync').parameters.jsCode, { items: [{ statusCode: 200, body: { success: true, data: [10, 14] } }],
    nodes: { 'Pick Agency': { ...agency, known: JSON.stringify(agency.known) } } })[0].json;
  assert.deepStrictEqual(s.to_fetch, ['14']);
});

test('plan: at most 150 per run, the rest next time', () => {
  const data = Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, lastUpdated: 'x' }));
  const p = plan({ statusCode: 200, body: { success: true, data } });
  assert.deepStrictEqual([p.to_fetch.length, p.left_for_next_run, p.exported_ids.length], [150, 50, 200]);
});

test('plan: ASARI errors are reported, nothing is withdrawn', () => {
  const bad = plan({ statusCode: 401, body: '' });
  assert.deepStrictEqual([bad.ok, bad.error, bad.exported_ids, bad.to_fetch], [false, 'ASARI refused the user ID or token', null, []]);
  const refused = plan({ statusCode: 200, body: { success: false, error: 'Invalid SiteAuth' } });
  assert.strictEqual(refused.error, 'Invalid SiteAuth');
  assert.strictEqual(plan({ statusCode: 0 }).error, 'ASARI answered HTTP nothing');
  const cond = nodeOf('Anything To Fetch?').parameters.conditions.conditions[0].leftValue;
  assert.strictEqual(expr(cond, { json: bad }), false);
  assert.strictEqual(expr(cond, { json: { ok: true, to_fetch: [] } }), false);
  assert.strictEqual(expr(cond, { json: { ok: true, to_fetch: ['1'] } }), true);
});

const sample = {
  id: 4411, listingId: 'MS-120', lastUpdated: '2026-11-09 08:00:00',
  section: 'ApartmentSale', status: 'Active',
  name: 'Sunny 2-room flat near the park',
  price: { amount: 749000, currency: 'PLN' }, totalArea: 48.5, noOfRooms: 2, floorNo: 'parter',
  location: { locality: 'Warszawa', quarter: 'Mokotów' }, street: 'Puławska', streetNumber: '12',
  description: '<p>Bright&nbsp;flat.</p><p>Close to <b>metro</b>.</p>',
  images: [{ id: 901 }, { id: 902 }], balcony: true, elevator: true,
};
const mapped = (bodies) => run(nodeOf('Map Listings').parameters.jsCode, {
  items: bodies, nodes: { 'Plan Sync': { tenant_id: 't1' } } })[0].json;

test('map: ASARI fields become an Elliot listing', () => {
  const out = mapped([{ statusCode: 200, body: { success: true, data: sample } }]);
  assert.strictEqual(out.tenant_id, 't1');
  assert.strictEqual(out.failed, 0);
  const r = out.rows[0];
  assert.deepStrictEqual(
    [r.external_id, r.external_version, r.reference, r.title, r.status, r.transaction_type, r.property_type],
    ['4411', '2026-11-09 08:00:00', 'MS-120', 'Sunny 2-room flat near the park', 'available', 'sale', 'apartment']);
  assert.deepStrictEqual([r.price, r.currency, r.area_m2, r.rooms, r.floor], [749000, 'PLN', 48.5, 2, 0]);
  assert.deepStrictEqual([r.city, r.district, r.address], ['Warszawa', 'Mokotów', 'Puławska 12']);
  assert.strictEqual(r.description, 'Bright flat.\n\nClose to metro.');
  assert.deepStrictEqual(r.photos, ['https://img.asariweb.pl/normal/901', 'https://img.asariweb.pl/normal/902']);
  assert.strictEqual(r.image_url, r.photos[0]);
  assert.deepStrictEqual(r.features, ['balcony', 'lift']);
  assert.strictEqual(r.raw.id, 4411, 'the original is kept');
});

test('map: rentals, other types, statuses and a Polish fallback title', () => {
  const rent = mapped([{ statusCode: 200, body: { success: true, data: {
    id: 5, section: 'HouseRental', status: 'Reserved', price: 6500, totalArea: 140, noOfRooms: 5, location: { locality: 'Kraków' } } } }]).rows[0];
  assert.deepStrictEqual([rent.transaction_type, rent.property_type, rent.status, rent.price], ['rent', 'house', 'under_offer', 6500]);
  assert.strictEqual(rent.title, 'Dom na wynajem, 5 pok., 140 m², Kraków');
  const kinds = { LotSale: 'plot', CommercialSpaceRental: 'commercial', WarehouseSale: 'commercial', RoomRental: 'room', Garage: 'other' };
  for (const [section, type] of Object.entries(kinds)) {
    const r = mapped([{ statusCode: 200, body: { success: true, data: { id: 1, section, name: 'x' } } }]).rows[0];
    assert.strictEqual(r.property_type, type, section);
  }
  const statuses = { Sold: 'sold', Rented: 'let', Archived: 'withdrawn', Active: 'available' };
  for (const [status, want] of Object.entries(statuses)) {
    assert.strictEqual(mapped([{ statusCode: 200, body: { success: true, data: { id: 1, status, name: 'x' } } }]).rows[0].status, want, status);
  }
});

test('map: failed answers are counted, not saved', () => {
  const out = mapped([
    { statusCode: 200, body: { success: true, data: sample } },
    { statusCode: 429, body: { success: false, error: 'Too many requests' } },
    { statusCode: 200, body: JSON.stringify({ success: false, error: 'No listing' }) },
    { statusCode: 200, body: 'not json' },
  ]);
  assert.deepStrictEqual([out.rows.length, out.failed], [1, 3]);
});

test('save and finish: parameters on every path', () => {
  const save = nodeOf('Save Listings').parameters;
  assert.match(save.query, /upsert_external_listings\(\$1::uuid, 'asari', \$2::jsonb\)/);
  assert.deepStrictEqual(expr(save.options.queryReplacement, { json: { tenant_id: 't1', rows: [{ a: 1 }] } }), ['t1', '[{"a":1}]']);
  const fin = nodeOf('Finish Sync').parameters;
  assert.match(fin.query, /asari_finish_sync\(\$1::uuid, \$2::jsonb, \$3, \$4::jsonb\)/);
  // After saving.
  const planned = { tenant_id: 't1', ok: true, error: null, exported_ids: ['10', '11'], to_fetch: ['11'], total: 2, left_for_next_run: 0 };
  const a = expr(fin.options.queryReplacement, { nodes: { 'Plan Sync': planned, 'Map Listings': { failed: 1 }, 'Save Listings': { result: { new: 0, updated: 1, skipped: 1 } } } });
  assert.deepStrictEqual(a.slice(0, 3), ['t1', '["10","11"]', '']);
  assert.deepStrictEqual(JSON.parse(a[3]), { exported: 2, fetched: 1, new: 0, updated: 1, failed: 2, left_for_next_run: 0 });
  // Nothing to fetch: Map/Save never ran.
  const b = expr(fin.options.queryReplacement, { nodes: { 'Plan Sync': { ...planned, to_fetch: [] } } });
  assert.deepStrictEqual(JSON.parse(b[3]), { exported: 2, fetched: 0, new: 0, updated: 0, failed: 0, left_for_next_run: 0 });
  // ASARI error: no exported list (nothing withdrawn) and the reason.
  const c = expr(fin.options.queryReplacement, { nodes: { 'Plan Sync': { tenant_id: 't1', ok: false, error: 'ASARI refused the user ID or token', exported_ids: null, to_fetch: [], total: 0 } } });
  assert.deepStrictEqual(c.slice(0, 3), ['t1', null, 'ASARI refused the user ID or token']);
  // Save result as text.
  const d = expr(fin.options.queryReplacement, { nodes: { 'Plan Sync': planned, 'Map Listings': { failed: 0 }, 'Save Listings': { result: '{"new":1,"updated":0,"skipped":0}' } } });
  assert.strictEqual(JSON.parse(d[3]).new, 1);
});

console.log(`${passed} passed`);
