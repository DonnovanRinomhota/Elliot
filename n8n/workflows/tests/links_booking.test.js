// Tests for 0033: property links when Elliot suggests flats, the client's
// booking confirmation email, the conversation stored on appointments, and
// hand-over emails with the client's details and the conversation.
// Runs the nodes' code and expressions straight out of the workflow JSON.
//
// Run: node n8n/workflows/tests/links_booking.test.js

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
function decodeMail(rawB64url) {
  const raw = fromB64url(rawB64url);
  const [head, body] = raw.split('\r\n\r\n');
  const subject = (head.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/) || [])[1];
  return { head, subject: subject ? Buffer.from(subject, 'base64').toString('utf8') : null, body: Buffer.from(body, 'base64').toString('utf8') };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const wf01 = load('01-main-ai-agent.json');
const wf12 = load('12-book-appointment.json');
const wf24 = load('24-escalate-to-human.json');
const DASH = 'https://app.getelliot.eu';

const prompt = (channel = 'chat_widget') =>
  run(nodeOf(wf01, 'Build Claude Request').parameters.jsCode, {
    nodes: {
      'Merge Tenant Context': { tenant_name: 'Simon', tenant_industry: 'real estate', message: 'Hi', channel },
      'Load AI Config': {},
      'Load Conversation History': [],
      'Identify Visitor': { visitor: { contact_id: 'c-1', name: 'Don', phone: '+48601', ready: true } },
    },
  })[0].json.system_prompt;

