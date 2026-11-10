// Tests for 0045: follow-up steps by WhatsApp. Workflow 20 picks the channel
// for each step (WhatsApp only to clients who wrote on WhatsApp, email
// otherwise, skipped when neither works) and hands WhatsApp drafts to 27;
// 27 sends plain text within 24 hours of the client's last message and the
// approved elliot_follow_up template after that.
//
// Run: node n8n/workflows/tests/whatsapp_follow_ups.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
const w20 = load('20-follow-up-sweep.json');
const w27 = load('27-send-approved-whatsapp.json');
const nodeOf = (wf, name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node named ${name}`);
  return n;
};
const next = (wf, name, branch = 0) => (wf.connections[name]?.main?.[branch] || []).map((x) => x.node);
function stubs(nodes) {
  return (name) => {
    if (!(name in nodes)) throw new Error(`node ${name} hasn't run`);
    const list = Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]];
    return { first: () => ({ json: list[0] }), item: { json: list[0] }, all: () => list.map((j) => ({ json: j })) };
  };
}
function run(code, items, nodes = {}) {
  const wrapped = items.map((json) => ({ json }));
  return new Function('$input', '$json', '$', code)({ first: () => wrapped[0], all: () => wrapped }, items[0], stubs(nodes));
}
const expr = (value, json = {}, nodes = {}) =>
  new Function('$json', '$', '$now', `return (${value.replace(/^=\{\{/, '').replace(/\}\}$/, '')});`)(json, stubs(nodes), { toISO: () => 'NOW' });

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

test('20 wiring: WhatsApp, nothing to send, or email', () => {
  assert.deepStrictEqual(next(w20, 'No Next Step?', 1), ['Send By WhatsApp?']);
  assert.deepStrictEqual(next(w20, 'Send By WhatsApp?', 0), ['Insert WhatsApp Draft']);
  assert.deepStrictEqual(next(w20, 'Send By WhatsApp?', 1), ['Nothing To Send?']);
  assert.deepStrictEqual(next(w20, 'Nothing To Send?', 0), ['Merge Before Advance']);
  assert.deepStrictEqual(next(w20, 'Nothing To Send?', 1), ['Insert Email Draft']);
  assert.deepStrictEqual(next(w20, 'Insert WhatsApp Draft'), ['Autonomous WhatsApp?']);
  assert.deepStrictEqual(next(w20, 'Autonomous WhatsApp?', 0), ['Send WhatsApp']);
  assert.deepStrictEqual(next(w20, 'Autonomous WhatsApp?', 1), ['Merge Before Advance']);
  assert.deepStrictEqual(next(w20, 'Send WhatsApp'), ['Merge Before Advance']);
  assert.deepStrictEqual(next(w20, 'Merge Before Advance'), ['Advance Run']);
  const send = nodeOf(w20, 'Send WhatsApp');
  assert.strictEqual(send.parameters.workflowId.value, nodeOf(load('28-manual-send-whatsapp-draft.json'), 'Execute: Send Approved WhatsApp').parameters.workflowId.value,
    'same workflow 27 as 28 uses');
  assert.strictEqual(send.parameters.workflowInputs.value.auto, true);
  assert.strictEqual(send.onError, 'continueRegularOutput', 'a failed send still advances the run');
  for (const [name, ch, want] of [['Send By WhatsApp?', 'whatsapp', true], ['Send By WhatsApp?', 'email', false], ['Nothing To Send?', 'none', true], ['Nothing To Send?', 'email', false]]) {
    assert.strictEqual(expr(nodeOf(w20, name).parameters.conditions.conditions[0].leftValue, { channel: ch }), want, `${name} ${ch}`);
  }
});

const run20 = (rows) => run(nodeOf(w20, 'Determine Action').parameters.jsCode, rows).map((x) => x.json);
const due = (over = {}) => ({
  run_id: 'r1', tenant_id: 't', contact_id: 'c', current_step_index: 0, contact_replied: false,
  contact_name: 'Anna', contact_email: 'anna@example.com', contact_phone: '+48 600 100 200',
  whatsapp_phone_number_id: 'PN1', wa_conversation_id: 'cv1', wa_last_inbound_at: '2026-11-09T10:00:00Z',
  autonomy_rules: {}, connected_gmail_address: 'office@agency.pl',
  steps: [{ day_offset: 0, channel: 'whatsapp', subject: '', body: 'Hi {{contact_name}}, still looking?\nWe have two new flats.' },
          { day_offset: 3, channel: 'email', subject: 'News for {{contact_name}}', body: 'B' }],
  ...over,
});

