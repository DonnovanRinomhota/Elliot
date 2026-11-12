// Tests for workflow 43 (Data Retention, migration 0051): the database does
// the erasing; the workflow deletes the erased clients' stored files and logs
// any it couldn't.
//
// Run: node n8n/workflows/tests/data_retention.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '43-data-retention.json'), 'utf8'));
const nodeOf = (name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node named ${name}`);
  return n;
};
const next = (name) => (wf.connections[name]?.main?.[0] || []).map((x) => x.node);
const runCode = (name, items, nodes = {}) =>
  new Function('$input', '$', nodeOf(name).parameters.jsCode)(
    { first: () => items[0], all: () => items },
    (n) => ({ all: () => (nodes[n] || []).map((json) => ({ json })), first: () => ({ json: (nodes[n] || [])[0] }) })
  );
const expr = (v, json) => new Function('$json', `return (${v.replace(/^=\{\{/, '').replace(/\}\}$/, '')});`)(json);

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}`); console.error(e); process.exitCode = 1; }
}

test('nightly, in Warsaw time, with the error workflow', () => {
  assert.strictEqual(nodeOf('Every Night at 03:15').parameters.rule.interval[0].expression, '15 3 * * *');
  assert.strictEqual(wf.settings.timezone, 'Europe/Warsaw');
  assert.strictEqual(wf.settings.errorWorkflow, 'seDI8X3d4J3gLEgw');
  assert.deepStrictEqual(next('Every Night at 03:15'), ['Apply Retention']);
  assert.deepStrictEqual(next('Apply Retention'), ['Files To Delete']);
  assert.deepStrictEqual(next('Files To Delete'), ['Delete Files']);
  assert.deepStrictEqual(next('Delete Files'), ['Failed Deletes']);
  assert.deepStrictEqual(next('Failed Deletes'), ['Log Failed Deletes']);
});

test('the database decides who is erased', () => {
  assert.match(nodeOf('Apply Retention').parameters.query, /select apply_retention\(200\) as result/);
  assert.match(nodeOf('Apply Retention').parameters.query, /supabase_url from platform_settings/);
});

test('files are deleted in batches of 100 from the private bucket', () => {
  const paths = Array.from({ length: 230 }, (_, i) => `t/c/${i}-a.pdf`);
  const out = runCode('Files To Delete', [{ json: { result: { storage_paths: paths }, supabase_url: 'https://abc.supabase.co/' } }]);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].json.url, 'https://abc.supabase.co/storage/v1/object/email-attachments');
  assert.deepStrictEqual(out.map((o) => o.json.prefixes.length), [100, 100, 30]);
  assert.deepStrictEqual(runCode('Files To Delete', [{ json: { result: { storage_paths: [] }, supabase_url: 'https://abc.supabase.co' } }]), []);
  assert.deepStrictEqual(runCode('Files To Delete', [{ json: { result: { clients_erased: 0 }, supabase_url: null } }]), []);
  const noUrl = runCode('Files To Delete', [{ json: { result: { storage_paths: ['t/c/1.pdf'] }, supabase_url: '' } }]);
  assert.deepStrictEqual(noUrl[0].json, { skip: true, error: 'platform_settings.supabase_url is not set (see 0046)', count: 1 });

  const del = nodeOf('Delete Files');
  assert.strictEqual(del.parameters.method, 'DELETE');
  assert.strictEqual(del.credentials.httpCustomAuth.name, 'Supabase Storage (service role)');
  assert.deepStrictEqual(JSON.parse(expr(del.parameters.jsonBody, { prefixes: ['t/c/1.pdf'] })), { prefixes: ['t/c/1.pdf'] });
  assert.strictEqual(del.retryOnFail, true, 'deleting the same files again is harmless');
  assert.strictEqual(del.parameters.options.response.response.neverError, true);
});

test('a delete that failed is logged so the alerts show it', () => {
  const reqs = [{ url: 'u', prefixes: ['a', 'b'] }, { url: 'u', prefixes: ['c'] }];
  const out = runCode('Failed Deletes', [{ json: { statusCode: 200 } }, { json: { statusCode: 500 } }], { 'Files To Delete': reqs });
  assert.deepStrictEqual(out.map((o) => o.json), [{ error: 'Storage answered HTTP 500', count: 1, paths: ['c'] }]);
  assert.deepStrictEqual(runCode('Failed Deletes', [{ json: { statusCode: 200 } }], { 'Files To Delete': [reqs[0]] }), []);
  const skipped = runCode('Failed Deletes', [{ json: {} }], { 'Files To Delete': [{ skip: true, error: 'no url', count: 3 }] });
  assert.deepStrictEqual(skipped[0].json, { error: 'no url', count: 3, paths: [] });
  const log = nodeOf('Log Failed Deletes');
  assert.match(log.parameters.query, /'retention_files_failed'/, 'ends in _failed: picked up by the health alerts');
  assert.deepStrictEqual(expr(log.parameters.options.queryReplacement, { error: 'e', count: 1, paths: ['c'] }), ['e', 1, '["c"]']);
});

console.log(`\n${passed} passed`);
