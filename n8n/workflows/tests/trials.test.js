// Tests for the trial pause in workflow 01 (migration 0050): when an agency's
// trial has ended, Elliot doesn't call Claude; the client gets a short holding
// reply (at most once a day; the database decides) and their message is saved.
//
// Run: node n8n/workflows/tests/trials.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '01-main-ai-agent.json'), 'utf8'));
const nodeOf = (name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node named ${name}`);
  return n;
};
const next = (name, branch = 0) => (wf.connections[name]?.main?.[branch] || []).map((x) => x.node);
const stubs = (nodes) => (name) => ({ first: () => ({ json: nodes[name] }), item: { json: nodes[name] } });
const run = (code, json) => new Function('$input', '$json', code)({ first: () => ({ json }), all: () => [{ json }] }, json);
const expr = (value, json, nodes = {}) => new Function('$json', '$', `return (${value.replace(/^=\{\{/, '').replace(/\}\}$/, '')});`)(json, stubs(nodes));

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}`); console.error(e); process.exitCode = 1; }
}

test('Resolve Tenant asks the database whether the agency is paused', () => {
  const q = nodeOf('Resolve Tenant').parameters.query;
  assert.match(q, /tenant_service_state\(id\) as service_state/);
  assert.match(q, /where slug = \$1 and status = 'active'/, 'suspended agencies are still not resolved, as before');
});

test('paused agencies never reach Claude', () => {
  assert.deepStrictEqual(next('Merge Tenant Context'), ['Trial Ended?']);
  const cond = nodeOf('Trial Ended?').parameters.conditions.conditions[0].leftValue;
  assert.strictEqual(expr(cond, { service_state: 'trial_ended' }), true);
  for (const s of ['serving', undefined, null, 'suspended', 'TRIAL_ENDED']) assert.strictEqual(expr(cond, { service_state: s }), false, String(s));
  assert.deepStrictEqual(next('Trial Ended?', 1), ['Load AI Config'], 'serving: the normal path');
  assert.deepStrictEqual(next('Trial Ended?', 0), ['Trial Ended Reply']);
  assert.deepStrictEqual(next('Trial Ended Reply'), ['Record Paused Message']);
  assert.deepStrictEqual(next('Record Paused Message'), ['Respond: Trial Ended']);
  assert.deepStrictEqual(next('Respond: Trial Ended'), []);
  // Walk the paused path: no Claude, no tools, no AI usage.
  const seen = new Set();
  const walk = (n) => { if (seen.has(n)) return; seen.add(n); for (const b of wf.connections[n]?.main || []) for (const c of b || []) walk(c.node); };
  walk('Trial Ended Reply');
  for (const n of ['Call Claude', 'Load AI Config', 'Log AI Usage', 'Assemble Request']) assert.ok(!seen.has(n), `${n} is reachable when paused`);
});

test('the holding reply is in the client\'s language and names the agency', () => {
  const code = nodeOf('Trial Ended Reply').parameters.jsCode;
  const ctx = { tenant_id: 't1', tenant_name: 'Simon Real Estate', conversation_id: 'c1', message: 'Is the flat on Oak Street available?', contact_name: 'Anna', contact_email: 'a@x.pl', contact_phone: null };
  const en = run(code, ctx)[0].json;
  assert.strictEqual(en.reply, 'Thank you for your message to Simon Real Estate. Our team will get back to you as soon as possible.');
  assert.deepStrictEqual([en.tenant_id, en.conversation_id, en.message, en.contact_name, en.contact_email, en.contact_phone], ['t1', 'c1', ctx.message, 'Anna', 'a@x.pl', '']);
  const pl = run(code, { ...ctx, message: 'Dzień dobry, czy mieszkanie jest dostępne?' })[0].json;
  assert.strictEqual(pl.reply, 'Dziękujemy za wiadomość do Simon Real Estate. Nasz zespół odpowie najszybciej, jak to możliwe.');
  const noName = run(code, { ...ctx, tenant_name: '', conversation_id: null })[0].json;
  assert.strictEqual(noName.reply, 'Thank you for your message. Our team will get back to you as soon as possible.');
  assert.strictEqual(noName.conversation_id, '');
});

test('the database saves the message and decides whether to answer', () => {
  const rec = nodeOf('Record Paused Message');
  assert.match(rec.parameters.query, /select paused_reply\(\$1::uuid, nullif\(\$2, ''\)::uuid, \$3, \$4, \$5, \$6, \$7\) as result/);
  const out = run(nodeOf('Trial Ended Reply').parameters.jsCode, { tenant_id: 't1', tenant_name: 'A', conversation_id: 'c1', message: 'Hi' })[0].json;
  assert.deepStrictEqual(expr(rec.parameters.options.queryReplacement, out), ['t1', 'c1', 'Hi', out.reply, '', '', '']);
  assert.strictEqual(rec.credentials.postgres.name, 'Elliot Postgres (service role)');
});

test('channels send the reply once, then nothing (as when a person has taken over)', () => {
  const body = nodeOf('Respond: Trial Ended').parameters.responseBody;
  assert.deepStrictEqual(expr(body, { result: { conversation_id: 'c1', reply: 'Thanks', human: false } }), { conversation_id: 'c1', reply: 'Thanks', paused: true });
  assert.deepStrictEqual(expr(body, { result: { conversation_id: 'c1', reply: null, human: true } }), { conversation_id: 'c1', reply: null, human: true, paused: true });
  assert.deepStrictEqual(expr(body, {}), { conversation_id: undefined, reply: null, human: true, paused: true });
});

console.log(`\n${passed} passed`);
