// Tests for the security changes that go with migration 0047:
//  - the public /chat webhook is always the website chat; a channel,
//    attachments and a verified identity only come through /chat-internal,
//    which needs the internal secret;
//  - 16, 25 and 40 call /chat-internal with that secret;
//  - "Elliot books on its own: off" is enforced in 01, not left to the prompt;
//  - bookings and viewing changes use the contact the server knows, and on the
//    website chat only viewings booked in the same conversation.
// Runs the nodes' code and expressions straight out of the workflow JSON.
//
// Run: node n8n/workflows/tests/security_hardening.test.js

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
function run(code, { json = {}, nodes = {}, globals = {} } = {}) {
  const item = { json };
  const $input = { first: () => item, all: () => [item] };
  const names = Object.keys(globals);
  return new Function('$input', '$json', '$', ...names, code)($input, json, stubs(nodes), ...names.map((k) => globals[k]));
}
function expr(value, { json = {}, nodes = {} } = {}) {
  const body = value.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  return new Function('$json', '$', `return (${body});`)(json, stubs(nodes));
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}`); console.error(e); process.exitCode = 1; }
}

const wf01 = load('01-main-ai-agent.json');
const wf16 = load('16-email-inbound-trigger.json');
const wf25 = load('25-whatsapp-inbound-trigger.json');
const wf37 = load('37-client-viewing-changes.json');
const wf40 = load('40-email-inbound-forwarded.json');
const SECRET = 'Elliot Internal Webhook Secret';
const CONV = '11111111-2222-3333-4444-555555555555';
const SIGNED = 'https://abc.supabase.co/storage/v1/object/sign/email-attachments/t/c/1-a.pdf?token=x';

const validate = (json) => run(nodeOf(wf01, 'Validate Input').parameters.jsCode, { json })[0].json;

test('01: two doors: the public /chat and the secret-protected /chat-internal', () => {
  const pub = wf01.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === 'chat');
  assert.strictEqual(pub.length, 1);
  assert.deepStrictEqual(next(wf01, pub[0].name), ['Validate Input'], 'the public door never passes Mark Internal');

  const int = nodeOf(wf01, 'Chat Webhook (Internal)');
  assert.strictEqual(int.parameters.path, 'chat-internal');
  assert.strictEqual(int.parameters.httpMethod, 'POST');
  assert.strictEqual(int.parameters.authentication, 'headerAuth');
  assert.strictEqual(int.credentials.httpHeaderAuth.name, SECRET);
  assert.deepStrictEqual(next(wf01, 'Chat Webhook (Internal)'), ['Mark Internal']);
  assert.deepStrictEqual(next(wf01, 'Mark Internal'), ['Validate Input']);
  // Mark Internal is reachable from the internal webhook only.
  const into = Object.entries(wf01.connections).filter(([, c]) => (c.main || []).flat().some((x) => x && x.node === 'Mark Internal')).map(([k]) => k);
  assert.deepStrictEqual(into, ['Chat Webhook (Internal)']);
  const marked = run(nodeOf(wf01, 'Mark Internal').parameters.jsCode, { json: { body: { message: 'Hi' } } })[0].json;
  assert.deepStrictEqual(marked, { body: { message: 'Hi' }, internal: true });
});

test('01: a public caller is the website chat, whatever it claims', () => {
  for (const channel of ['email', 'whatsapp']) {
    const v = validate({ body: { tenant_slug: 's', message: 'Hi', channel, internal: true, verified: true,
      attachments: [{ filename: 'a.pdf', content_type: 'application/pdf', url: SIGNED }] } });
    assert.deepStrictEqual([v.channel, v.verified, v.attachments, v.message], ['chat_widget', false, [], 'Hi'], channel);
  }
  // "internal" inside the body (which the caller controls) counts for nothing.
  assert.strictEqual(validate({ body: { tenant_slug: 's', message: 'Hi', channel: 'email', internal: true } }).channel, 'chat_widget');
  assert.strictEqual(validate({ internal: 'true', body: { tenant_slug: 's', message: 'Hi', channel: 'email' } }).channel, 'chat_widget');
});

test('01: Elliot\'s own workflows keep their channel and are verified', () => {
  const e = validate({ internal: true, body: { tenant_slug: 's', message: 'Hi', channel: 'email' } });
  assert.deepStrictEqual([e.channel, e.verified], ['email', true]);
  const w = validate({ internal: true, body: { tenant_slug: 's', message: 'Hi', channel: 'whatsapp' } });
  assert.deepStrictEqual([w.channel, w.verified], ['whatsapp', true]);
  // Through the internal door but with no channel: still the website chat.
  const c = validate({ internal: true, body: { tenant_slug: 's', message: 'Hi' } });
  assert.deepStrictEqual([c.channel, c.verified], ['chat_widget', false]);
});

test('01: input is bounded; a conversation id must be a UUID', () => {
  assert.strictEqual(validate({ body: { tenant_slug: 's', message: 'Hi', conversation_id: CONV } }).conversation_id, CONV);
  for (const bad of ["x' or 1=1", '123', { a: 1 }, CONV + '0']) {
    assert.strictEqual(validate({ body: { tenant_slug: 's', message: 'Hi', conversation_id: bad } }).conversation_id, null);
  }
  const big = validate({ body: { tenant_slug: 's'.repeat(500), message: 'm'.repeat(50000), contact: { name: 'n'.repeat(900), email: 'e'.repeat(900), phone: 'p'.repeat(900) } } });
  assert.deepStrictEqual([big.tenant_slug.length, big.message.length, big.contact_name.length, big.contact_email.length, big.contact_phone.length], [100, 20000, 200, 320, 40]);
  const odd = validate({ body: { tenant_slug: 's', message: 'Hi', contact: { name: { $ne: null }, email: ['a'], phone: 48601 } } });
  assert.deepStrictEqual([odd.contact_name, odd.contact_email, odd.contact_phone], [null, null, '48601']);
  assert.throws(() => validate({ body: { message: 'Hi' } }), /tenant_slug is required/);
  assert.throws(() => validate({ body: { tenant_slug: 's' } }), /message is required/);
});

test('01: the verified flag reaches identify_chat_visitor', () => {
  const ident = nodeOf(wf01, 'Identify Visitor');
  assert.match(ident.parameters.query, /identify_chat_visitor\(\$1, \$2::uuid, \$3, \$4, \$5, \$6::boolean\)/);
  const params = (verified) => expr(ident.parameters.options.queryReplacement, { nodes: {
    'Merge Tenant Context': { tenant_id: 't', contact_name: 'Anna', contact_email: 'a@x.pl', contact_phone: null, verified },
    'Get or Create Conversation': { conversation_id: 'conv' },
  } });
  assert.strictEqual(params(true)[5], true);
  assert.strictEqual(params(false)[5], false);
  assert.strictEqual(params(undefined)[5], false);
  assert.strictEqual(params('true')[5], false, 'only a real true counts');
});

for (const [label, wf] of [['16', wf16], ['25', wf25], ['40', wf40]]) {
  test(`${label}: asks Elliot through /chat-internal, with the secret`, () => {
    const ask = nodeOf(wf, 'Ask Elliot');
    assert.strictEqual(ask.parameters.authentication, 'genericCredentialType');
    assert.strictEqual(ask.parameters.genericAuthType, 'httpHeaderAuth');
    assert.strictEqual(ask.credentials.httpHeaderAuth.name, SECRET);
    const code = nodeOf(wf, 'Build Elliot Request').parameters.jsCode;
    assert.match(code, /chat-internal/);
    assert.ok(!/x-elliot-webhook-secret\s*['"]?\s*:\s*['"][^'"]{8,}/i.test(JSON.stringify(wf)), 'no secret value in the workflow file');
  });
}

const extract = (toolBlock, { rules, mode = 'agency' } = {}) => run(nodeOf(wf01, 'Extract Tool Call').parameters.jsCode, {
  json: { content: [{ type: 'text', text: '...' }, toolBlock] },
  nodes: { 'Load AI Config': { autonomy_rules: rules }, 'Merge Tenant Context': { assistant_mode: mode } },
})[0].json;
const BOOK = { type: 'tool_use', id: 'tu1', name: 'book_appointment', input: { contact_id: 'c', starts_at: '2026-12-01T10:00:00+01:00', ends_at: '2026-12-01T10:30:00+01:00', listing_id: 'L1', notes: 'Second viewing' } };
const HOLD = { book_appointment: { mode: 'approval_required' } };

test('01: bookings that need approval are not booked; the team gets the request', () => {
  const held = extract(BOOK, { rules: HOLD });
  assert.deepStrictEqual([held.tool_name, held.held_tool, held.requested_tool, held.log_decision, held.decision],
    ['escalate_to_human', 'book_appointment', 'book_appointment', 'pending', 'auto_approved']);
  assert.strictEqual(held.tool_input.reason, 'action_exceeds_permissions');
  assert.strictEqual(held.tool_input.priority, 'high');
  assert.match(held.tool_input.context_summary, /a viewing from 2026-12-01T10:00:00\+01:00 to 2026-12-01T10:30:00\+01:00, listing L1\. Notes: Second viewing/);
  assert.strictEqual(held.tool_use_id, 'tu1');
  // The rules may arrive as a JSON string.
  assert.strictEqual(extract(BOOK, { rules: JSON.stringify(HOLD) }).held_tool, 'book_appointment');
  // A valuation visit is held the same way.
  const val = extract({ ...BOOK, input: { ...BOOK.input, kind: 'valuation', property_address: 'Płochocińska 1' } }, { rules: HOLD });
  assert.match(val.tool_input.context_summary, /a valuation visit .* at Płochocińska 1/);
  // A very long note can't blow up the hand-over.
  const long = extract({ ...BOOK, input: { ...BOOK.input, notes: 'x'.repeat(5000) } }, { rules: HOLD });
  assert.ok(long.tool_input.context_summary.length <= 1500);
});

test('01: bookings go straight through when the agency allows it; other tools are untouched', () => {
  for (const rules of [undefined, null, {}, { book_appointment: { mode: 'auto' } }, 'not json', { send_follow_up: { mode: 'approval_required' } }]) {
    const out = extract(BOOK, { rules });
    assert.deepStrictEqual([out.tool_name, out.held_tool, out.log_decision], ['book_appointment', null, 'auto_approved'], JSON.stringify(rules));
    assert.deepStrictEqual(out.tool_input, BOOK.input);
  }
  // getelliot.eu's own assistant books its calls directly.
  assert.strictEqual(extract(BOOK, { rules: HOLD, mode: 'sales' }).tool_name, 'book_appointment');
  const avail = extract({ type: 'tool_use', id: 'tu2', name: 'check_availability', input: {} }, { rules: HOLD });
  assert.deepStrictEqual([avail.tool_name, avail.held_tool], ['check_availability', null]);
  const bad = extract({ type: 'tool_use', id: 'tu3', name: 'delete_everything', input: {} }, { rules: HOLD });
  assert.deepStrictEqual([bad.decision, bad.log_decision, bad.held_tool], ['denied_by_policy', 'denied_by_policy', null]);
});

test('01: the log says what was asked for, and Claude is told it is not booked', () => {
  const log = nodeOf(wf01, 'Log Tool Call');
  const nodes = { 'Merge Tenant Context': { tenant_id: 't' }, 'Get or Create Conversation': { conversation_id: 'conv' } };
  const held = expr(log.parameters.options.queryReplacement, { json: extract(BOOK, { rules: HOLD }), nodes });
  assert.deepStrictEqual([held[2], held[4]], ['book_appointment', 'pending']);
  const direct = expr(log.parameters.options.queryReplacement, { json: extract(BOOK, {}), nodes });
  assert.deepStrictEqual([direct[2], direct[4]], ['book_appointment', 'auto_approved']);

  const code = nodeOf(wf01, 'Build Tool Result Message').parameters.jsCode;
  const out = run(code, { json: { success: true }, nodes: {
    'Assemble Request': { claude_messages: [{ role: 'user', content: 'Friday 10:00 please' }] },
    'Call Claude': { content: [BOOK] },
    'Extract Tool Call': extract(BOOK, { rules: HOLD }),
    'Merge Tenant Context': { channel: 'chat_widget', assistant_mode: 'agency' },
    'Identify Visitor': { visitor: {} },
    'Get or Create Conversation': { conversation_id: 'conv' },
    'Load AI Config': {},
  } });
  const text = JSON.stringify(out);
  assert.match(text, /NOT BOOKED/);
  assert.match(text, /requested, not confirmed/);
  assert.ok(!/has been booked|Booked successfully/i.test(text));
});

test('01: bookings and changes use the contact the server knows, not the one Claude names', () => {
  const book = nodeOf(wf01, 'Execute: Book Appointment Sub-Workflow').parameters.workflowInputs.value;
  const tool = { tool_input: { contact_id: 'claimed-by-model' } };
  assert.strictEqual(expr(book.contact_id, { nodes: { 'Identify Visitor': { visitor: { contact_id: 'known' } }, 'Extract Tool Call': tool } }), 'known');
  assert.strictEqual(expr(book.contact_id, { nodes: { 'Identify Visitor': { visitor: {} }, 'Extract Tool Call': tool } }), 'claimed-by-model');

  const change = nodeOf(wf01, 'Execute: Change Viewing Sub-Workflow').parameters.workflowInputs.value;
  assert.ok(!/tool_input\.contact_id/.test(change.contact_id), 'change_viewing never takes a contact from the model');
  assert.strictEqual(expr(change.contact_id, { nodes: { 'Identify Visitor': { visitor: { contact_id: 'known' } } } }), 'known');
  assert.match(change.conversation_id, /Get or Create Conversation/);
  assert.match(change.channel, /Merge Tenant Context/);
});

test('37: on the website chat only a viewing booked in the same conversation', () => {
  const load37 = nodeOf(wf37, 'Load Booking');
  assert.match(load37.parameters.query, /client_appointment\(\$1::uuid, \$2::uuid, \$3::uuid, nullif\(\$4, ''\)::uuid\)/);
  const params = (trigger) => expr(load37.parameters.options.queryReplacement, {
    json: { tenant_id: 't', contact_id: 'c', appointment_id: 'a' },
    nodes: { 'When Executed by Another Workflow': trigger },
  });
  assert.deepStrictEqual(params({ channel: 'chat_widget', conversation_id: CONV }), ['t', 'c', 'a', CONV]);
  assert.deepStrictEqual(params({ channel: 'email', conversation_id: CONV }), ['t', 'c', 'a', ''], 'email proves who is writing');
  assert.deepStrictEqual(params({ channel: 'whatsapp', conversation_id: CONV }), ['t', 'c', 'a', '']);
  // No channel or no conversation: fail closed (an id that matches nothing).
  assert.deepStrictEqual(params({ conversation_id: CONV })[3], CONV);
  assert.strictEqual(params({ channel: 'chat_widget' })[3], '00000000-0000-0000-0000-000000000000');
  assert.strictEqual(params({})[3], '00000000-0000-0000-0000-000000000000');
});

console.log(`\n${passed} passed`);
