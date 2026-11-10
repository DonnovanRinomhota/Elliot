// Tests for viewings linked to a listing and an agent (workflows 01 and 12 +
// migration 0030). Runs the Code nodes and expressions straight out of the
// workflow JSON, like the other tests here.
//
// Run: node n8n/workflows/tests/appointment_listing.test.js

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
    return { first: () => ({ json: v }), item: { json: v }, all: () => [{ json: v }] };
  };
}
function run(code, { json = {}, nodes = {} } = {}) {
  const item = { json };
  const $input = { first: () => item, all: () => [item] };
  return new Function('$input', '$json', '$', code)($input, json, stubs(nodes));
}
// Evaluates an n8n "={{ ... }}" expression.
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

test('01: book_appointment takes an optional listing_id and passes it to 12', () => {
  const body = nodeOf(wf01, 'Call Claude').parameters.jsonBody.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  const payload = JSON.parse(new Function('$json', '$', `return ${body}`)({ system_prompt: 's', claude_messages: [] }, () => ({ first: () => ({ json: { assistant_mode: 'agency' } }) })));
  const tool = payload.tools.find((t) => t.name === 'book_appointment');
  assert.ok(tool.input_schema.properties.listing_id, 'listing_id missing');
  assert.ok(!tool.input_schema.required.includes('listing_id'), 'listing_id must stay optional');

  const call = nodeOf(wf01, 'Execute: Book Appointment Sub-Workflow').parameters.workflowInputs;
  assert.ok(call.schema.some((s) => s.id === 'listing_id'));
  const nodes = { 'Extract Tool Call': { tool_input: { listing_id: 'abc' } } };
  assert.strictEqual(expr(call.value.listing_id, { nodes }), 'abc');
  assert.strictEqual(expr(call.value.listing_id, { nodes: { 'Extract Tool Call': { tool_input: {} } } }), '');

  const reference = JSON.parse(fs.readFileSync(path.join(WF_DIR, 'tool_schemas.json'), 'utf8'));
  const refTool = reference.tools.find((t) => t.name === 'book_appointment');
  assert.ok(refTool.input_schema.properties.listing_id, 'tool_schemas.json out of sync');
});