test('20 channel: WhatsApp only for clients who wrote on WhatsApp', () => {
  const [a] = run20([due()]);
  assert.deepStrictEqual([a.action, a.channel, a.to_wa_id, a.phone_number_id, a.wa_conversation_id], ['send', 'whatsapp', '48600100200', 'PN1', 'cv1']);
  assert.strictEqual(a.body, 'Hi Anna, still looking?\nWe have two new flats.');
  // Never wrote on WhatsApp → the step goes by email, subject from the first line.
  const [b] = run20([due({ wa_conversation_id: null, wa_last_inbound_at: null })]);
  assert.deepStrictEqual([b.channel, b.contact_email, b.subject, b.to_wa_id], ['email', 'anna@example.com', 'Hi Anna, still looking?', null]);
  // No WhatsApp number set up for the agency → email too.
  assert.strictEqual(run20([due({ whatsapp_phone_number_id: null })])[0].channel, 'email');
  // Neither → skipped.
  assert.strictEqual(run20([due({ wa_conversation_id: null, contact_email: '' })])[0].channel, 'none');
  // Email step: email; without an address, WhatsApp.
  const [c] = run20([due({ current_step_index: 1 })]);
  assert.deepStrictEqual([c.channel, c.subject, c.is_final, c.next_step_day_offset], ['email', 'News for Anna', true, null]);
  assert.strictEqual(run20([due({ current_step_index: 1, contact_email: null })])[0].channel, 'whatsapp');
  // Old steps without a channel are email.
  assert.strictEqual(run20([due({ steps: [{ day_offset: 0, subject: 'S', body: 'B' }] })])[0].channel, 'email');
  // Long first line → short subject.
  const long = run20([due({ wa_conversation_id: null, steps: [{ day_offset: 0, channel: 'whatsapp', body: 'x'.repeat(100) }] })])[0];
  assert.strictEqual(long.subject.length, 68);
});

test('20: every due run is handled (not only the first), paired with its input', () => {
  const out = run(nodeOf(w20, 'Determine Action').parameters.jsCode, [due({ run_id: 'a' }), due({ run_id: 'b', contact_replied: true }), due({ run_id: 'c', current_step_index: 5 })]);
  assert.deepStrictEqual(out.map((x) => [x.json.run_id, x.json.action, x.pairedItem]), [['a', 'send', 0], ['b', 'stop_replied', 1], ['c', 'complete', 2]]);
  const merged = run(nodeOf(w20, 'Merge Before Advance').parameters.jsCode, [{ id: 1 }, { id: 2 }]);
  assert.strictEqual(merged.length, 2);
});

test('20: WhatsApp draft waits for approval unless follow-ups are automatic', () => {
  const ins = nodeOf(w20, 'Insert WhatsApp Draft').parameters;
  assert.match(ins.query, /insert into whatsapp_drafts .*follow_up_run_id/s);
  assert.match(ins.query, /'follow_up'/);
  const [a] = run20([due()]);
  const p = expr(ins.options.queryReplacement, a);
  assert.deepStrictEqual(p, ['t', 'cv1', 'c', '48600100200', 'PN1', '2026-11-09T10:00:00Z', a.body, 'pending', 'r1']);
  const [auto] = run20([due({ autonomy_rules: { send_follow_up: { mode: 'autonomous' } } })]);
  assert.strictEqual(expr(ins.options.queryReplacement, auto)[7], 'approved');
  const cond = nodeOf(w20, 'Autonomous WhatsApp?').parameters.conditions.conditions[0].leftValue;
  assert.strictEqual(expr(cond, {}, { 'Determine Action': auto }), true);
  assert.strictEqual(expr(cond, {}, { 'Determine Action': a }), false);
  assert.match(nodeOf(w20, 'Query Due Runs').parameters.query, /channel = 'whatsapp'/);
});

