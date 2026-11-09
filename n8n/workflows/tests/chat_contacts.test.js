// Tests for the chat-contact changes (migration 0031): visitor messages saved
// once, website chats needing a name + email/phone, contacts linked to their
// conversations, and names for email / WhatsApp drafts. Runs the nodes'
// code and expressions straight out of the workflow JSON.
//
// Run: node n8n/workflows/tests/chat_contacts.test.js

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

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const wf01 = load('01-main-ai-agent.json');
const SERVICE = 'Elliot Postgres (service role)';

test('01: the visitor message is saved once, not once per history row', () => {
  const log = nodeOf(wf01, 'Log User Message');
  assert.strictEqual(log.executeOnce, true);
  assert.deepStrictEqual(next(wf01, 'Load Conversation History'), ['Log User Message']);
  // History no longer follows Get or Create directly, so it must name it.
  const params = expr(nodeOf(wf01, 'Load Conversation History').parameters.options.queryReplacement, {
    json: { visitor: {} },
    nodes: { 'Merge Tenant Context': { tenant_id: 't' }, 'Get or Create Conversation': { conversation_id: 'conv' } },
  });
  assert.deepStrictEqual(params, ['t', 'conv']);
});

test('01: no answer until the visitor has given a name and an email or phone', () => {
  assert.deepStrictEqual(next(wf01, 'Get or Create Conversation'), ['Identify Visitor']);
  assert.deepStrictEqual(next(wf01, 'Identify Visitor'), ['Visitor Identified?']);
  assert.deepStrictEqual(next(wf01, 'Visitor Identified?', 0), ['Load Conversation History']);
  assert.deepStrictEqual(next(wf01, 'Visitor Identified?', 1), ['Respond: Ask For Details']);

  const ident = nodeOf(wf01, 'Identify Visitor');
  assert.strictEqual(ident.credentials.postgres.name, SERVICE);
  assert.match(ident.parameters.query, /identify_chat_visitor\(\$1, \$2::uuid, \$3, \$4, \$5\)/);
  const params = expr(ident.parameters.options.queryReplacement, {
    nodes: {
      'Merge Tenant Context': { tenant_id: 't', contact_name: 'Anna', contact_email: 'a@x.pl', contact_phone: null },
      'Get or Create Conversation': { conversation_id: 'conv' },
    },
  });
  assert.deepStrictEqual(params, ['t', 'conv', 'Anna', 'a@x.pl', '']);

  const cond = nodeOf(wf01, 'Visitor Identified?').parameters.conditions.conditions[0].leftValue;
  const web = { 'Merge Tenant Context': { channel: 'chat_widget' } };
  assert.strictEqual(expr(cond, { json: { visitor: { ready: true } }, nodes: web }), true);
  assert.strictEqual(expr(cond, { json: { visitor: { ready: false, phone: '+48601' } }, nodes: web }), false);
  assert.ok(!expr(cond, { json: {}, nodes: web }));

  const body = expr(nodeOf(wf01, 'Respond: Ask For Details').parameters.responseBody, {
    nodes: { 'Get or Create Conversation': { conversation_id: 'conv' } },
  });
  assert.strictEqual(body.needs_contact, true);
  assert.strictEqual(body.conversation_id, 'conv');
  assert.match(body.reply, /name and an email address or phone number/);
});