test('01: Elliot asks for an email before booking, sends links, and only promises follow-ups it escalates', () => {
  for (const ch of ['chat_widget', 'whatsapp']) {
    const p = prompt(ch);
    assert.match(p, /make sure you have their email address so the confirmation can be emailed/);
    assert.match(p, /If they'd rather not give one, book anyway/);
    assert.match(p, /Never say a viewing is booked, confirmed or being arranged, and never mention a confirmation email, unless book_appointment returned success/);
    assert.match(p, /passing the listing_id of the property they chose and their email as email/);
    assert.match(p, /each with its key facts and its Link, exactly as given/);
    assert.match(p, /never say you have no photos when a listing has a link/);
    assert.match(p, /13\. Never tell the visitor that someone from the team will contact them/);
    assert.match(p, /unless you call escalate_to_human in the same reply/);
    // Rules stay in order and the visitor block still follows.
    assert.ok(p.indexOf('9. When') < p.indexOf('10. When') && p.indexOf('10. When') < p.indexOf('11. Messages'));
    assert.ok(p.indexOf('13. Never') < p.indexOf('VISITOR:'));
  }
  const tools = nodeOf(wf01, 'Call Claude').parameters.jsonBody;
  assert.match(tools, /whenever you tell the visitor a team member will contact them, send them something or follow up/);
});

const resultText = (toolName, output) => {
  const code = nodeOf(wf01, 'Build Tool Result Message').parameters.jsCode;
  return run(code, {
    json: output,
    nodes: {
      'Assemble Request': { claude_messages: [], tool_turns: 0 },
      'Call Claude': { content: [] },
      'Extract Tool Call': { tool_name: toolName, tool_use_id: 't1' },
    },
  })[0].json.claude_messages[1].content[0].content;
};

test('01: every suggested listing comes with a link: website page, else Elliot\'s property page', () => {
  const text = resultText('search_listings', {
    result: {
      listings: [
        { listing_id: 'L1', title: 'Studio', price: 2200, currency: 'PLN', transaction_type: 'rent', address: 'Płochocińska 16A/72', district: 'Białołęka', city: 'Warszawa', photo_count: 6, url: null },
        { listing_id: 'L2', title: 'Room', price: 1800, currency: 'PLN', transaction_type: 'rent', city: 'Warszawa', photo_count: 1, url: 'https://agency.pl/krochmalna' },
        { listing_id: 'L3', title: 'Flat', price: 1, currency: 'PLN', transaction_type: 'rent', photo_count: 0, url: 'https://drive.google.com/drive/folders/abc' },
      ],
    },
  });
  assert.match(text, new RegExp(`Link \\(send this to the visitor\\): ${DASH}/p/L1`));
  assert.match(text, /Photos: 6 \(on the link\)/);
  assert.match(text, /Płochocińska 16A\/72, Białołęka, Warszawa/);
  assert.match(text, /Link \(send this to the visitor\): https:\/\/agency\.pl\/krochmalna/);
  assert.match(text, new RegExp(`Link \\(send this to the visitor\\): ${DASH}/p/L3`), 'a Drive folder is not a property page');
  assert.match(text, /No photos yet \(the link still shows the details\)/);
});

test('01: Elliot hears whether the confirmation email went out, with the property link', () => {
  const sent = resultText('book_appointment', {
    success: true, appointment_id: 'a1', starts_at: 's', ends_at: 'e', status: 'confirmed',
    listing_title: 'Studio', listing_address: 'Płochocińska 16A/72', listing_link: `${DASH}/p/L1`, confirmation_sent_to: 'don@x.pl',
  });
  assert.match(sent, /Property link: https:\/\/app\.getelliot\.eu\/p\/L1\./);
  assert.match(sent, /A confirmation email was sent to don@x\.pl\./);
  const none = resultText('book_appointment', { success: true, appointment_id: 'a1', starts_at: 's', ends_at: 'e', status: 'confirmed' });
  assert.match(none, /No confirmation email was sent \(no email address on file\)\. Do not say one is coming\./);
});

test('01: the booking carries the conversation it was made in', () => {
  const v = nodeOf(wf01, 'Execute: Book Appointment Sub-Workflow').parameters.workflowInputs;
  assert.strictEqual(expr(v.value.conversation_id, { nodes: { 'Get or Create Conversation': { conversation_id: 'conv-9' } } }), 'conv-9');
  assert.ok(v.schema.some((s) => s.id === 'conversation_id'));
});

test('12: the conversation and the listing\'s own page are looked up and stored', () => {
  const lookup = nodeOf(wf12, 'Load Tenant + Contact Info').parameters;
  assert.match(lookup.query, /cv\.id::text = nullif\(\$4, ''\) and cv\.tenant_id = \$1/);
  assert.match(lookup.query, /li\.url as listing_url/);
  assert.match(lookup.query, /t\.name as tenant_name/);
  assert.deepStrictEqual(expr(lookup.options.queryReplacement, { json: { tenant_id: 't', contact_id: 'c', listing_id: 'L1', conversation_id: ' conv ', email: ' New@Mail.pl ', starts_at: 's', ends_at: 'e' } }), ['t', 'c', 'L1', 'conv', 'New@Mail.pl', 's', 'e']);

  const ins = nodeOf(wf12, 'Insert Appointment').parameters;
  assert.match(ins.query, /conversation_id, agent_id, booked_calendar_id\)\nvalues .*nullif\(\$9, ''\)::uuid, nullif\(\$11, ''\)::uuid, \$12\)/);
  const p = expr(ins.options.queryReplacement, {
    json: { id: 'g1' },
    nodes: {
      'When Executed by Another Workflow': { tenant_id: 't', contact_id: 'c', starts_at: 's', ends_at: 'e' },
      'Load Tenant + Contact Info': { timezone: 'Europe/Warsaw', listing_id: 'L1', conversation_id: 'conv' },
    },
  });
  assert.strictEqual(p[8], 'conv');

  const ev = JSON.parse(expr(nodeOf(wf12, 'HTTP Request').parameters.jsonBody, {
    json: { timezone: 'Europe/Warsaw', contact_name: 'Don', contact_phone: '+48601', conversation_id: 'conv', conversation_channel: 'whatsapp' },
    nodes: { 'When Executed by Another Workflow': { starts_at: 's', ends_at: 'e' } },
  }));
  assert.match(ev.description, /Client phone: \+48601/);
  assert.match(ev.description, /Booked by Elliot on WhatsApp: https:\/\/app\.getelliot\.eu\/dashboard\/conversations\/conv/);

  const out = run(nodeOf(wf12, 'Format Results').parameters.jsCode, {
    json: { id: 'a1', starts_at: 's', ends_at: 'e', status: 'confirmed', listing_id: 'L1' },
    nodes: { 'Load Tenant + Contact Info': { listing_title: 'Studio', listing_address: 'X 1', listing_url: null },
             'When Executed by Another Workflow': { kind: '' }, 'HTTP Request': {} },
  })[0].json;
  assert.strictEqual(out.listing_link, `${DASH}/p/L1`);
});

