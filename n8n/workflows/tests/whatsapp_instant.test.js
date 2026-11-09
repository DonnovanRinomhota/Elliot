// Tests for WhatsApp instant replies (0032): workflow 25 hands each message to
// Elliot (workflow 01) and sends the answer back on WhatsApp; workflow 32
// sends a team member's reply from the dashboard. Runs the nodes' code and
// expressions straight out of the workflow JSON.
//
// Run: node n8n/workflows/tests/whatsapp_instant.test.js

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

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const wf25 = load('25-whatsapp-inbound-trigger.json');
const wf01 = load('01-main-ai-agent.json');
const wf32 = load('32-send-whatsapp-message.json');
const SERVICE = 'Elliot Postgres (service role)';

const meta = (message, extra = {}) => ({
  body: {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: 'PN1' },
      contacts: [{ profile: { name: 'Tomek' }, wa_id: '48601234567' }],
      ...(message ? { messages: [{ from: '48601234567', id: 'wamid.1', timestamp: '1762682400', ...message }] } : {}),
      ...extra,
    } }] }],
  },
});
const extract = (message, extra) => run(nodeOf(wf25, 'Extract WhatsApp Fields').parameters.jsCode, { json: meta(message, extra) })[0].json;

test('25: the message goes to Elliot and the answer back to WhatsApp (no more drafts)', () => {
  const names = wf25.nodes.map((n) => n.name);
  for (const gone of ['Insert Inbound Message', 'Execute: Classify (reused)', 'Execute: Draft WhatsApp Reply']) {
    assert.ok(!names.includes(gone), `${gone} should be gone`);
  }
  assert.deepStrictEqual(next(wf25, 'WhatsApp Webhook (POST)'), ['Respond Ack', 'Verify Meta Signature']);
  assert.deepStrictEqual(next(wf25, 'Signature Valid?'), ['Extract WhatsApp Fields']);
  assert.deepStrictEqual(next(wf25, 'If Tenant Found', 0), ['Claim Message']);
  assert.deepStrictEqual(next(wf25, 'If Tenant Found', 1), ['Log Unmatched Number']);
  const chain = ['Claim Message', 'Is New Message?', 'Upsert Contact', 'Get or Create Conversation (WhatsApp)', 'Build Elliot Request', 'Ask Elliot', 'Read Elliot Answer'];
  for (let i = 0; i < chain.length - 1; i += 1) assert.deepStrictEqual(next(wf25, chain[i]), [chain[i + 1]], `${chain[i]} -> ${chain[i + 1]}`);
  assert.deepStrictEqual(next(wf25, 'Is New Message?', 1), []);
  assert.deepStrictEqual(next(wf25, 'Read Elliot Answer'), ['Has Reply?', 'Elliot Failed?']);
  assert.deepStrictEqual(next(wf25, 'Has Reply?'), ['Format for WhatsApp']);
  assert.deepStrictEqual(next(wf25, 'Format for WhatsApp'), ['Send WhatsApp Reply']);
  assert.deepStrictEqual(next(wf25, 'Send WhatsApp Reply'), ['Check Send Result']);
  assert.deepStrictEqual(next(wf25, 'Check Send Result'), ['Send Failed?']);
  assert.deepStrictEqual(next(wf25, 'Send Failed?'), ['Log Send Failure']);
  assert.deepStrictEqual(next(wf25, 'Elliot Failed?'), ['Log Elliot Failure']);
  for (const n of wf25.nodes.filter((x) => x.type === 'n8n-nodes-base.postgres')) {
    assert.strictEqual(n.credentials?.postgres?.name, SERVICE, `${n.name} uses the service role`);
  }
  // Every connection points at a real node.
  for (const [from, c] of Object.entries(wf25.connections)) {
    assert.ok(names.includes(from), from);
    for (const branch of c.main) for (const t of branch) assert.ok(names.includes(t.node), `${from} -> ${t.node}`);
  }
});

