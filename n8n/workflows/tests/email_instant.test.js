// Tests for email instant replies (0035): workflow 16 hands each email to
// Elliot (workflow 01) and sends Elliot's answer in the same Gmail thread,
// like WhatsApp. Runs the nodes' code and expressions out of the workflow JSON.
//
// Run: node n8n/workflows/tests/email_instant.test.js

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
function run(code, { json = {}, nodes = {}, vars = {}, execution = {} } = {}) {
  const item = { json };
  const $input = { first: () => item, all: () => [item] };
  return new Function('$input', '$json', '$', '$vars', '$env', '$execution', code)($input, json, stubs(nodes), vars, {}, execution);
}
function expr(value, { json = {}, nodes = {} } = {}) {
  const body = value.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  return new Function('$json', '$', `return (${body});`)(json, stubs(nodes));
}
const cond = (wf, name) => nodeOf(wf, name).parameters.conditions.conditions[0].leftValue;
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const wf16 = load('16-email-inbound-trigger.json');
const wf01 = load('01-main-ai-agent.json');
const SERVICE = 'Elliot Postgres (service role)';

const email = (over = {}) => ({
  id: '18f0a', threadId: 't-1', messageId: '<CAB123@mail.gmail.com>',
  from: { value: [{ address: 'Don@Example.com', name: ' Don Rino ' }] },
  to: { value: [{ address: 'someone@else.pl' }] },
  cc: { value: [{ address: 'Office@Simon.pl' }] },
  subject: 'Availability of studio on Płochocińska',
  text: 'Hi, is the studio still available? I could view it on Friday.\n\nOn Mon, 9 Nov 2026 at 17:00, Simon Real Estate <office@simon.pl>\nwrote:\n> Earlier message\n> more quoted',
  headers: {},
  ...over,
});
const extract = (over) => run(nodeOf(wf16, 'Extract Email Fields').parameters.jsCode, { json: email(over) })[0].json;

test('16: email goes to Elliot and the answer back by email (no more drafts)', () => {
  const names = wf16.nodes.map((n) => n.name);
  for (const gone of ['Execute: Classify Email', 'Execute: Draft Email Reply', 'Insert Inbound Message']) assert.ok(!names.includes(gone), gone);
  const chain = ['Gmail Trigger', 'Extract Email Fields', 'Should Process?', 'Lookup Tenant by Mailbox', 'If Tenant Found', 'If Not Self-Sent',
    'Claim Message', 'Is New Message?', 'Upsert Contact', 'Get or Create Conversation (Email)', 'Build Elliot Request', 'Ask Elliot', 'Read Elliot Answer'];
  for (let i = 0; i < chain.length - 1; i += 1) assert.ok(next(wf16, chain[i]).includes(chain[i + 1]), `${chain[i]} -> ${chain[i + 1]}`);
  assert.deepStrictEqual(next(wf16, 'If Tenant Found', 1), ['Log Unmatched Mailbox']);
  assert.deepStrictEqual(next(wf16, 'Read Elliot Answer'), ['Has Reply?', 'Elliot Failed?']);
  assert.deepStrictEqual(next(wf16, 'Has Reply?'), ['Build Reply Email']);
  assert.deepStrictEqual(next(wf16, 'Build Reply Email'), ['Send Reply via Gmail']);
  assert.deepStrictEqual(next(wf16, 'Send Reply via Gmail'), ['Check Send Result']);
  assert.deepStrictEqual(next(wf16, 'Send Failed?'), ['Log Send Failure']);
  for (const n of wf16.nodes.filter((x) => x.type === 'n8n-nodes-base.postgres')) assert.strictEqual(n.credentials?.postgres?.name, SERVICE, n.name);
  for (const [from, c] of Object.entries(wf16.connections)) {
    assert.ok(names.includes(from), from);
    for (const b of c.main) for (const t of b) assert.ok(names.includes(t.node), `${from} -> ${t.node}`);
  }
});

