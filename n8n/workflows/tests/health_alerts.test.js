// Tests for health checks and alerts (0036): workflow 33 checks every
// outside service, asks the database what to send, and sends it by email
// (Resend, falling back to Gmail) and WhatsApp (template). Workflow 34 records
// crashes of other workflows. Runs the nodes' code and expressions out of the
// workflow JSON.
//
// Run: node n8n/workflows/tests/health_alerts.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WF_DIR = path.join(__dirname, '..');
const load = (file) => JSON.parse(fs.readFileSync(path.join(WF_DIR, file), 'utf8'));
const nodeOf = (wf, name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node named ${name}`);
  return n;
};
const next = (wf, name, branch = 0) => (wf.connections[name]?.main?.[branch] || []).map((x) => x.node);
function stubs(nodes) {
  return (name) => {
    if (!(name in nodes)) throw new Error(`node ${name} not stubbed`);
    const v = nodes[name];
    const list = Array.isArray(v) ? v : [v];
    return { first: () => ({ json: list[0] }), item: { json: list[0] }, all: () => list.map((j) => ({ json: j })) };
  };
}
function run(code, { json = {}, nodes = {} } = {}) {
  const item = { json };
  const $input = { first: () => item, all: () => [item] };
  return new Function('$input', '$json', '$', code)($input, json, stubs(nodes));
}
function expr(value, { json = {}, nodes = {} } = {}) {
  const body = value.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  return new Function('$json', '$', `return (${body});`)(json, stubs(nodes));
}
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const wf = load('33-health-check.json');
const wf34 = load('34-workflow-error-recorder.json');
const summarize = nodeOf(wf, 'Summarize Checks').parameters.jsCode;
const ok200 = { statusCode: 200, body: {} };
const allOk = {
  'Load Alert Settings': { whatsapp_sender_id: '1328644853675927', whatsapp_check_id: '1328644853675927' },
  'Check Claude': ok200, 'Check Voyage': ok200, 'Check Gmail': ok200, 'Check Calendar': ok200, 'Check WhatsApp': ok200,
};
const resultsOf = (nodes) => run(summarize, { nodes })[0].json.results;
const byKey = (rs) => Object.fromEntries(rs.map((r) => [r.key, r]));

console.log('health_alerts');

test('the scheduled run checks every service in order, then plans and sends', () => {
  assert.deepStrictEqual(
    ['Every 15 Minutes', 'Load Alert Settings', 'Check Claude', 'Check Voyage', 'Check Gmail', 'Check Calendar', 'Check WhatsApp', 'Summarize Checks', 'Plan Alerts', 'Is Email?']
      .slice(0, -1).map((n) => next(wf, n)[0]),
    ['Load Alert Settings', 'Check Claude', 'Check Voyage', 'Check Gmail', 'Check Calendar', 'Check WhatsApp', 'Summarize Checks', 'Plan Alerts', 'Is Email?'],
  );
  assert.deepStrictEqual(next(wf, 'Is Email?', 0), ['Send via Resend']);
  assert.deepStrictEqual(next(wf, 'Is Email?', 1), ['Send WhatsApp Alert']);
  assert.deepStrictEqual(next(wf, 'Resend Failed?', 0), ['Send via Gmail (fallback)']);
  assert.deepStrictEqual(next(wf, 'Resend Failed?', 1), ['Record Delivery']);
  assert.deepStrictEqual(next(wf, 'Check Gmail Result'), ['Record Delivery']);
  assert.deepStrictEqual(next(wf, 'Check WhatsApp Result'), ['Record Delivery']);
  assert.deepStrictEqual(next(wf, 'Load Test Alert'), ['Is Email?']);
});

test('a failing service never stops the run: every check continues on error', () => {
  for (const n of wf.nodes.filter((x) => x.name.startsWith('Check ') && x.type.endsWith('httpRequest'))) {
    assert.strictEqual(n.onError, 'continueRegularOutput', n.name);
    assert.strictEqual(n.parameters.options.response.response.neverError, true, n.name);
  }
  assert.strictEqual(nodeOf(wf, 'Load Alert Settings').onError, 'continueRegularOutput');
  for (const n of ['Send via Resend', 'Send via Gmail (fallback)', 'Send WhatsApp Alert']) {
    assert.strictEqual(nodeOf(wf, n).onError, 'continueRegularOutput', n);
  }
});

test('all healthy: six checks, all OK', () => {
  const rs = resultsOf(allOk);
  assert.deepStrictEqual(rs.map((r) => r.key), ['database', 'claude', 'voyage', 'gmail', 'calendar', 'whatsapp']);
  assert.ok(rs.every((r) => r.ok));
});

test('an expired Gmail login is reported with what to do', () => {
  const g = byKey(resultsOf({ ...allOk, 'Check Gmail': { statusCode: 401, body: { error: { message: 'Invalid Credentials' } } } })).gmail;
  assert.strictEqual(g.ok, false);
  assert.match(g.detail, /^HTTP 401: Invalid Credentials -- the Gmail login has expired; reconnect "Gmail account" in n8n$/);
});

test('Claude: busy is not an outage, an empty credit balance is', () => {
  assert.strictEqual(byKey(resultsOf({ ...allOk, 'Check Claude': { statusCode: 529, body: {} } })).claude.ok, true);
  const c = byKey(resultsOf({ ...allOk, 'Check Claude': { statusCode: 400, body: '{"error":{"message":"Your credit balance is too low"}}' } })).claude;
  assert.strictEqual(c.ok, false);
  assert.match(c.detail, /credit balance is too low -- often means the Claude credit balance has run out/);
});

test('a missing credential or network error is a failure, not a crash', () => {
  const v = byKey(resultsOf({ ...allOk, 'Check Voyage': { error: { message: 'Credentials not found' } } })).voyage;
  assert.deepStrictEqual([v.ok, v.detail], [false, 'Credentials not found']);
});

test('database down is reported; no WhatsApp number anywhere skips the WhatsApp check', () => {
  const rs = byKey(resultsOf({ ...allOk, 'Load Alert Settings': { error: { message: 'connection refused' } } }));
  assert.deepStrictEqual([rs.database.ok, rs.database.detail], [false, 'connection refused']);
  assert.ok(!('whatsapp' in rs));
});

test('Plan Alerts passes the results as JSON to health_alert_plan', () => {
  const p = nodeOf(wf, 'Plan Alerts').parameters;
  assert.match(p.query, /health_alert_plan\(\$1::jsonb\)/);
  const out = run(summarize, { nodes: allOk })[0].json;
  assert.deepStrictEqual(expr(p.options.queryReplacement, { json: out }), [out.results_json]);
  assert.strictEqual(JSON.parse(out.results_json).length, 6);
});

test('the WhatsApp check uses the alert sender, or any agency number', () => {
  const url = nodeOf(wf, 'Check WhatsApp').parameters.url;
  assert.strictEqual(expr(url, { nodes: { 'Load Alert Settings': { whatsapp_check_id: '123' } } }), 'https://graph.facebook.com/v20.0/123?fields=id');
});

const alertEmail = { channel: 'email', recipient: 'owner@example.com', sender_id: null, subject: 'Elliot alert: 1 check(s) failing',
  body: 'NEW PROBLEMS\n- Gmail -- HTTP 401\n\nFull status\nOK: Claude', short: 'Elliot alert: Gmail failing. Details in your email.', audience: 'platform' };
const alertWa = { ...alertEmail, channel: 'whatsapp', recipient: '48600100200', sender_id: '1328644853675927' };

test('email goes out through Resend from alerts@getelliot.eu', () => {
  const n = nodeOf(wf, 'Send via Resend');
  assert.strictEqual(n.parameters.url, 'https://api.resend.com/emails');
  assert.strictEqual(n.credentials.httpHeaderAuth.name, 'Resend API key');
  const body = JSON.parse(expr(n.parameters.jsonBody, { json: alertEmail }));
  assert.deepStrictEqual(body, { from: 'Elliot Alerts <alerts@getelliot.eu>', to: ['owner@example.com'], subject: alertEmail.subject, text: alertEmail.body });
});

const checkEmail = nodeOf(wf, 'Check Email Result').parameters.jsCode;
test('Resend accepted: recorded as delivered, no Gmail fallback', () => {
  const r = run(checkEmail, { json: { statusCode: 200, body: { id: 'abc' } }, nodes: { 'Is Email?': alertEmail } }).json;
  assert.deepStrictEqual([r.ok, r.detail, r.recipient], [true, 'via Resend', 'owner@example.com']);
  assert.strictEqual(expr(nodeOf(wf, 'Resend Failed?').parameters.conditions.conditions[0].leftValue, { json: r }), false);
});

test('Resend not set up: falls back to Gmail with the same message', () => {
  const r = run(checkEmail, { json: { error: { message: 'Credentials not found' } }, nodes: { 'Is Email?': alertEmail } }).json;
  assert.deepStrictEqual([r.ok, r.detail], [false, 'Resend: Credentials not found']);
  assert.strictEqual(expr(nodeOf(wf, 'Resend Failed?').parameters.conditions.conditions[0].leftValue, { json: r }), true);
  const raw = fromB64url(r.raw_message);
  assert.match(raw, /^To: owner@example.com\r\nSubject: =\?UTF-8\?B\?/);
  const [, b64body] = raw.split('\r\n\r\n');
  assert.strictEqual(Buffer.from(b64body, 'base64').toString('utf8'), alertEmail.body + '\n');
  const gmail = nodeOf(wf, 'Send via Gmail (fallback)');
  assert.strictEqual(gmail.credentials.gmailOAuth2.name, 'Gmail account');
  assert.deepStrictEqual(JSON.parse(expr(gmail.parameters.jsonBody, { json: r })), { raw: r.raw_message });
});

test('Gmail fallback result says which route worked', () => {
  const code = nodeOf(wf, 'Check Gmail Result').parameters.jsCode;
  const prev = { recipient: 'owner@example.com', detail: 'Resend: HTTP 403: domain not verified' };
  let r = run(code, { json: { statusCode: 200, body: { id: 'g1' } }, nodes: { 'Check Email Result': prev } }).json;
  assert.deepStrictEqual([r.ok, r.detail], [true, 'via Gmail (Resend: HTTP 403: domain not verified)']);
  r = run(code, { json: { statusCode: 401, body: { error: { message: 'Invalid Credentials' } } }, nodes: { 'Check Email Result': prev } }).json;
  assert.deepStrictEqual([r.ok, r.detail], [false, 'Resend: HTTP 403: domain not verified; Gmail: HTTP 401: Invalid Credentials']);
});

test('WhatsApp uses the elliot_alert template with one clean line of text', () => {
  const n = nodeOf(wf, 'Send WhatsApp Alert');
  assert.strictEqual(expr(n.parameters.url, { json: alertWa }), 'https://graph.facebook.com/v20.0/1328644853675927/messages');
  const body = JSON.parse(expr(n.parameters.jsonBody, { json: { ...alertWa, short: 'Elliot alert:\n Gmail\tfailing.     Details' } }));
  assert.strictEqual(body.to, '48600100200');
  assert.strictEqual(body.type, 'template');
  assert.strictEqual(body.template.name, 'elliot_alert');
  assert.strictEqual(body.template.components[0].parameters[0].text, 'Elliot alert: Gmail failing. Details');
});

test('WhatsApp result explains the common setup problems', () => {
  const code = nodeOf(wf, 'Check WhatsApp Result').parameters.jsCode;
  const nodes = { 'Is Email?': alertWa };
  let r = run(code, { json: { statusCode: 200, body: { messages: [{ id: 'wamid.1' }] } }, nodes }).json;
  assert.deepStrictEqual([r.ok, r.detail], [true, '']);
  r = run(code, { json: { statusCode: 404, body: { error: { message: 'Template name does not exist in the translation', code: 132001 } } }, nodes }).json;
  assert.strictEqual(r.ok, false);
  assert.match(r.detail, /\(code 132001\) -- create the "elliot_alert" template in WhatsApp Manager$/);
  r = run(code, { json: { statusCode: 400, body: { error: { message: 'Recipient phone number not in allowed list', code: 131030 } } }, nodes }).json;
  assert.match(r.detail, /add this phone as an allowed recipient$/);
});

test('every delivery is recorded for the Control panel', () => {
  const p = nodeOf(wf, 'Record Delivery').parameters;
  assert.match(p.query, /record_alert_delivery\(\$1, \$2::boolean, \$3, \$4\)/);
  assert.deepStrictEqual(expr(p.options.queryReplacement, { json: { channel: 'whatsapp', ok: false, detail: 'x', recipient: '48' } }), ['whatsapp', 'false', 'x', '48']);
});

test('test alert webhook needs the internal secret; /health is public and read-only', () => {
  const t = nodeOf(wf, 'Test Alert Webhook');
  assert.strictEqual(t.parameters.authentication, 'headerAuth');
  assert.strictEqual(t.credentials.httpHeaderAuth.name, 'Elliot Internal Webhook Secret');
  assert.strictEqual(t.parameters.path, 'health-test-alert');
  assert.match(nodeOf(wf, 'Load Test Alert').parameters.query, /health_test_alert\(\)/);
  const h = nodeOf(wf, 'Health Status Webhook');
  assert.deepStrictEqual([h.parameters.httpMethod, h.parameters.path], ['GET', 'health']);
  assert.strictEqual(nodeOf(wf, 'Read Health Status').parameters.query, 'select health_status() as status;');
  const resp = nodeOf(wf, 'Respond Health Status').parameters;
  assert.strictEqual(expr(resp.options.responseCode, { json: { status: { status: 'all_ok' } } }), 200);
  assert.strictEqual(expr(resp.options.responseCode, { json: { error: 'db down' } }), 503);
  assert.strictEqual(JSON.parse(expr(resp.responseBody, { json: { error: 'db down' } })).status, 'database_unreachable');
});

test('the Claude check is a one-token request with the same model as workflow 01', () => {
  const n = nodeOf(wf, 'Check Claude');
  const body = JSON.parse(expr(n.parameters.jsonBody));
  assert.strictEqual(body.max_tokens, 1);
  const main = JSON.stringify(load('01-main-ai-agent.json'));
  assert.ok(main.includes(`model: '${body.model}'`), `01 doesn't use ${body.model}`);
  assert.strictEqual(n.credentials.anthropicApi.name, 'Anthropic account');
});

test('workflow 34 records the failed workflow, node and error', () => {
  const p = nodeOf(wf34, 'Log Workflow Error').parameters;
  assert.match(p.query, /log_workflow_error\(\$1, \$2, \$3, \$4\)/);
  const json = { workflow: { name: '16 - Email Inbound Trigger' }, execution: { lastNodeExecuted: 'Send Reply via Gmail', error: { message: 'Invalid Credentials' }, url: 'https://x/1' } };
  assert.deepStrictEqual(expr(p.options.queryReplacement, { json }), ['16 - Email Inbound Trigger', 'Send Reply via Gmail', 'Invalid Credentials', 'https://x/1']);
  assert.deepStrictEqual(expr(p.options.queryReplacement, { json: {} }), ['unknown workflow', '', 'unknown error', '']);
  assert.deepStrictEqual(next(wf34, 'Error Trigger'), ['Log Workflow Error']);
});

console.log(`\n${passed} passed`);