test('25: text, buttons and media become something Elliot can answer', () => {
  const t = extract({ type: 'text', text: { body: 'Czy macie mieszkanie 2-pokojowe?' } });
  assert.strictEqual(t.skip, false);
  assert.strictEqual(t.body, 'Czy macie mieszkanie 2-pokojowe?');
  assert.strictEqual(t.from_wa_id, '48601234567');
  assert.strictEqual(t.phone_number_id, 'PN1');
  assert.strictEqual(t.contact_name, 'Tomek');
  assert.strictEqual(t.wa_message_id, 'wamid.1');
  assert.strictEqual(t.message_timestamp, new Date(1762682400 * 1000).toISOString());

  assert.strictEqual(extract({ type: 'button', button: { text: 'Yes, book it' } }).body, 'Yes, book it');
  assert.strictEqual(extract({ type: 'interactive', interactive: { button_reply: { title: 'Tuesday 10:00' } } }).body, 'Tuesday 10:00');
  assert.strictEqual(extract({ type: 'interactive', interactive: { list_reply: { title: 'Mokotów' } } }).body, 'Mokotów');
  assert.strictEqual(extract({ type: 'image', image: { caption: ' Is this one free? ' } }).body, '[Sent a photo: Is this one free?]');
  assert.strictEqual(extract({ type: 'image', image: {} }).body, '[Sent a photo]');
  assert.strictEqual(extract({ type: 'audio', audio: { voice: true } }).body, '[Sent a voice message]');
  assert.strictEqual(extract({ type: 'document', document: { filename: 'umowa.pdf' } }).body, '[Sent a document (umowa.pdf)]');
  assert.strictEqual(
    extract({ type: 'location', location: { name: 'Biuro', address: 'Puławska 1', latitude: 52.2, longitude: 21.0 } }).body,
    '[Shared a location: Biuro, Puławska 1 (52.2, 21)]'
  );
  assert.match(extract({ type: 'unsupported' }).body, /^\[Sent a unsupported/);

  assert.strictEqual(extract({ type: 'reaction', reaction: { emoji: '👍' } }).skip, true);
  assert.strictEqual(extract({ type: 'text', text: { body: '   ' } }).skip, true);
  const status = extract(null, { statuses: [{ status: 'read' }] });
  assert.strictEqual(status.skip, true);
  assert.match(status.reason, /status_update/);
  assert.strictEqual(extract({ type: 'text', text: { body: 'x'.repeat(5000) } }).body.length, 4000);
});

test('25: unknown numbers are logged, repeats from Meta are ignored', () => {
  const lookup = nodeOf(wf25, 'Lookup Tenant by Phone Number Id');
  assert.strictEqual(lookup.alwaysOutputData, true);
  assert.match(lookup.parameters.query, /t\.slug as tenant_slug/);
  assert.match(lookup.parameters.query, /t\.status = 'active'/);
  assert.deepStrictEqual(expr(lookup.parameters.options.queryReplacement, { json: { phone_number_id: 'PN1' } }), ['PN1']);
  assert.strictEqual(expr(cond(wf25, 'If Tenant Found'), { json: { tenant_id: 't' } }), true);
  assert.strictEqual(expr(cond(wf25, 'If Tenant Found'), { json: {} }), false);

  const claim = nodeOf(wf25, 'Claim Message');
  assert.match(claim.parameters.query, /claim_whatsapp_message\(\$1, \$2\) as is_new/);
  assert.deepStrictEqual(
    expr(claim.parameters.options.queryReplacement, {
      nodes: { 'Lookup Tenant by Phone Number Id': { tenant_id: 't' }, 'Extract WhatsApp Fields': { wa_message_id: 'wamid.1' } },
    }),
    ['t', 'wamid.1']
  );
  assert.strictEqual(expr(cond(wf25, 'Is New Message?'), { json: { is_new: true } }), true);
  assert.strictEqual(expr(cond(wf25, 'Is New Message?'), { json: { is_new: false } }), false);
});

test('25: Elliot is asked at its own chat webhook, as a WhatsApp conversation', () => {
  const nodes = {
    'Extract WhatsApp Fields': { from_wa_id: '48601234567', body: 'Hi', contact_name: 'Tomek' },
    'Lookup Tenant by Phone Number Id': { tenant_id: 't', tenant_slug: 'simon' },
    'Upsert Contact': { id: 'c', name: 'Tomek', phone: '+48601234567' },
  };
  const out = run(nodeOf(wf25, 'Build Elliot Request').parameters.jsCode, {
    json: { id: 'conv' },
    nodes,
    execution: { resumeUrl: 'https://simon.app.n8n.cloud/webhook-waiting/123' },
  })[0].json;
  assert.strictEqual(out.chat_url, 'https://simon.app.n8n.cloud/webhook/chat');
  assert.deepStrictEqual(out.request, {
    tenant_slug: 'simon',
    message: 'Hi',
    conversation_id: 'conv',
    channel: 'whatsapp',
    contact: { name: 'Tomek', phone: '+48601234567' },
  });
  // A pasted / variable address wins; with neither, a clear error.
  const pasted = run(nodeOf(wf25, 'Build Elliot Request').parameters.jsCode, {
    json: { id: 'conv' }, nodes, vars: { ELLIOT_CHAT_WEBHOOK_URL: 'https://x.example/webhook/chat' }, execution: { resumeUrl: 'https://simon.app.n8n.cloud/webhook-waiting/1' },
  })[0].json;
  assert.strictEqual(pasted.chat_url, 'https://x.example/webhook/chat');
  assert.throws(() => run(nodeOf(wf25, 'Build Elliot Request').parameters.jsCode, { json: { id: 'conv' }, nodes }), /ELLIOT_CHAT_WEBHOOK_URL/);
  // No name yet: none sent (Elliot asks for it in the chat), phone from WhatsApp.
  const noName = run(nodeOf(wf25, 'Build Elliot Request').parameters.jsCode, {
    json: { id: 'conv' },
    nodes: { ...nodes, 'Upsert Contact': { id: 'c', name: null, phone: null } },
    execution: { resumeUrl: 'https://simon.app.n8n.cloud/webhook-waiting/1' },
  })[0].json;
  assert.deepStrictEqual(noName.request.contact, { name: null, phone: '+48601234567' });

  const ask = nodeOf(wf25, 'Ask Elliot').parameters;
  assert.strictEqual(ask.method, 'POST');
  assert.strictEqual(ask.options.response.response.neverError, true);
  assert.strictEqual(ask.options.response.response.fullResponse, true);
  assert.ok(ask.options.timeout >= 60000);
  assert.deepStrictEqual(JSON.parse(expr(ask.jsonBody, { json: out })), out.request);
});

test('25: Elliot\'s answer: reply, team member handling, or a holding message when it fails', () => {
  const code = nodeOf(wf25, 'Read Elliot Answer').parameters.jsCode;
  const nodes = { 'Build Elliot Request': { request: { conversation_id: 'conv', tenant_slug: 'simon' } } };
  const ok = run(code, { json: { statusCode: 200, body: { conversation_id: 'conv', reply: ' Hello Tomek! ' } }, nodes })[0].json;
  assert.strictEqual(ok.reply, 'Hello Tomek!');
  assert.strictEqual(ok.elliot_error, null);
  const asText = run(code, { json: { statusCode: 200, body: JSON.stringify({ reply: 'Hi' }) }, nodes })[0].json;
  assert.strictEqual(asText.reply, 'Hi');

  const human = run(code, { json: { statusCode: 200, body: { reply: null, human: true } }, nodes })[0].json;
  assert.strictEqual(human.human, true);
  assert.strictEqual(human.reply, '');
  assert.strictEqual(expr(cond(wf25, 'Has Reply?'), { json: human }), false);
  assert.strictEqual(expr(cond(wf25, 'Elliot Failed?'), { json: human }), false);

  const broken = run(code, { json: { statusCode: 500, body: { message: 'Error in workflow' } }, nodes })[0].json;
  assert.match(broken.reply, /Someone from our team will get back to you/);
  assert.match(broken.elliot_error, /HTTP 500/);
  assert.strictEqual(expr(cond(wf25, 'Has Reply?'), { json: broken }), true);
  assert.strictEqual(expr(cond(wf25, 'Elliot Failed?'), { json: broken }), true);

  const empty = run(code, { json: { statusCode: 200, body: { reply: '' } }, nodes })[0].json;
  assert.match(empty.elliot_error, /empty reply/);

  const log = nodeOf(wf25, 'Log Elliot Failure');
  assert.match(log.parameters.query, /'whatsapp_elliot_failed'/);
  const p = expr(log.parameters.options.queryReplacement, { json: broken, nodes: { 'Lookup Tenant by Phone Number Id': { tenant_id: 't' } } });
  assert.strictEqual(p[0], 't');
  assert.deepStrictEqual(JSON.parse(p[1]), { conversation_id: 'conv', error: 'Elliot answered with HTTP 500' });
});

test('25: Markdown is turned into WhatsApp formatting', () => {
  const code = nodeOf(wf25, 'Format for WhatsApp').parameters.jsCode;
  const nodes = {
    'Extract WhatsApp Fields': { from_wa_id: '48601234567', phone_number_id: 'PN1' },
    'Lookup Tenant by Phone Number Id': { tenant_id: 't', whatsapp_phone_number_id: 'PN1' },
  };
  const md = '## Flats\n\n**Mokotów, 2 rooms** – 3 200 PLN\n- 48 m²\n* balcony\n\n\n\nSee [the listing](https://agency.pl/l/1) or https://agency.pl/l/2 and [https://a.pl](https://a.pl)';
  const out = run(code, { json: { reply: md, conversation_id: 'conv' }, nodes })[0].json;
  assert.strictEqual(
    out.text,
    'Flats\n\n*Mokotów, 2 rooms* – 3 200 PLN\n• 48 m²\n• balcony\n\nSee the listing: https://agency.pl/l/1 or https://agency.pl/l/2 and https://a.pl'
  );
  assert.deepStrictEqual({ ...out, text: undefined }, { tenant_id: 't', conversation_id: 'conv', phone_number_id: 'PN1', to: '48601234567', text: undefined });
  const long = run(code, { json: { reply: 'a'.repeat(5000) }, nodes })[0].json;
  assert.strictEqual(long.text.length, 4096);
  assert.ok(long.text.endsWith('...'));
});

test('25: the reply is sent with the WhatsApp token; a refusal is logged for the team', () => {
  const send = nodeOf(wf25, 'Send WhatsApp Reply');
  assert.strictEqual(send.credentials.httpHeaderAuth.name, 'WhatsApp Cloud API token');
  assert.strictEqual(expr(send.parameters.url, { json: { phone_number_id: 'PN1' } }), 'https://graph.facebook.com/v20.0/PN1/messages');
  assert.deepStrictEqual(JSON.parse(expr(send.parameters.jsonBody, { json: { to: '48601', text: 'Hi' } })), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '48601', type: 'text', text: { preview_url: true, body: 'Hi' },
  });
  assert.strictEqual(send.parameters.options.response.response.neverError, true);

  const code = nodeOf(wf25, 'Check Send Result').parameters.jsCode;
  const nodes = { 'Format for WhatsApp': { tenant_id: 't', conversation_id: 'conv', to: '48601' } };
  const ok = run(code, { json: { statusCode: 200, body: { messages: [{ id: 'wamid.out' }] } }, nodes })[0].json;
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.wa_message_id, 'wamid.out');
  assert.strictEqual(expr(cond(wf25, 'Send Failed?'), { json: ok }), false);

  const refused = run(code, { json: { statusCode: 400, body: { error: { message: 'Re-engagement message', code: 131047 } } }, nodes })[0].json;
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.error, 'Re-engagement message (code 131047)');
  assert.strictEqual(expr(cond(wf25, 'Send Failed?'), { json: refused }), true);
  const down = run(code, { json: { statusCode: 0 }, nodes })[0].json;
  assert.strictEqual(down.error, 'WhatsApp API answered with HTTP no response');

  const log = nodeOf(wf25, 'Log Send Failure');
  assert.match(log.parameters.query, /log_whatsapp_send_failure\(\$1, \$2::uuid, \$3, \$4::jsonb\)/);
  const p = expr(log.parameters.options.queryReplacement, { json: refused });
  assert.deepStrictEqual(p.slice(0, 3), ['t', 'conv', 'Re-engagement message (code 131047)']);
  assert.deepStrictEqual(JSON.parse(p[3]), { status: 400, to: '48601' });
});