test('12: a confirmation email goes to the client when there is an email; the booking never depends on it', () => {
  assert.deepStrictEqual(next(wf12, 'Format Results'), ['Has Client Email?']);
  assert.deepStrictEqual(next(wf12, 'Has Client Email?', 0), ['Build Confirmation Email']);
  assert.deepStrictEqual(next(wf12, 'Has Client Email?', 1), ['Booking Result']);
  assert.deepStrictEqual(next(wf12, 'Build Confirmation Email'), ['Send Confirmation Email']);
  assert.deepStrictEqual(next(wf12, 'Send Confirmation Email'), ['Booking Result']);
  const send = nodeOf(wf12, 'Send Confirmation Email');
  assert.strictEqual(send.onError, 'continueRegularOutput');
  // 0039: sent by workflow 39 (Resend, from the agency's name), not Gmail.
  assert.strictEqual(send.type, 'n8n-nodes-base.executeWorkflow');
  assert.strictEqual(send.parameters.workflowInputs.value.audience, 'client');

  const cond = nodeOf(wf12, 'Has Client Email?').parameters.conditions.conditions[0].leftValue;
  const has = (email) => expr(cond, { nodes: { 'Load Tenant + Contact Info': { contact_email: email } } });
  assert.strictEqual(has('don@example.pl'), true);
  assert.strictEqual(has(null), false);
  assert.strictEqual(has('not an email'), false);

  const info = {
    timezone: 'Europe/Warsaw', tenant_name: 'Simon Real Estate', contact_name: 'Don Rino', contact_email: 'don@example.pl',
    listing_title: 'Studio Płochocińska', listing_reference: 'SR-12', listing_address: 'Płochocińska 16A/72, Białołęka, Warszawa',
    listing_price: 2200, listing_currency: 'PLN', listing_transaction_type: 'rent', listing_area_m2: '27.5', listing_rooms: 1,
    agent_name: 'Ola Nowak',
  };
  const mail = run(nodeOf(wf12, 'Build Confirmation Email').parameters.jsCode, {
    json: { listing_link: `${DASH}/p/L1` },
    nodes: {
      'Load Tenant + Contact Info': info,
      'When Executed by Another Workflow': { starts_at: '2026-11-11T13:00:00.000Z', ends_at: '2026-11-11T14:00:00.000Z' },
    },
  })[0].json;
  const m = decodeMail(mail.raw_message);
  assert.match(m.head, /^To: don@example\.pl\r\n/);
  assert.strictEqual(m.subject, 'Viewing confirmed: Wed 11 Nov, 14:00 – Studio Płochocińska');
  assert.match(m.body, /^Hi Don,/);
  assert.match(m.body, /Your viewing with Simon Real Estate is confirmed\./);
  assert.match(m.body, /When: {5}Wednesday,? 11 November 2026, 14:00–15:00/);
  assert.match(m.body, /Property: Studio Płochocińska \(ref SR-12\)/);
  assert.match(m.body, /2200 PLN \/ month · 27\.5 m² · 1 room/);
  assert.match(m.body, /Address: {2}Płochocińska 16A\/72, Białołęka, Warszawa/);
  assert.match(m.body, /Agent: {4}Ola Nowak/);
  assert.match(m.body, /Photos and details: https:\/\/app\.getelliot\.eu\/p\/L1/);
  assert.match(m.body, /Dzień dobry Don,/);
  assert.match(m.body, /Termin: {3}środa, 11 listopada 2026, 14:00–15:00/);
  assert.match(m.body, /Zdjęcia i szczegóły: https/);

  // No listing: still a clean email.
  const bare = decodeMail(run(nodeOf(wf12, 'Build Confirmation Email').parameters.jsCode, {
    json: { listing_link: null },
    nodes: {
      'Load Tenant + Contact Info': { timezone: 'Europe/Warsaw', tenant_name: 'Simon', contact_email: 'a@b.pl' },
      'When Executed by Another Workflow': { starts_at: '2026-11-11T13:00:00.000Z', ends_at: '2026-11-11T14:00:00.000Z' },
    },
  })[0].json.raw_message);
  assert.match(bare.body, /^Hi,/);
  assert.ok(!/Property:|Photos and details|undefined|null/.test(bare.body));

  // What Elliot is told.
  const result = nodeOf(wf12, 'Booking Result').parameters.jsCode;
  const booked = { success: true, appointment_id: 'a1' };
  const ok = run(result, { nodes: { 'Format Results': booked, 'Send Confirmation Email': { id: 'gm1' }, 'Build Confirmation Email': { to: 'don@example.pl' } } })[0].json;
  assert.deepStrictEqual(ok, { ...booked, confirmation_sent_to: 'don@example.pl', confirmation_to: 'don@example.pl', confirmation_error: null });
  const failed = run(result, { nodes: { 'Format Results': booked, 'Send Confirmation Email': { error: { message: 'quota' } }, 'Build Confirmation Email': { to: 'x' } } })[0].json;
  assert.strictEqual(failed.confirmation_sent_to, null);
  assert.strictEqual(failed.confirmation_error, 'quota');
  const skipped = run(result, { nodes: { 'Format Results': booked } })[0].json;
  assert.strictEqual(skipped.confirmation_sent_to, null);
  assert.strictEqual(skipped.success, true);
});