test('16: reads every recipient, the new part of a reply, and skips automatic email', () => {
  const e = extract();
  assert.strictEqual(e.skip, false);
  assert.strictEqual(e.from_email, 'don@example.com');
  assert.strictEqual(e.from_name, 'Don Rino');
  assert.deepStrictEqual(e.recipients, ['someone@else.pl', 'office@simon.pl']);
  assert.strictEqual(e.body, 'Hi, is the studio still available? I could view it on Friday.');
  assert.strictEqual(e.message, 'Subject: Availability of studio on Płochocińska\n\nHi, is the studio still available? I could view it on Friday.');
  assert.strictEqual(e.rfc_message_id, '<CAB123@mail.gmail.com>');
  assert.strictEqual(e.gmail_thread_id, 't-1');

  const re = extract({ subject: 'Re: Availability', text: 'Friday 14:00 works.\n\nW dniu pon., 9 lis 2026 o 17:00 Simon <o@s.pl> napisał(a):\n> old' });
  assert.strictEqual(re.message, 'Friday 14:00 works.', 'a reply: just the new text');
  const html = extract({ text: '', html: '<p>Is it&nbsp;free?</p><div>Thanks</div>' });
  assert.match(html.body, /Is it free\?\s*\n\s*Thanks/);
  assert.strictEqual(extract({ text: '', html: '', subject: 'Question about Mokotów' }).message, 'Subject: Question about Mokotów\n\nQuestion about Mokotów');

  assert.strictEqual(extract({ from: { value: [{ address: 'no-reply@portal.pl' }] } }).reason, 'automatic_sender');
  assert.strictEqual(extract({ from: { value: [{ address: 'MAILER-DAEMON@google.com' }] } }).reason, 'automatic_sender');
  assert.strictEqual(extract({ headers: { 'auto-submitted': 'auto-replied' } }).reason, 'auto_submitted');
  assert.strictEqual(extract({ headers: { 'auto-submitted': 'no' } }).skip, false);
  assert.strictEqual(extract({ headers: { 'list-unsubscribe': '<mailto:x>' } }).reason, 'mailing_list');
  assert.strictEqual(extract({ headerLines: [{ key: 'precedence', line: 'Precedence: bulk' }] }).reason, 'mailing_list');
  assert.strictEqual(extract({ subject: '', text: '' }).reason, 'empty');
  assert.strictEqual(expr(cond(wf16, 'Should Process?'), { json: { skip: false } }), true);
  assert.strictEqual(expr(cond(wf16, 'Should Process?'), { json: { skip: true } }), false);
});

test('16: the agency is found by any recipient, ignoring case; unknown mailboxes are logged', () => {
  const lk = nodeOf(wf16, 'Lookup Tenant by Mailbox');
  assert.strictEqual(lk.alwaysOutputData, true);
  assert.match(lk.parameters.query, /lower\(btrim\(ac\.connected_gmail_address\)\) = any\(\$1::text\[\]\)/);
  assert.match(lk.parameters.query, /t\.slug as tenant_slug/);
  assert.deepStrictEqual(expr(lk.parameters.options.queryReplacement, { json: { recipients: ['a@x.pl', 'office@simon.pl'] } }), ['{"a@x.pl","office@simon.pl"}']);
  assert.deepStrictEqual(expr(lk.parameters.options.queryReplacement, { json: { recipients: [] } }), ['{}']);
  assert.strictEqual(expr(cond(wf16, 'If Tenant Found'), { json: {} }), false);
  assert.strictEqual(expr(cond(wf16, 'If Not Self-Sent'), { json: { connected_gmail_address: ' Office@Simon.pl ' }, nodes: { 'Extract Email Fields': { from_email: 'office@simon.pl' } } }), false);
  assert.strictEqual(expr(cond(wf16, 'If Not Self-Sent'), { json: { connected_gmail_address: 'office@simon.pl' }, nodes: { 'Extract Email Fields': { from_email: 'don@x.pl' } } }), true);
  const log = nodeOf(wf16, 'Log Unmatched Mailbox').parameters;
  assert.match(log.query, /'email_unmatched_mailbox'/);
  const claim = nodeOf(wf16, 'Claim Message').parameters;
  assert.match(claim.query, /claim_whatsapp_message\(\$1, 'gmail:' \|\| \$2\)/);
});