test('25: the Meta signature check and verify handshake are unchanged', () => {
  assert.match(nodeOf(wf25, 'Verify Meta Signature').parameters.jsCode, /PASTE_META_APP_SECRET_HERE/);
  assert.match(nodeOf(wf25, 'Check Verify Token').parameters.jsCode, /PASTE_WHATSAPP_VERIFY_TOKEN_HERE/);
  assert.strictEqual(nodeOf(wf25, 'WhatsApp Webhook (POST)').parameters.options.rawBody, true);
});

test('01: a WhatsApp chat needs no form, and Elliot is told it is on WhatsApp', () => {
  const v = run(nodeOf(wf01, 'Validate Input').parameters.jsCode, { json: { body: { tenant_slug: 's', message: 'Hi', channel: 'whatsapp' } } })[0].json;
  assert.strictEqual(v.channel, 'whatsapp');
  const w = run(nodeOf(wf01, 'Validate Input').parameters.jsCode, { json: { body: { tenant_slug: 's', message: 'Hi', channel: 'sms' } } })[0].json;
  assert.strictEqual(w.channel, 'chat_widget');

  const c = cond(wf01, 'Visitor Identified?');
  const wa = { 'Merge Tenant Context': { channel: 'whatsapp' } };
  const web = { 'Merge Tenant Context': { channel: 'chat_widget' } };
  assert.strictEqual(expr(c, { json: { visitor: { ready: false, name: null, phone: '+48601' } }, nodes: wa }), true);
  assert.strictEqual(expr(c, { json: { visitor: { ready: false, name: null, phone: null } }, nodes: wa }), false);
  assert.strictEqual(expr(c, { json: { visitor: { ready: false, name: null, phone: '+48601' } }, nodes: web }), false);

  const prompt = (channel, visitor) =>
    run(nodeOf(wf01, 'Build Claude Request').parameters.jsCode, {
      nodes: {
        'Merge Tenant Context': { tenant_name: 'Simon', tenant_industry: 'real estate', message: 'Hi', channel },
        'Load AI Config': {},
        'Load Conversation History': [],
        'Identify Visitor': { visitor },
      },
    })[0].json.system_prompt;
  const named = prompt('whatsapp', { contact_id: 'c-1', name: 'Tomek', phone: '+48601', ready: true });
  assert.match(named, /writing on WhatsApp/);
  assert.match(named, /never ask for it/);
  assert.match(named, /Address them by first name/);
  assert.match(named, /contact_id is c-1/);
  assert.match(named, /WHATSAPP: Keep replies short/);
  assert.ok(!/Don't ask for them again/.test(named));
  const unnamed = prompt('whatsapp', { contact_id: 'c-1', name: null, phone: '+48601', ready: false });
  assert.match(unnamed, /You don't know their name yet: ask for it once/);
  const website = prompt('chat_widget', { contact_id: 'c-1', name: 'Anna', email: 'a@x.pl', ready: true });
  assert.match(website, /Don't ask for them again/);
  assert.ok(!/WHATSAPP:/.test(website));
});

test('32: a team member\'s reply is checked, then sent on WhatsApp', () => {
  const hook = nodeOf(wf32, 'Send WhatsApp Message Webhook');
  assert.strictEqual(hook.parameters.authentication, 'headerAuth');
  assert.strictEqual(hook.credentials.httpHeaderAuth.name, 'Elliot Internal Webhook Secret');
  assert.strictEqual(hook.parameters.path, 'send-whatsapp-message');

  const validate = nodeOf(wf32, 'Validate Input').parameters.jsCode;
  const uuid = '11111111-1111-1111-1111-111111111111';
  const good = run(validate, { json: { body: { tenant_id: uuid, conversation_id: uuid, content: '  Hi there  ' } } })[0].json;
  assert.deepStrictEqual(good, { tenant_id: uuid, conversation_id: uuid, content: 'Hi there' });
  assert.throws(() => run(validate, { json: { body: { tenant_id: 'x', conversation_id: uuid, content: 'Hi' } } }), /tenant_id/);
  assert.throws(() => run(validate, { json: { body: { tenant_id: uuid, conversation_id: uuid, content: '  ' } } }), /content/);
  assert.throws(() => run(validate, { json: { body: { tenant_id: uuid, conversation_id: uuid, content: 'x'.repeat(4097) } } }), /4096/);

  const load32 = nodeOf(wf32, 'Load Conversation');
  assert.strictEqual(load32.credentials.postgres.name, SERVICE);
  assert.match(load32.parameters.query, /c\.channel = 'whatsapp'/);
  assert.match(load32.parameters.query, /c\.tenant_id = \$2::uuid/);

  const check = nodeOf(wf32, 'Check Conversation').parameters.jsCode;
  const nodes = { 'Validate Input': { tenant_id: 't', conversation_id: 'conv', content: 'Hi' } };
  const now = Date.now();
  const okRow = { conversation_id: 'conv', phone: '+48 601 234 567', phone_number_id: 'PN1', last_inbound_at: new Date(now - 3600e3).toISOString() };
  const ok = run(check, { json: okRow, nodes })[0].json;
  assert.deepStrictEqual({ ok: ok.ok, to: ok.to, phone_number_id: ok.phone_number_id, text: ok.text }, { ok: true, to: '48601234567', phone_number_id: 'PN1', text: 'Hi' });
  const missing = run(check, { json: {}, nodes })[0].json;
  assert.deepStrictEqual([missing.ok, missing.code], [false, 404]);
  const noNumber = run(check, { json: { ...okRow, phone_number_id: null }, nodes })[0].json;
  assert.deepStrictEqual([noNumber.ok, noNumber.code], [false, 422]);
  assert.match(noNumber.error, /Settings/);
  const noPhone = run(check, { json: { ...okRow, phone: null }, nodes })[0].json;
  assert.strictEqual(noPhone.code, 422);
  const late = run(check, { json: { ...okRow, last_inbound_at: new Date(now - 25 * 3600e3).toISOString() }, nodes })[0].json;
  assert.deepStrictEqual([late.ok, late.code], [false, 409]);
  assert.match(late.error, /24 hours/);
  const never = run(check, { json: { ...okRow, last_inbound_at: null }, nodes })[0].json;
  assert.strictEqual(never.code, 409);

  const send = nodeOf(wf32, 'Send via WhatsApp API');
  assert.strictEqual(send.credentials.httpHeaderAuth.name, 'WhatsApp Cloud API token');
  assert.strictEqual(send.parameters.options.response.response.neverError, true);
  const result = nodeOf(wf32, 'Send Result').parameters.jsCode;
  const sent = run(result, { json: { statusCode: 200, body: { messages: [{ id: 'wamid.9' }] } } })[0].json;
  assert.deepStrictEqual(sent, { code: 200, response: { success: true, wa_message_id: 'wamid.9' } });
  const refused = run(result, { json: { statusCode: 401, body: { error: { message: 'Invalid OAuth access token', code: 190 } } } })[0].json;
  assert.deepStrictEqual(refused, { code: 502, response: { success: false, error: 'WhatsApp refused the message: Invalid OAuth access token (code 190)' } });

  assert.deepStrictEqual(next(wf32, 'Can Send?', 0), ['Send via WhatsApp API']);
  assert.deepStrictEqual(next(wf32, 'Can Send?', 1), ['Respond Error']);
  const err = expr(nodeOf(wf32, 'Respond Error').parameters.responseBody, { json: late });
  assert.deepStrictEqual(JSON.parse(err), { success: false, error: late.error });
});

console.log(`\n${passed} passed`);