test('01: search results carry the listing_id, booking result names the property', () => {
  const code = nodeOf(wf01, 'Build Tool Result Message').parameters.jsCode;
  const base = {
    'Assemble Request': { claude_messages: [], tool_turns: 0 },
    'Call Claude': { content: [{ type: 'tool_use' }], usage: { input_tokens: 1, output_tokens: 1 } },
  };
  const found = run(code, {
    json: { result: { found: true, count: 1, listings: [{ listing_id: 'L-UUID-1', title: 'Flat', reference: 'W-1', transaction_type: 'sale', price: 1, currency: 'PLN' }] } },
    nodes: { ...base, 'Extract Tool Call': { tool_name: 'search_listings', tool_use_id: 't' } },
  })[0].json.claude_messages[1].content[0].content;
  assert.match(found, /listing_id: L-UUID-1 \(pass this to book_appointment/);

  const booked = run(code, {
    json: { success: true, appointment_id: 'a1', starts_at: 's', ends_at: 'e', status: 'confirmed', listing_title: 'Flat in Mokotów', listing_address: 'ul. Puławska 1, Mokotów, Warszawa' },
    nodes: { ...base, 'Extract Tool Call': { tool_name: 'book_appointment', tool_use_id: 't' } },
  })[0].json.claude_messages[1].content[0].content;
  assert.match(booked, /Property: Flat in Mokotów, ul\. Puławska 1, Mokotów, Warszawa\./);

  const plain = run(code, {
    json: { success: true, appointment_id: 'a1', starts_at: 's', ends_at: 'e', status: 'confirmed' },
    nodes: { ...base, 'Extract Tool Call': { tool_name: 'book_appointment', tool_use_id: 't' } },
  })[0].json.claude_messages[1].content[0].content;
  assert.ok(!/Property:/.test(plain));
});

test('12: lookup finds the listing by id or reference and the lead owner', () => {
  const load = nodeOf(wf12, 'Load Tenant + Contact Info');
  assert.strictEqual(load.credentials.postgres.name, 'Elliot Postgres (service role)');
  assert.match(load.parameters.query, /l\.id::text = \$3 or lower\(l\.reference\) = lower\(\$3\)/);
  assert.match(load.parameters.query, /ld\.assigned_to/);
  const params = expr(load.parameters.options.queryReplacement, { json: { tenant_id: 't', contact_id: 'c', listing_id: ' W-1 ' } });
  assert.deepStrictEqual(params, ['t', 'c', 'W-1', '', '', undefined, undefined]); // 0042: + starts_at, ends_at
  assert.deepStrictEqual(expr(load.parameters.options.queryReplacement, { json: { tenant_id: 't', contact_id: 'c', starts_at: 's', ends_at: 'e' } }), ['t', 'c', '', '', '', 's', 'e']);
});

test('12: calendar event has the property, address and agent', () => {
  const body = nodeOf(wf12, 'HTTP Request').parameters.jsonBody;
  const nodes = { 'When Executed by Another Workflow': { starts_at: '2026-12-01T09:00:00Z', ends_at: '2026-12-01T10:00:00Z', notes: 'Bring "keys"' } };
  const ev = JSON.parse(expr(body, {
    nodes,
    json: { timezone: 'Europe/Warsaw', contact_name: 'Anna', contact_email: 'anna@x.test', listing_title: 'Flat in Mokotów', listing_reference: 'W-1',
            listing_address: 'ul. Puławska 1, Mokotów, Warszawa', agent_email: 'ola@agency.test', agent_invite: 'ola@agency.test', agent_name: 'Ola Nowak' },
  }));
  assert.strictEqual(ev.summary, 'Property viewing — Anna — Flat in Mokotów');
  assert.strictEqual(ev.location, 'ul. Puławska 1, Mokotów, Warszawa');
  assert.match(ev.description, /^Property: Flat in Mokotów, ref W-1\nAddress: .+\nAgent: Ola Nowak\nBring "keys"$/);
  assert.deepStrictEqual(ev.attendees, [{ email: 'anna@x.test' }, { email: 'ola@agency.test' }]);
  assert.deepStrictEqual(ev.start, { dateTime: '2026-12-01T09:00:00Z', timeZone: 'Europe/Warsaw' });

  // No listing, no agent, no client email: still a valid event (quotes in notes no longer break the JSON).
  const bare = JSON.parse(expr(body, { nodes, json: { timezone: 'Europe/Warsaw', contact_name: 'Piotr' } }));
  assert.strictEqual(bare.summary, 'Property viewing — Piotr');
  assert.ok(!('location' in bare));
  assert.deepStrictEqual(bare.attendees, []);
});

test('12: insert stores the listing; result reports it', () => {
  const ins = nodeOf(wf12, 'Insert Appointment');
  assert.match(ins.parameters.query, /nullif\(\$8, ''\)::uuid/);
  const nodes = {
    'When Executed by Another Workflow': { tenant_id: 't', contact_id: 'c', starts_at: 's', ends_at: 'e', notes: '' },
    'Load Tenant + Contact Info': { timezone: 'Europe/Warsaw', listing_id: 'L1', listing_title: 'Flat', listing_address: 'ul. X 1' },
  };
  const params = expr(ins.parameters.options.queryReplacement, { nodes, json: { id: 'gcal1' } });
  assert.strictEqual(params.length, 12); // 0033: + conversation_id; 0034: + email; 0042: + agent, calendar
  assert.strictEqual(params[5], 'gcal1');
  assert.strictEqual(params[7], 'L1');
  nodes['Load Tenant + Contact Info'] = { timezone: 'UTC' };
  assert.strictEqual(expr(ins.parameters.options.queryReplacement, { nodes, json: { id: 'g' } })[7], '');

  const out = run(nodeOf(wf12, 'Format Results').parameters.jsCode, {
    json: { id: 'a1', starts_at: 's', ends_at: 'e', status: 'confirmed', listing_id: 'L1' },
    nodes: { 'Load Tenant + Contact Info': { listing_title: 'Flat', listing_address: 'ul. X 1' } },
  })[0].json;
  assert.strictEqual(out.listing_title, 'Flat');
  assert.strictEqual(out.listing_address, 'ul. X 1');
});

console.log(`\n${passed} passed`);
