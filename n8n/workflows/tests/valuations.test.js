// Tests for 0043: sellers and landlords. Elliot records a valuation request
// (01's record_valuation_request), never quotes a price, and books a free
// valuation visit at the client's address (12), with the right words in
// changes (37) and reminders (38).
//
// Run: node n8n/workflows/tests/valuations.test.js

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
  return new Function('$input', '$json', '$', code)({ first: () => item, all: () => [item] }, json, stubs(nodes));
}
function expr(value, { json = {}, nodes = {} } = {}) {
  const body = value.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  return new Function('$json', '$', `return (${body});`)(json, stubs(nodes));
}
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const decodeBody = (raw) => { const [, b] = fromB64url(raw).split('\r\n\r\n'); return Buffer.from(b, 'base64').toString('utf8'); };

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok - ${name}`); };
const wf01 = load('01-main-ai-agent.json');
const wf12 = load('12-book-appointment.json');
const wf37 = load('37-client-viewing-changes.json');
const wf38 = load('38-viewing-reminders.json');
const T = '11111111-1111-1111-1111-111111111111';
console.log('valuations');

const tools = (mode) => {
  const body = nodeOf(wf01, 'Call Claude').parameters.jsonBody.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  return JSON.parse(new Function('$json', '$', `return ${body}`)({ system_prompt: 's', claude_messages: [] },
    () => ({ first: () => ({ json: { assistant_mode: mode } }) }))).tools;
};

test('01: agencies get record_valuation_request; Elliot\'s own sales assistant does not', () => {
  const t = tools('agency').find((x) => x.name === 'record_valuation_request');
  assert.ok(t);
  assert.deepStrictEqual(t.input_schema.properties.intent.enum, ['sell', 'let']);
  assert.ok(t.input_schema.properties.within_3_months && t.input_schema.properties.address);
  assert.ok(!tools('sales').some((x) => x.name === 'record_valuation_request'));
  const book = tools('agency').find((x) => x.name === 'book_appointment');
  assert.deepStrictEqual(book.input_schema.properties.kind.enum, ['viewing', 'valuation']);
  assert.ok(book.input_schema.properties.property_address);
  const allowed = run(nodeOf(wf01, 'Extract Tool Call').parameters.jsCode, { json: { content: [{ type: 'tool_use', id: 't', name: 'record_valuation_request', input: {} }] } });
  assert.strictEqual(allowed[0].json.decision, 'auto_approved');
});

test('01: the prompt never lets Elliot quote a price and offers a free valuation visit', () => {
  const s = nodeOf(wf01, 'Build Claude Request').parameters.jsCode;
  assert.match(s, /16\. Sellers and landlords: .*never give a price, range or estimate/);
  assert.match(s, /book_appointment with kind "valuation" and property_address/);
  assert.match(s, /escalate_to_human with reason hot_lead/);
});

test('01: routed to the database, with the visitor\'s contact and the details', () => {
  const rules = nodeOf(wf01, 'Route by Tool').parameters.rules.values;
  assert.strictEqual(rules[7].conditions.conditions[0].rightValue, 'record_valuation_request');
  assert.strictEqual(wf01.connections['Route by Tool'].main[7][0].node, 'Record Valuation Request');
  assert.strictEqual(wf01.connections['Record Valuation Request'].main[0][0].node, 'Build Tool Result Message');
  const rv = nodeOf(wf01, 'Record Valuation Request');
  assert.strictEqual(rv.onError, 'continueRegularOutput');
  assert.match(rv.parameters.query, /record_valuation_request\(\$1::uuid, nullif\(\$2, ''\)::uuid, \$3::jsonb\)/);
  const input = { intent: 'sell', address: 'ul. Puławska 10', area_m2: 54 };
  const p = expr(rv.parameters.options.queryReplacement, { nodes: { 'Merge Tenant Context': { tenant_id: T },
    'Extract Tool Call': { tool_input: input }, 'Identify Visitor': { visitor: { contact_id: 'c1' } } } });
  assert.deepStrictEqual(p, [T, 'c1', JSON.stringify(input)]);
  const p2 = expr(rv.parameters.options.queryReplacement, { nodes: { 'Merge Tenant Context': { tenant_id: T },
    'Extract Tool Call': { tool_input: { ...input, contact_id: 'c2' } }, 'Identify Visitor': { visitor: {} } } });
  assert.deepStrictEqual(p2.slice(1), ['c2', JSON.stringify(input)]);
});

test('01: the tool result steers Elliot to a visit; booking passes kind and address', () => {
  const s = nodeOf(wf01, 'Build Tool Result Message').parameters.jsCode;
  const base = { 'Assemble Request': { claude_messages: [], system_prompt: 's' }, 'Call Claude': { content: [] } };
  const text = (output, name = 'record_valuation_request') => run(s, { json: output, nodes: { ...base, 'Extract Tool Call': { tool_name: name, tool_use_id: 'u' } } })[0]
    .json.claude_messages[1].content[0].content;
  assert.match(text({ result: { lead_id: 'l', status: 'HOT', intent: 'sell' } }), /^Saved: seller lead \(HOT\)\. Now: do not give any price/);
  assert.match(text({ result: '{"lead_id":"l","status":"WARM","intent":"let"}' }), /^Saved: landlord lead \(WARM\)/);
  assert.match(text({ error: { message: 'contact not found' } }), /^Not saved \(contact not found\)\. .*capture_lead/);
  assert.match(text({ success: true, kind: 'valuation', location: 'ul. X 1, Warszawa', appointment_id: 'a', starts_at: 's', ends_at: 'e', status: 'confirmed', agent_name: 'Ola' }, 'book_appointment'),
    /^Valuation visit booked at ul\. X 1, Warszawa\. .* Agent: Ola\./);
  const v = nodeOf(wf01, 'Execute: Book Appointment Sub-Workflow').parameters.workflowInputs.value;
  const ctx = (mode, input) => ({ nodes: { 'Merge Tenant Context': { assistant_mode: mode }, 'Extract Tool Call': { tool_input: input } } });
  assert.strictEqual(expr(v.kind, ctx('agency', { kind: 'valuation' })), 'valuation');
  assert.strictEqual(expr(v.kind, ctx('agency', {})), '');
  assert.strictEqual(expr(v.kind, ctx('sales', { kind: 'valuation' })), 'consultation');
  assert.strictEqual(expr(v.location, ctx('agency', { kind: 'valuation', property_address: 'ul. X 1' })), 'ul. X 1');
  assert.strictEqual(expr(v.location, ctx('agency', { property_address: 'ul. X 1' })), '');
});

const req = { tenant_id: T, contact_id: 'c', starts_at: '2026-12-01T09:00:00.000Z', ends_at: '2026-12-01T10:00:00.000Z', kind: 'valuation', location: 'ul. Puławska 10/5, Warszawa' };
const info = { timezone: 'Europe/Warsaw', tenant_name: 'Simon Real Estate', contact_name: 'Ewa Nowak', contact_email: 'ewa@x.pl', contact_phone: '+48600', agent_name: 'Ola', agent_invite: 'ola@a.pl' };

test('12: a valuation visit goes in the calendar at the client\'s address', () => {
  const ev = JSON.parse(expr(nodeOf(wf12, 'HTTP Request').parameters.jsonBody, { json: info, nodes: { 'When Executed by Another Workflow': req } }));
  assert.strictEqual(ev.summary, 'Valuation visit — Ewa Nowak — ul. Puławska 10/5, Warszawa');
  assert.strictEqual(ev.location, 'ul. Puławska 10/5, Warszawa');
  assert.match(ev.description, /^Free valuation of the client's property, booked by Elliot\.\nAddress: .*\nAgent: Ola\nClient phone: \+48600/);
  assert.deepStrictEqual(ev.attendees, [{ email: 'ewa@x.pl' }, { email: 'ola@a.pl' }]);
  const ins = nodeOf(wf12, 'Insert Appointment').parameters;
  assert.match(ins.query, /kind, location\)\nvalues .*\$13, nullif\(\$14, ''\)\)/);
  const nodes = { 'When Executed by Another Workflow': req, 'Load Tenant + Contact Info': { timezone: 'Europe/Warsaw' }, 'Pick Calendar': { agent_id: 'u', google_calendar_id: 'ola@a.pl' } };
  assert.deepStrictEqual(expr(ins.options.queryReplacement, { json: { id: 'ev' }, nodes }).slice(12), ['valuation', 'ul. Puławska 10/5, Warszawa']);
  assert.deepStrictEqual(expr(ins.options.queryReplacement, { json: { id: 'ev' }, nodes: { ...nodes, 'When Executed by Another Workflow': { ...req, kind: 'consultation' } } }).slice(12), ['call', '']);
  assert.deepStrictEqual(expr(ins.options.queryReplacement, { json: { id: 'ev' }, nodes: { ...nodes, 'When Executed by Another Workflow': { ...req, kind: '' } } }).slice(12), ['viewing', '']);
  const fr = run(nodeOf(wf12, 'Format Results').parameters.jsCode, { json: { id: 'a1' }, nodes: { 'When Executed by Another Workflow': req, 'HTTP Request': {}, 'Load Tenant + Contact Info': {}, 'Pick Calendar': {} } })[0].json;
  assert.deepStrictEqual([fr.kind, fr.location], ['valuation', 'ul. Puławska 10/5, Warszawa']);
});

test('12: the client\'s confirmation is about a free valuation, in English and Polish', () => {
  const booked = { kind: 'valuation', location: req.location };
  const r = run(nodeOf(wf12, 'Build Confirmation Email').parameters.jsCode, { json: booked,
    nodes: { 'Load Tenant + Contact Info': { ...info, assistant_mode: 'agency' }, 'When Executed by Another Workflow': req, 'Pick Calendar': { agent_name: 'Ola' } } })[0].json;
  assert.match(r.subject, /^Valuation visit booked: Tue 1 Dec, 10:00$/);
  const body = decodeBody(r.raw_message);
  assert.match(body, /Your free valuation visit with Simon Real Estate is booked\.\n\nWhen: +Tuesday,? 1 December 2026, 10:00–11:00\nAddress: +ul\. Puławska 10\/5, Warszawa\nAgent: +Ola/);
  assert.match(body, /potwierdzamy bezpłatną wycenę nieruchomości z Simon Real Estate\./);
  assert.ok(!/null/.test(body));
});

test('37 and 38: changes and reminders speak of a valuation visit at the client\'s address', () => {
  const s37 = nodeOf(wf37, 'Build Emails').parameters.jsCode;
  assert.match(s37, /const noun = i\.kind === 'valuation' \? 'valuation visit' : isCall \? 'call' : 'viewing';/);
  assert.match(s37, /const place = i\.kind === 'valuation' \? String\(i\.location \|\| ''\)/);
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const r = run(nodeOf(wf38, 'Build Reminder').parameters.jsCode, { json: { appointment_id: 'a', tenant_id: T, tenant_name: 'Simon Real Estate', assistant_mode: 'agency',
    timezone: 'Europe/Warsaw', starts_at: tomorrow, contact_name: 'Ewa', contact_email: 'ewa@x.pl', contact_phone: '+48600100200', conversation_channel: 'whatsapp',
    whatsapp_phone_number_id: '123', kind: 'valuation', location: 'ul. Puławska 10/5' } }).json;
  assert.strictEqual(r.channel, 'email'); // the WhatsApp template is about viewings
  assert.match(r.log_text, /agent Simon Real Estate przyjedzie wycenić nieruchomość \(ul\. Puławska 10\/5\)|an agent from Simon Real Estate is coming tomorrow, .* to value your property at ul\. Puławska 10\/5/);
  const body = decodeBody(r.raw_message);
  assert.match(body, /an agent from Simon Real Estate is coming tomorrow, .*, to value your property at ul\. Puławska 10\/5\./);
  const subj = fromB64url(r.raw_message).match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1];
  assert.match(Buffer.from(subj, 'base64').toString('utf8'), /^Reminder: valuation visit tomorrow at \d\d:\d\d$/);
  const viewing = run(nodeOf(wf38, 'Build Reminder').parameters.jsCode, { json: { appointment_id: 'a', tenant_name: 'S', assistant_mode: 'agency', timezone: 'Europe/Warsaw',
    starts_at: tomorrow, contact_name: 'Ewa', contact_phone: '+48600100200', conversation_channel: 'whatsapp', whatsapp_phone_number_id: '123', kind: 'viewing' } }).json;
  assert.strictEqual(viewing.channel, 'whatsapp');
});

console.log(`${passed} passed`);