test('16: Elliot is asked as an email conversation with the sender\'s email', () => {
  const nodes = {
    'Extract Email Fields': extract(),
    'Lookup Tenant by Mailbox': { tenant_id: 't', tenant_slug: 'simon' },
    'Upsert Contact': { id: 'c', name: null },
  };
  const out = run(nodeOf(wf16, 'Build Elliot Request').parameters.jsCode, { json: { id: 'conv' }, nodes, execution: { resumeUrl: 'https://makodevops.app.n8n.cloud/webhook-waiting/1' } })[0].json;
  assert.strictEqual(out.chat_url, 'https://makodevops.app.n8n.cloud/webhook/chat');
  assert.deepStrictEqual(out.request, {
    tenant_slug: 'simon',
    message: 'Subject: Availability of studio on Płochocińska\n\nHi, is the studio still available? I could view it on Friday.',
    conversation_id: 'conv',
    channel: 'email',
    contact: { name: 'Don Rino', email: 'don@example.com' },
  });
});

test('16: the reply goes in the same thread, as clean plain text, UTF-8', () => {
  const nodes = { 'Extract Email Fields': extract(), 'Lookup Tenant by Mailbox': { tenant_id: 't' } };
  const out = run(nodeOf(wf16, 'Build Reply Email').parameters.jsCode, {
    json: { conversation_id: 'conv', reply: 'Hi Don,\n\n**Studio, Płochocińska 16c/19** – 2300 PLN/month\nSee [the listing](https://x.pl/p/1)\n\nBest regards,\nSimon Real Estate' },
    nodes,
  })[0].json;
  assert.strictEqual(out.subject, 'Re: Availability of studio on Płochocińska');
  assert.strictEqual(out.thread_id, 't-1');
  assert.strictEqual(out.to, 'don@example.com');
  assert.strictEqual(out.text, 'Hi Don,\n\nStudio, Płochocińska 16c/19 – 2300 PLN/month\nSee the listing: https://x.pl/p/1\n\nBest regards,\nSimon Real Estate\n');
  const raw = fromB64url(out.raw_message);
  const [head, body] = raw.split('\r\n\r\n');
  assert.match(head, /^To: don@example\.com\r\n/);
  assert.match(head, /In-Reply-To: <CAB123@mail\.gmail\.com>\r\nReferences: <CAB123@mail\.gmail\.com>/);
  const subj = head.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1];
  assert.strictEqual(Buffer.from(subj, 'base64').toString('utf8'), 'Re: Availability of studio on Płochocińska');
  assert.strictEqual(Buffer.from(body, 'base64').toString('utf8'), out.text);
  const already = run(nodeOf(wf16, 'Build Reply Email').parameters.jsCode, { json: { reply: 'x' }, nodes: { ...nodes, 'Extract Email Fields': { ...extract(), subject: 'RE: Flat' } } })[0].json;
  assert.strictEqual(already.subject, 'RE: Flat');

  const send = nodeOf(wf16, 'Send Reply via Gmail');
  assert.strictEqual(send.parameters.nodeCredentialType, 'gmailOAuth2');
  assert.deepStrictEqual(JSON.parse(expr(send.parameters.jsonBody, { json: { raw_message: 'abc', thread_id: 't-1' } })), { raw: 'abc', threadId: 't-1' });
  assert.strictEqual(send.parameters.options.response.response.neverError, true);
});