test('01: Elliot is told who the visitor is and their contact_id', () => {
  const out = run(nodeOf(wf01, 'Build Claude Request').parameters.jsCode, {
    nodes: {
      'Merge Tenant Context': { tenant_name: 'Simon', tenant_industry: 'real estate', message: 'Hi' },
      'Load AI Config': {},
      'Load Conversation History': [],
      'Identify Visitor': { visitor: { contact_id: 'c-1', name: 'Anna Kowalska', email: 'anna@x.pl', phone: null, ready: true } },
    },
  })[0].json;
  assert.match(out.system_prompt, /VISITOR:\nName: Anna Kowalska\nEmail: anna@x\.pl\n/);
  assert.match(out.system_prompt, /contact_id is c-1/);
  assert.match(out.system_prompt, /Don't ask for them again/);
  assert.ok(!/Phone:/.test(out.system_prompt));
  assert.deepStrictEqual(out.claude_messages, [{ role: 'user', content: 'Hi' }]);
});

test('10: lead capture saves the contact through the shared function and links the chat', () => {
  const up = nodeOf(load('10-lead-capture.json'), 'Upsert Contact');
  assert.strictEqual(up.credentials.postgres.name, SERVICE);
  assert.match(up.parameters.query, /upsert_conversation_contact\(\$1, nullif\(\$7, ''\)::uuid, \$2, \$3, \$4, \$5, \$6\) as id/);
  assert.ok(!/insert into contacts/i.test(up.parameters.query));
  const p = expr(up.parameters.options.queryReplacement, {
    json: { tenant_id: 't', conversation_id: 'conv', contact: { name: 'Anna', email: 'a@x.pl' }, source: 'chat_widget' },
  });
  assert.deepStrictEqual(p, ['t', 'Anna', 'a@x.pl', '', '', 'chat_widget', 'conv']);
});

test('16: the email sender\'s display name is saved', () => {
  const wf = load('16-email-inbound-trigger.json');
  const out = run(nodeOf(wf, 'Extract Email Fields').parameters.jsCode, {
    json: { from: { value: [{ address: 'anna@x.pl', name: ' Anna Kowalska ' }] }, to: { value: [{ address: 'office@agency.pl' }] }, subject: 'Flat', text: 'Hello', id: 'm1', threadId: 't1' },
  })[0].json;
  assert.strictEqual(out.from_name, 'Anna Kowalska');
  assert.strictEqual(out.from_email, 'anna@x.pl');
  const noName = run(nodeOf(wf, 'Extract Email Fields').parameters.jsCode, { json: { from: { value: [{ address: 'b@x.pl' }] } } })[0].json;
  assert.strictEqual(noName.from_name, '');

  const up = nodeOf(wf, 'Upsert Contact');
  assert.match(up.parameters.query, /select \* from upsert_conversation_contact_row\(\$1, null, \$3, \$2, null, null, 'email'\)/);
  const p = expr(up.parameters.options.queryReplacement, {
    nodes: { 'Lookup Tenant by Mailbox': { tenant_id: 't' }, 'Extract Email Fields': { from_email: 'anna@x.pl', from_name: 'Anna Kowalska' } },
  });
  assert.deepStrictEqual(p, ['t', 'anna@x.pl', 'Anna Kowalska']);
  // 0035: emails go to Elliot (01) instead of a draft; see email_instant.test.js.
});

test('25: WhatsApp contacts are matched by phone in any format; saved with a +', () => {
  const wf = load('25-whatsapp-inbound-trigger.json');
  const up = nodeOf(wf, 'Upsert Contact');
  // queryReplacement is [tenant_id, from_wa_id, contact_name]
  assert.match(up.parameters.query, /select \* from upsert_conversation_contact_row\(\$1, null, \$3, null, \$2, null, 'whatsapp'\)/);
  assert.ok(!/insert into contacts/i.test(up.parameters.query));
  // 0032: the number is saved with a '+', and the contact's name goes on to Elliot.
  const p = expr(up.parameters.options.queryReplacement, {
    nodes: { 'Lookup Tenant by Phone Number Id': { tenant_id: 't' }, 'Extract WhatsApp Fields': { from_wa_id: '48601234567', contact_name: 'Tomek' } },
  });
  assert.deepStrictEqual(p, ['t', '+48601234567', 'Tomek']);
});

test('14 + 26: drafts greet by name, or ask for the name when it is unknown', () => {
  for (const file of ['14-draft-email-reply.json', '26-draft-whatsapp-reply.json']) {
    const wf = load(file);
    const trig = wf.nodes.find((n) => n.type.endsWith('executeWorkflowTrigger'));
    assert.ok(trig.parameters.workflowInputs.values.some((v) => v.name === 'contact_name'), `${file}: contact_name input`);
    for (const name of ['Build FAQ Draft Prompt', 'Build Generic Draft Prompt', 'Build Scheduling Prompt']) {
      const code = nodeOf(wf, name).parameters.jsCode;
      const nodes = (contact_name) => ({
        'When Executed by Another Workflow': { subject: 'Viewing', body: 'Hi, is it available?', category: 'general', contact_name },
        'Execute: Check Availability': { available_slots: [] },
        'Get Recent Messages': [],
      });
      const known = run(code, { json: { retrieval: { found: false } }, nodes: nodes('Anna Kowalska') })[0].json.prompt;
      assert.match(known, /The customer's name is Anna Kowalska; greet them by name\./, `${file} ${name}`);
      const unknown = run(code, { json: { retrieval: { found: false } }, nodes: nodes('') })[0].json.prompt;
      assert.match(unknown, /politely asking for their full name/, `${file} ${name}`);
      assert.ok(unknown.indexOf('full name') < unknown.indexOf('Respond with ONLY'), 'instruction comes before the output format');
    }
  }
});

console.log(`\n${passed} passed`);