test('24: the hand-over email has the client, the summary and the conversation', () => {
  assert.match(nodeOf(wf24, 'Insert Escalation').parameters.query, /escalation_context\(\$1, \$2\) as context/);
  const out = run(nodeOf(wf24, 'Build Notification Email').parameters.jsCode, {
    json: {
      tenant_name: 'Simon Real Estate', notify_email: 'ola@simon.pl', escalation_id: 'e1',
      context: {
        channel: 'whatsapp', contact_name: 'Don', contact_phone: '+48601', contact_email: null,
        transcript: '09 Nov 16:13  Don: Do you have pictures?\n09 Nov 16:13  Elliot: I\'ve asked the team to send photos.',
      },
    },
    nodes: {
      'Validate And Default': {
        conversation_id: 'conv-1', reason: 'other', priority: 'normal',
        context_summary: 'Send photos of the studio at Płochocińska 16A/72 before the viewing on Wed 11 Nov at 14:00.',
      },
    },
  })[0].json;
  const m = decodeMail(out.raw_message);
  assert.strictEqual(m.subject, '[Elliot] Follow-up needed: Don');
  assert.match(m.body, /WHAT THEY NEED\nSend photos of the studio at Płochocińska 16A\/72/);
  assert.match(m.body, /Name: {4}Don\nPhone: {3}\+48601\nEmail: {3}not given\nChannel: WhatsApp/);
  assert.match(m.body, /\/dashboard\/conversations\/conv-1/);
  assert.match(m.body, /CONVERSATION SO FAR\n09 Nov 16:13 {2}Don: Do you have pictures\?/);
});

console.log(`\n${passed} passed`);
