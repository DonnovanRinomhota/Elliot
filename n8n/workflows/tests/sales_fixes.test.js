// Tests for 0034, from the first real test chats: Elliot shows the closest
// options instead of "the team will be in touch", books for real and never
// claims a booking or email it didn't make, sends the confirmation to the
// email the client just gave, and knows the client's upcoming viewings.
//
// Run: node n8n/workflows/tests/sales_fixes.test.js

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
  const $input = { first: () => item, all: () => [item] };
  return new Function('$input', '$json', '$', code)($input, json, stubs(nodes));
}
function expr(value, { json = {}, nodes = {} } = {}) {
  const body = value.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  return new Function('$json', '$', `return (${body});`)(json, stubs(nodes));
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const wf01 = load('01-main-ai-agent.json');
const wf12 = load('12-book-appointment.json');
const DASH = 'https://elliot-real-estate-five.vercel.app';

const prompt = (visitor, channel = 'chat_widget') =>
  run(nodeOf(wf01, 'Build Claude Request').parameters.jsCode, {
    nodes: {
      'Merge Tenant Context': { tenant_name: 'Simon', tenant_industry: 'real estate', message: 'Hi', channel },
      'Load AI Config': {},
      'Load Conversation History': [],
      'Identify Visitor': { visitor },
    },
  })[0].json.system_prompt;

test('01: Elliot sells: search first, show the closest options, never just "the team will be in touch"', () => {
  const p = prompt({ contact_id: 'c', name: 'Jon', email: 'j@x.pl', ready: true });
  assert.match(p, /14\. Act like the agency's best salesperson/);
  assert.match(p, /Search first, ask later/);
  assert.match(p, /Never answer with only "the team will be in touch"/);
  assert.match(p, /If nothing matches exactly, search_listings gives you the closest available options: show them straight away/);
  assert.ok(!/If nothing matches, say so and ask whether they would consider/.test(p), 'old give-up wording removed');
  assert.ok(p.indexOf('14. Act') < p.indexOf('VISITOR:'));
});

test('01: Elliot books in the same reply and never claims a booking or email it did not make', () => {
  const p = prompt({ contact_id: 'c', name: 'Jon', ready: true }, 'whatsapp');
  assert.match(p, /call book_appointment in that same reply/);
  assert.match(p, /If they give a different email from the one on file, use the new one/);
  assert.match(p, /Never say a viewing is booked, confirmed or being arranged, and never mention a confirmation email, unless book_appointment returned success in this reply/);
  assert.match(p, /say the confirmation was emailed only if book_appointment says it was sent, and to which address/);

  const tools = nodeOf(wf01, 'Call Claude').parameters.jsonBody;
  assert.match(tools, /email: \{ type: 'string', description: 'The email address the visitor wants the confirmation sent to/);
  const reference = load('tool_schemas.json').tools.find((t) => t.name === 'book_appointment');
  assert.ok(reference.input_schema.properties.email, 'tool_schemas.json in sync');
  const ex = nodeOf(wf01, 'Execute: Book Appointment Sub-Workflow').parameters.workflowInputs;
  assert.strictEqual(expr(ex.value.email, { nodes: { 'Extract Tool Call': { tool_input: { email: 'new@x.pl' } } } }), 'new@x.pl');
  assert.strictEqual(expr(ex.value.email, { nodes: { 'Extract Tool Call': { tool_input: {} } } }), '');
  assert.ok(ex.schema.some((s) => s.id === 'email'));
});

test('01: Elliot knows the client\'s upcoming viewings and their links', () => {
  const p = prompt({
    contact_id: 'c', name: 'Don', phone: '+48601', ready: true,
    upcoming_viewings: [
      { when: 'Wed 11 Nov 2026, 14:00', title: 'Studio flat', address: 'Płochocińska 16A/72, Warszawa', listing_id: 'L1', url: null },
      { when: 'Fri 13 Nov 2026, 14:00', title: 'Studio', address: null, listing_id: 'L2', url: 'https://agency.pl/l2' },
      { when: 'Sat 14 Nov 2026, 10:00', title: null, address: null, listing_id: null, url: null },
    ],
  }, 'whatsapp');
  assert.match(p, /UPCOMING VIEWINGS \(already booked for this client; don't book them again unless asked, and when they ask for photos or details of one, send its link\)/);
  assert.match(p, new RegExp(`- Wed 11 Nov 2026, 14:00: Studio flat, Płochocińska 16A/72, Warszawa\\. Link with photos and details: ${DASH}/p/L1`));
  assert.match(p, /- Fri 13 Nov 2026, 14:00: Studio\. Link with photos and details: https:\/\/agency\.pl\/l2/);
  assert.match(p, /- Sat 14 Nov 2026, 10:00: viewing \(property not recorded\)\n/);
  const none = prompt({ contact_id: 'c', name: 'Don', ready: true });
  assert.ok(!/UPCOMING VIEWINGS/.test(none));
});

const resultText = (toolName, output) =>
  run(nodeOf(wf01, 'Build Tool Result Message').parameters.jsCode, {
    json: output,
    nodes: {
      'Assemble Request': { claude_messages: [], tool_turns: 0 },
      'Call Claude': { content: [] },
      'Extract Tool Call': { tool_name: toolName, tool_use_id: 't1' },
    },
  })[0].json.claude_messages[1].content[0].content;

test('01: no exact match: Elliot gets the closest options with links and is told to show them', () => {
  const text = resultText('search_listings', {
    result: {
      found: false, count: 0, listings: [],
      alternatives: [{ listing_id: 'L9', title: '2-room flat', transaction_type: 'rent', price: 5800, currency: 'PLN', address: 'Bukowińska 24D', district: 'Mokotów', city: 'Warszawa', photo_count: 4 }],
    },
  });
  assert.match(text, /^No exact match for those filters\. These are the closest available options -- show them now with their links/);
  assert.match(text, /Do not say the team will look for options instead/);
  assert.match(text, /For rent: 5800 PLN\/month/);
  assert.match(text, new RegExp(`Link \\(send this to the visitor\\): ${DASH}/p/L9`));
  const nothing = resultText('search_listings', { result: { listings: [], alternatives: [] } });
  assert.match(nothing, /nothing close either\. Do not invent any/);
  assert.match(nothing, /call escalate_to_human if they accept/);
});

test('01: a failed confirmation email is reported honestly', () => {
  const failed = resultText('book_appointment', {
    success: true, appointment_id: 'a1', starts_at: 's', ends_at: 'e', status: 'confirmed',
    confirmation_sent_to: null, confirmation_to: 'don@x.pl', confirmation_error: 'Insufficient Permission',
  });
  assert.match(failed, /The viewing IS booked, but the confirmation email to don@x\.pl could not be sent \(Insufficient Permission\)/);
  const failedBooking = resultText('book_appointment', { success: false, error: 'slot_unavailable' });
  assert.match(failedBooking, /^Booking failed: slot_unavailable/);
});

test('12: the email the client just gave is used for the confirmation and saved on their contact', () => {
  const lookup = nodeOf(wf12, 'Load Tenant + Contact Info').parameters.query;
  assert.match(lookup, /coalesce\(case when nullif\(btrim\(\$5\), ''\) ~ .* then lower\(btrim\(\$5\)\) end, c\.email\) as contact_email/);
  const ins = nodeOf(wf12, 'Insert Appointment').parameters;
  assert.match(ins.query, /with saved_email as \(\n {4}update contacts set email = \$10/);
  assert.match(ins.query, /not exists \(select 1 from contacts o where o\.tenant_id = \$1 and lower\(o\.email\) = \$10 and o\.id <> \$2\)/);
  const p = expr(ins.options.queryReplacement, {
    json: { id: 'g' },
    nodes: {
      'When Executed by Another Workflow': { tenant_id: 't', contact_id: 'c', starts_at: 's', ends_at: 'e' },
      'Load Tenant + Contact Info': { timezone: 'Europe/Warsaw', contact_email: 'new@x.pl' },
    },
  });
  assert.strictEqual(p.length, 10);
  assert.strictEqual(p[9], 'new@x.pl');
});

console.log(`\n${passed} passed`);