test('27 wiring: outside 24 hours a follow-up goes as the template', () => {
  assert.deepStrictEqual(next(w27, 'Within 24h Window?', 0), ['Send via WhatsApp API']);
  assert.deepStrictEqual(next(w27, 'Within 24h Window?', 1), ['Follow-Up?']);
  assert.deepStrictEqual(next(w27, 'Follow-Up?', 0), ['Build Follow-Up Template']);
  assert.deepStrictEqual(next(w27, 'Follow-Up?', 1), ['Update Draft Status (Blocked)']);
  assert.deepStrictEqual(next(w27, 'Build Follow-Up Template'), ['Send Follow-Up Template']);
  assert.deepStrictEqual(next(w27, 'Send Follow-Up Template'), ['Check Template Result']);
  assert.deepStrictEqual(next(w27, 'Template Sent?', 0), ['Update Draft Status (Sent)']);
  assert.deepStrictEqual(next(w27, 'Template Sent?', 1), ['Update Draft Status (Template Refused)']);
  const http = nodeOf(w27, 'Send Follow-Up Template');
  assert.strictEqual(http.credentials.httpHeaderAuth.name, 'WhatsApp Cloud API token');
  assert.strictEqual(http.parameters.options.response.response.neverError, true);
  const fu = nodeOf(w27, 'Follow-Up?').parameters.conditions.conditions[0].leftValue;
  assert.strictEqual(expr(fu, { category: 'follow_up' }), true);
  assert.strictEqual(expr(fu, { category: 'lead_inquiry' }), false);
  assert.match(nodeOf(w27, 'Load Draft').parameters.query, /agency_name/);
});

const draft = (body, over = {}) => ({ id: 'd1', tenant_id: 't', to_wa_id: '48600100200', phone_number_id: 'PN1', agency_name: 'Simon Real Estate', body, category: 'follow_up', ...over });
const template = (d) => run(nodeOf(w27, 'Build Follow-Up Template').parameters.jsCode, [{}], { 'Load Draft': d })[0].json;

test('27 template: one line, agency name, language', () => {
  const t = template(draft('Hi Anna,\n\nstill looking?\tWe have      two new flats.'));
  assert.strictEqual(t.url, 'https://graph.facebook.com/v20.0/PN1/messages');
  assert.deepStrictEqual(t.payload.template.name, 'elliot_follow_up');
  assert.strictEqual(t.language, 'en');
  const [agency, text] = t.payload.template.components[0].parameters.map((p) => p.text);
  assert.strictEqual(agency, 'Simon Real Estate');
  assert.strictEqual(text, 'Hi Anna, still looking? We have   two new flats.');
  assert.ok(!/[\n\t]| {4,}/.test(text), 'WhatsApp refuses line breaks, tabs and 4+ spaces');
  assert.strictEqual(template(draft('Dzień dobry Anno, czy nadal szuka Pani mieszkania?')).language, 'pl');
  assert.strictEqual(template(draft('Witam, mamy nowe oferty.')).language, 'pl');
  assert.strictEqual(template(draft('x'.repeat(2000))).payload.template.components[0].parameters[1].text.length, 900);
  assert.strictEqual(template(draft('Hi', { agency_name: null })).payload.template.components[0].parameters[0].text, 'your agent');
});

test('27 template result and draft status', () => {
  const check = (r) => run(nodeOf(w27, 'Check Template Result').parameters.jsCode, [r], { 'Build Follow-Up Template': { language: 'pl' } })[0].json;
  assert.deepStrictEqual(check({ statusCode: 200, body: { messages: [{ id: 'wamid.1' }] } }), { ok: true, detail: '' });
  const missing = check({ statusCode: 404, body: { error: { message: 'Template name does not exist in the translation', code: 132001 } } });
  assert.strictEqual(missing.ok, false);
  assert.match(missing.detail, /elliot_follow_up.*\(pl\).*132001/);
  assert.match(check({ statusCode: 0 }).detail, /HTTP no response/);
  const sent = nodeOf(w27, 'Update Draft Status (Sent)').parameters;
  assert.match(sent.query, /sent_via = \$4/);
  const nodes = (within, auto) => ({ 'Load Draft': { id: 'd1' }, 'When Executed by Another Workflow': { auto }, 'Check 24h Window': { within_window: within } });
  assert.deepStrictEqual(expr(sent.options.queryReplacement, {}, nodes(false, true)), ['d1', 'auto_sent', 'NOW', 'template']);
  assert.deepStrictEqual(expr(sent.options.queryReplacement, {}, nodes(true, false)), ['d1', 'sent', 'NOW', 'text']);
  const refused = nodeOf(w27, 'Update Draft Status (Template Refused)').parameters;
  assert.match(refused.query, /blocked_needs_template.*send_error = \$2/s);
  assert.deepStrictEqual(expr(refused.options.queryReplacement, { detail: 'why' }, { 'Load Draft': { id: 'd1' } }), ['d1', 'why']);
});

console.log(`${passed} passed`);