test('16: team takeover, Elliot failures and Gmail refusals', () => {
  const read = nodeOf(wf16, 'Read Elliot Answer').parameters.jsCode;
  const nodes = { 'Build Elliot Request': { request: { conversation_id: 'conv' } } };
  assert.strictEqual(run(read, { json: { statusCode: 200, body: { reply: 'Hi' } }, nodes })[0].json.reply, 'Hi');
  const human = run(read, { json: { statusCode: 200, body: { reply: null, human: true } }, nodes })[0].json;
  assert.strictEqual(expr(cond(wf16, 'Has Reply?'), { json: human }), false);
  const broken = run(read, { json: { statusCode: 500, body: {} }, nodes })[0].json;
  assert.match(broken.reply, /Someone from our team will get back to you/);
  assert.strictEqual(expr(cond(wf16, 'Elliot Failed?'), { json: broken }), true);

  const check = nodeOf(wf16, 'Check Send Result').parameters.jsCode;
  const sent = { 'Build Reply Email': { tenant_id: 't', conversation_id: 'conv', to: 'don@x.pl' } };
  assert.strictEqual(run(check, { json: { statusCode: 200, body: { id: 'g1', threadId: 't-1' } }, nodes: sent })[0].json.ok, true);
  const refused = run(check, { json: { statusCode: 401, body: { error: { message: 'Invalid Credentials', code: 401 } } }, nodes: sent })[0].json;
  assert.deepStrictEqual([refused.ok, refused.error], [false, 'Invalid Credentials (code 401)']);
  assert.match(nodeOf(wf16, 'Log Send Failure').parameters.query, /log_reply_send_failure\(\$1, \$2::uuid, 'email', \$3, \$4::jsonb\)/);
});

test('01: email is a channel of its own: no details form, write an email', () => {
  const v = run(nodeOf(wf01, 'Validate Input').parameters.jsCode, { json: { body: { tenant_slug: 's', message: 'Hi', channel: 'email' } } })[0].json;
  assert.strictEqual(v.channel, 'email');
  const c = cond(wf01, 'Visitor Identified?');
  const em = { 'Merge Tenant Context': { channel: 'email' } };
  assert.strictEqual(expr(c, { json: { visitor: { ready: false, name: null, email: 'don@x.pl' } }, nodes: em }), true);
  assert.strictEqual(expr(c, { json: { visitor: { ready: false, name: null, email: null } }, nodes: em }), false);
  assert.strictEqual(expr(c, { json: { visitor: { ready: false, name: null, email: 'don@x.pl' } }, nodes: { 'Merge Tenant Context': { channel: 'chat_widget' } } }), false);

  const prompt = (channel, visitor) => run(nodeOf(wf01, 'Build Claude Request').parameters.jsCode, {
    nodes: {
      'Merge Tenant Context': { tenant_name: 'Simon Real Estate', tenant_industry: 'real estate', message: 'Hi', channel },
      'Load AI Config': {}, 'Load Conversation History': [], 'Identify Visitor': { visitor },
    },
  })[0].json.system_prompt;
  const p = prompt('email', { contact_id: 'c', name: 'Don', email: 'don@x.pl', ready: true });
  assert.match(p, /12\. The customer wrote by email, so their email address is already known \(below\): never ask for it, and pass it as email to book_appointment/);
  assert.match(p, /EMAIL: You are writing the body of an email reply/);
  assert.match(p, /End with "Best regards," \(or "Pozdrawiamy,"\) and Simon Real Estate on the next line/);
  assert.ok(!/WHATSAPP:/.test(p));
  assert.match(prompt('email', { contact_id: 'c', email: 'x@y.pl' }), /You don't know their name yet: ask for it once/);
  const wa = prompt('whatsapp', { contact_id: 'c', name: 'Don', phone: '+48', ready: true });
  assert.match(wa, /12\. The customer is writing on WhatsApp/);
  assert.ok(!/EMAIL:/.test(wa));
  assert.match(prompt('chat_widget', { contact_id: 'c', name: 'Don', ready: true }), /12\. The visitor gave their details before the chat started/);
});

console.log(`\n${passed} passed`);
