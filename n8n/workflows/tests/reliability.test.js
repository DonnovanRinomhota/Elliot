// Tests for the reliability changes that go with migration 0048:
//  - 01: Claude is retried; if it still can't be reached the client gets a
//    holding reply and the team an escalation; a tool that crashes no longer
//    crashes Elliot, is never reported as done, and is logged;
//  - 20: a follow-up step is claimed and its run moved on in the database,
//    so no step can be sent twice;
//  - 23: CRM retries are spaced out by the database;
//  - 25: WhatsApp messages Meta reports as not delivered are recorded, and
//    extra messages in one delivery are counted instead of vanishing;
//  - 39: every email carries an Idempotency-Key, so a retry can't send it twice;
//  - calls that are safe to repeat are retried; calls that send something are not.
// Runs the nodes' code and expressions straight out of the workflow JSON.
//
// Run: node n8n/workflows/tests/reliability.test.js

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
const has = (wf, name) => wf.nodes.some((x) => x.name === name);
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
const wf20 = load('20-follow-up-sweep.json');
const wf23 = load('23-crm-sync-sweep.json');
const wf25 = load('25-whatsapp-inbound-trigger.json');
const wf39 = load('39-send-email.json');

// ───────────── 01: Claude can't be reached ─────────────
test('01: Claude is retried, and a final failure goes to "Elliot Unavailable" instead of crashing', () => {
  const claude = nodeOf(wf01, 'Call Claude');
  assert.strictEqual(claude.retryOnFail, true);
  assert.strictEqual(claude.maxTries, 3);
  assert.ok(claude.waitBetweenTries >= 1000 && claude.waitBetweenTries <= 5000, 'n8n allows at most 5 s between tries');
  assert.ok(claude.parameters.options.timeout >= 30000 && claude.parameters.options.timeout <= 60000);
  // Worst case (every try hangs) stays close to what the channel workflows wait for (120 s each try is too long).
  assert.ok(claude.maxTries * claude.parameters.options.timeout + (claude.maxTries - 1) * claude.waitBetweenTries <= 150000);
  assert.strictEqual(claude.onError, 'continueErrorOutput');
  assert.deepStrictEqual(next(wf01, 'Call Claude', 0), ['Did Claude Request a Tool?']);
  assert.deepStrictEqual(next(wf01, 'Call Claude', 1), ['Elliot Unavailable']);
  assert.deepStrictEqual(next(wf01, 'Elliot Unavailable'), ['Record Elliot Failure']);
  assert.deepStrictEqual(next(wf01, 'Record Elliot Failure'), ['Respond: Elliot Unavailable']);
  // If the database is down too, the client still gets the reply.
  assert.strictEqual(nodeOf(wf01, 'Record Elliot Failure').onError, 'continueRegularOutput');
  assert.strictEqual(nodeOf(wf01, 'Record Elliot Failure').alwaysOutputData, true);
});

const unavailable = (input, ctx) => run(nodeOf(wf01, 'Elliot Unavailable').parameters.jsCode, {
  json: input,
  nodes: { 'Merge Tenant Context': { tenant_id: 't1', channel: 'whatsapp', message: 'Is the flat on Oak Street still available?', ...ctx },
    'Get or Create Conversation': { conversation_id: 'conv1' } },
})[0].json;

test('01: the holding reply is in the client\'s language and promises only what happens', () => {
  const en = unavailable({ error: { message: 'Overloaded', httpCode: '529' } });
  assert.deepStrictEqual([en.tenant_id, en.conversation_id, en.channel], ['t1', 'conv1', 'whatsapp']);
  assert.strictEqual(en.error, 'Claude: Overloaded');
  assert.match(en.reply, /^Sorry, I can't answer right now\. .*someone will get back to you/);
  const pl = unavailable({ error: 'timeout of 45000ms exceeded' }, { message: 'Dzień dobry, czy mieszkanie jest jeszcze dostępne?' });
  assert.match(pl.reply, /^Przepraszamy/);
  assert.strictEqual(pl.error, 'Claude: timeout of 45000ms exceeded');
  // Odd error shapes never break it; long errors are cut.
  assert.strictEqual(unavailable({}).error, 'Claude: no response');
  assert.strictEqual(unavailable({ message: 'socket hang up' }).error, 'Claude: socket hang up');
  assert.ok(unavailable({ error: { message: 'x'.repeat(5000) } }).error.length <= 400);
  assert.strictEqual(unavailable({ error: 'e' }, { channel: undefined }).channel, 'chat_widget');
});

test('01: the failure is recorded and answered with HTTP 200, so channels deliver the holding reply', () => {
  const rec = nodeOf(wf01, 'Record Elliot Failure');
  assert.match(rec.parameters.query, /select record_elliot_failure\(\$1::uuid, nullif\(\$2, ''\)::uuid, \$3, \$4, \$5\)/);
  const out = unavailable({ error: 'boom' });
  assert.deepStrictEqual(expr(rec.parameters.options.queryReplacement, { json: out }), ['t1', 'conv1', 'whatsapp', 'Claude: boom', out.reply]);
  assert.deepStrictEqual(expr(rec.parameters.options.queryReplacement, { json: { ...out, conversation_id: null } })[1], '');
  const respond = nodeOf(wf01, 'Respond: Elliot Unavailable');
  assert.strictEqual(respond.type, 'n8n-nodes-base.respondToWebhook');
  assert.ok(!respond.parameters.options.responseCode, 'default 200');
  assert.deepStrictEqual(expr(respond.parameters.responseBody, { nodes: { 'Elliot Unavailable': out } }),
    { conversation_id: 'conv1', reply: out.reply, degraded: true });
});

// ───────────── 01: a tool crashes ─────────────
const TOOL_NODES = ['Execute: Knowledge Retrieval Sub-Workflow', 'Execute: Lead Capture Sub-Workflow', 'Execute: Check Availability Sub-Workflow',
  'Execute: Book Appointment Sub-Workflow', 'Execute: Escalate To Human Sub-Workflow', 'Execute: Change Viewing Sub-Workflow', 'Search Listings', 'Record Valuation Request'];

test('01: no tool can crash Elliot', () => {
  const routed = (wf01.connections['Route by Tool'].main || []).flat().map((x) => x.node).sort();
  assert.deepStrictEqual(routed, [...TOOL_NODES].sort(), 'every tool Route by Tool can reach is covered here');
  for (const name of TOOL_NODES) assert.strictEqual(nodeOf(wf01, name).onError, 'continueRegularOutput', name);
});

const toolResult = (tool, output, extra = {}) => run(nodeOf(wf01, 'Build Tool Result Message').parameters.jsCode, {
  json: output,
  nodes: {
    'Assemble Request': { tenant_id: 't1', conversation_id: 'conv1', claude_messages: [{ role: 'user', content: 'hi' }], tool_turns: 1 },
    'Call Claude': { content: [{ type: 'tool_use', id: 'tu1', name: tool, input: {} }], usage: { input_tokens: 10, output_tokens: 5 } },
    'Extract Tool Call': { tool_name: tool, tool_use_id: 'tu1', tool_input: {}, held_tool: null, ...extra },
    'Merge Tenant Context': { channel: 'chat_widget', assistant_mode: 'agency' },
    'Identify Visitor': { visitor: {} },
    'Get or Create Conversation': { conversation_id: 'conv1' },
    'Load AI Config': {},
  },
})[0].json;
const said = (out) => out.claude_messages[out.claude_messages.length - 1].content[0].content;

test('01: a crashed tool is never reported as done; Claude hands over to the team', () => {
  for (const tool of ['book_appointment', 'check_availability', 'search_company_knowledge', 'search_listings', 'change_viewing']) {
    const out = toolResult(tool, { error: 'Google Calendar: invalid_grant' });
    assert.match(said(out), new RegExp(`^TOOL FAILED: ${tool} could not be completed`), tool);
    assert.match(said(out), /Nothing was done\. Do not say or imply it was done\..*call escalate_to_human/, tool);
    assert.deepStrictEqual([out.tool_failed, out.failed_tool, out.tool_error], [true, tool, 'Google Calendar: invalid_grant'], tool);
    assert.strictEqual(out.tool_turns, 2);
    assert.strictEqual(out.claude_messages[out.claude_messages.length - 1].content[0].tool_use_id, 'tu1');
  }
  // n8n's Postgres node hands back an object.
  const pg = toolResult('search_listings', { message: 'connection terminated', error: { message: 'connection terminated', code: '57P01' } });
  assert.deepStrictEqual([pg.tool_failed, pg.tool_error], [true, 'connection terminated']);
  // The hand-over itself failing: don't loop, the database opens the escalation.
  const esc = toolResult('escalate_to_human', { error: 'Workflow does not exist' });
  assert.match(said(esc), /^TOOL FAILED: escalate_to_human.*do not call escalate_to_human again/);
  assert.strictEqual(esc.failed_tool, 'escalate_to_human');
  // A booking held for approval that then fails to hand over is logged under what was asked for.
  const held = toolResult('escalate_to_human', { error: 'x' }, { held_tool: 'book_appointment', requested_tool: 'book_appointment' });
  assert.strictEqual(held.failed_tool, 'book_appointment');
  assert.match(said(held), /^TOOL FAILED: book_appointment/);
});

test('01: an ordinary "no" from a tool is not a crash', () => {
  const taken = toolResult('book_appointment', { success: false, error: 'slot_unavailable', message: 'That time is no longer available.' });
  assert.strictEqual(taken.tool_failed, false);
  assert.ok(!/TOOL FAILED/.test(said(taken)));
  assert.strictEqual(toolResult('check_availability', { available_slots: [], timezone: 'Europe/Warsaw' }).tool_failed, false);
  assert.strictEqual(toolResult('search_company_knowledge', { found: false, message: 'Nothing found' }).tool_failed, false);
  assert.strictEqual(toolResult('search_listings', { result: { listings: [] } }).tool_failed, false);
  assert.strictEqual(toolResult('escalate_to_human', { reason: 'hot_lead', priority: 'high' }).tool_failed, false);
  assert.strictEqual(toolResult('change_viewing', { success: false, error: 'no booking found' }).tool_failed, false);
  // record_valuation_request explains its own errors (0043) and Claude can fix them.
  const val = toolResult('record_valuation_request', { error: { message: 'contact not found' } });
  assert.strictEqual(val.tool_failed, false);
  assert.match(said(val), /^Not saved \(contact not found\)/);
});

test('01: a lead that could not be saved is handed to the team with the client\'s details', () => {
  const lead = (output) => run(nodeOf(wf01, 'Build Lead Result Message').parameters.jsCode, {
    json: output,
    nodes: { 'Assemble Request': { tenant_id: 't1', conversation_id: 'conv1', claude_messages: [], tool_turns: 0 },
      'Call Claude': { content: [{ type: 'tool_use', id: 'tu1', name: 'capture_lead', input: {} }] },
      'Extract Tool Call': { tool_name: 'capture_lead', tool_use_id: 'tu1' } },
  })[0].json;
  const crashed = lead({ error: 'duplicate key value violates unique constraint' });
  assert.match(said(crashed), /^TOOL FAILED: the client's details could not be saved.*escalate_to_human.*name, phone, email/);
  assert.deepStrictEqual([crashed.tool_failed, crashed.failed_tool], [true, 'capture_lead']);
  const ok = lead({ success: true, status: 'WARM', contact_id: 'c1' });
  assert.strictEqual(ok.tool_failed, false);
  assert.match(said(ok), /^Lead captured successfully/);
  assert.strictEqual(lead({ success: false }).tool_failed, false);
});

test('01: a failed tool is logged without holding up the reply', () => {
  for (const src of ['Build Tool Result Message', 'Build Lead Result Message']) {
    assert.deepStrictEqual(next(wf01, src), ['Assemble Request', 'Tool Failed?'], src);
  }
  const cond = nodeOf(wf01, 'Tool Failed?').parameters.conditions.conditions[0].leftValue;
  assert.strictEqual(expr(cond, { json: { tool_failed: true } }), true);
  assert.strictEqual(expr(cond, { json: { tool_failed: false } }), false);
  assert.strictEqual(expr(cond, { json: {} }), false);
  assert.deepStrictEqual(next(wf01, 'Tool Failed?', 0), ['Record Tool Failure']);
  assert.deepStrictEqual(next(wf01, 'Tool Failed?', 1), []);
  const rec = nodeOf(wf01, 'Record Tool Failure');
  assert.match(rec.parameters.query, /select record_tool_failure\(\$1::uuid, nullif\(\$2, ''\)::uuid, \$3, \$4\)/);
  assert.strictEqual(rec.onError, 'continueRegularOutput');
  assert.deepStrictEqual(next(wf01, 'Record Tool Failure'), []);
  const out = toolResult('book_appointment', { error: 'boom' });
  assert.deepStrictEqual(expr(rec.parameters.options.queryReplacement, { json: out }), ['t1', 'conv1', 'book_appointment', 'boom']);
});

// ───────────── 20: follow-ups ─────────────
test('20: a step is claimed in the database; the workflow no longer moves runs itself', () => {
  assert.match(nodeOf(wf20, 'Query Due Runs').parameters.query, /select \* from claim_due_follow_up_runs\(25\);\s*$/);
  for (const gone of ['Advance Run', 'Stop Run (Replied)', 'Complete Run']) assert.ok(!has(wf20, gone), gone);
  const touching = wf20.nodes.filter((n) => /update\s+follow_up_runs/i.test(JSON.stringify(n.parameters))).map((n) => n.name);
  assert.deepStrictEqual(touching, [], 'only claim_due_follow_up_runs changes a run');
  // No connection points at a node that no longer exists.
  const names = new Set(wf20.nodes.map((n) => n.name));
  for (const [from, c] of Object.entries(wf20.connections)) {
    assert.ok(names.has(from), from);
    for (const x of (c.main || []).flat()) assert.ok(names.has(x.node), `${from} -> ${x.node}`);
  }
  // The sends still tolerate a failure (the run has moved on either way).
  assert.strictEqual(nodeOf(wf20, 'Send Email').onError, 'continueRegularOutput');
  assert.strictEqual(nodeOf(wf20, 'Send WhatsApp').onError, 'continueRegularOutput');
});

test('20: a claimed row still produces the same step to send', () => {
  const row = { run_id: 'r1', tenant_id: 't1', lead_id: 'l1', current_step_index: 1, contact_id: 'c1', contact_name: 'Anna', contact_email: 'anna@example.com',
    contact_phone: null, contact_replied: false, autonomy_rules: { send_follow_up: { mode: 'autonomous' } }, whatsapp_phone_number_id: null,
    wa_conversation_id: null, wa_last_inbound_at: null,
    steps: [{ day_offset: 0, channel: 'email', subject: 'One', body: 'Hi' }, { day_offset: 3, channel: 'email', subject: 'Two', body: 'Still looking, {{contact_name}}?' }] };
  const out = run(nodeOf(wf20, 'Determine Action').parameters.jsCode, { json: row })[0].json;
  assert.deepStrictEqual([out.action, out.channel, out.subject, out.body, out.mode, out.run_id], ['send', 'email', 'Two', 'Still looking, Anna?', 'autonomous', 'r1']);
});

// ───────────── 23: CRM ─────────────
test('23: the database decides which syncs are due (spaced-out retries)', () => {
  const q = nodeOf(wf23, 'Query Pending Syncs').parameters.query;
  assert.match(q, /where l\.id in \(select sync_id from due_crm_syncs\(25\)\)/);
  assert.ok(!/where l\.status = 'pending'/.test(q));
  assert.match(nodeOf(wf23, 'Mark Retry Or Give Up').parameters.query, /retry_count \+ 1 >= 5 then 'failed'/);
  assert.match(nodeOf(wf23, 'Mark Retry Or Give Up').parameters.query, /updated_at = now\(\)/, 'the wait is counted from the last try');
});

// ───────────── 25: WhatsApp ─────────────
const extract = (value, more = []) => run(nodeOf(wf25, 'Extract WhatsApp Fields').parameters.jsCode, {
  json: { body: { entry: [{ changes: [{ value }, ...more.map((v) => ({ value: v }))] }] } },
})[0].json;
const META = { metadata: { phone_number_id: 'PN1' } };
const MSG = (id, text) => ({ from: '48600100200', id, timestamp: '1794000000', type: 'text', text: { body: text } });

test('25: a message Meta reports as failed is recorded', () => {
  const out = extract({ ...META, statuses: [
    { id: 'wamid.A', status: 'failed', recipient_id: '48600100200', errors: [{ code: 131026, title: 'Message undeliverable' }] },
    { id: 'wamid.B', status: 'delivered', recipient_id: '48600100200' },
    { id: 'wamid.C', status: 'failed', recipient_id: '48600100300', errors: [{ code: 131047, message: 'Re-engagement message' }] },
    { id: 'wamid.D', status: 'failed', recipient_id: '48600100400' },
  ] });
  assert.strictEqual(out.skip, true, 'a status update is never answered');
  assert.strictEqual(out.has_delivery_failures, true);
  assert.deepStrictEqual(out.delivery_failures, [
    { phone_number_id: 'PN1', recipient: '48600100200', wa_message_id: 'wamid.A', error: 'Message undeliverable (code 131026)' },
    { phone_number_id: 'PN1', recipient: '48600100300', wa_message_id: 'wamid.C', error: 'Re-engagement message (code 131047)' },
    { phone_number_id: 'PN1', recipient: '48600100400', wa_message_id: 'wamid.D', error: 'not delivered' },
  ]);
  const quiet = extract({ ...META, statuses: [{ id: 'wamid.B', status: 'read', recipient_id: '48600100200' }] });
  assert.deepStrictEqual([quiet.skip, quiet.has_delivery_failures, quiet.delivery_failures, quiet.extra_messages], [true, false, [], 0]);

  assert.ok(next(wf25, 'Extract WhatsApp Fields').includes('Delivery Failed?'));
  const cond = nodeOf(wf25, 'Delivery Failed?').parameters.conditions.conditions[0].leftValue;
  assert.strictEqual(expr(cond, { json: out }), true);
  assert.strictEqual(expr(cond, { json: quiet }), false);
  assert.deepStrictEqual(next(wf25, 'Delivery Failed?', 0), ['Each Failed Message']);
  const each = run(nodeOf(wf25, 'Each Failed Message').parameters.jsCode, { json: out });
  assert.strictEqual(each.length, 3);
  assert.deepStrictEqual(next(wf25, 'Each Failed Message'), ['Record Delivery Failure']);
  const rec = nodeOf(wf25, 'Record Delivery Failure');
  assert.match(rec.parameters.query, /select record_whatsapp_delivery_failure\(\$1, \$2, \$3, \$4\)/);
  assert.deepStrictEqual(expr(rec.parameters.options.queryReplacement, { json: each[0].json }), ['PN1', '48600100200', 'wamid.A', 'Message undeliverable (code 131026)']);
  assert.strictEqual(rec.onError, 'continueRegularOutput');
});

test('25: an ordinary message is answered exactly as before', () => {
  const out = extract({ ...META, contacts: [{ profile: { name: 'Anna' }, wa_id: '48600100200' }], messages: [MSG('wamid.1', 'Hello')] });
  assert.deepStrictEqual([out.skip, out.phone_number_id, out.from_wa_id, out.contact_name, out.wa_message_id, out.body],
    [false, 'PN1', '48600100200', 'Anna', 'wamid.1', 'Hello']);
  assert.deepStrictEqual([out.has_delivery_failures, out.extra_messages], [false, 0]);
  assert.ok(next(wf25, 'Extract WhatsApp Fields').includes('Should Process?'));
  assert.deepStrictEqual(next(wf25, 'Should Process?', 0), ['Lookup Tenant by Phone Number Id']);
});

test('25: extra messages in one delivery are counted, not lost without a trace', () => {
  const two = extract({ ...META, messages: [MSG('wamid.1', 'Hello'), MSG('wamid.2', 'Anyone there?')] });
  assert.deepStrictEqual([two.skip, two.wa_message_id, two.extra_messages], [false, 'wamid.1', 1]);
  const spread = extract({ ...META, messages: [MSG('wamid.1', 'Hello')] }, [{ ...META, messages: [MSG('wamid.2', 'x'), MSG('wamid.3', 'y')] }]);
  assert.strictEqual(spread.extra_messages, 2);
  // Reactions aren't messages to answer.
  const react = extract({ ...META, messages: [MSG('wamid.1', 'Hello'), { from: '48600100200', id: 'wamid.r', type: 'reaction', reaction: { emoji: '👍' } }] });
  assert.strictEqual(react.extra_messages, 0);
  assert.ok(next(wf25, 'Extract WhatsApp Fields').includes('More Than One Message?'));
  const cond = nodeOf(wf25, 'More Than One Message?').parameters.conditions.conditions[0].leftValue;
  assert.strictEqual(expr(cond, { json: two }), true);
  assert.strictEqual(expr(cond, { json: react }), false);
  assert.deepStrictEqual(next(wf25, 'More Than One Message?', 0), ['Log Unanswered Messages']);
  const log = nodeOf(wf25, 'Log Unanswered Messages');
  assert.match(log.parameters.query, /'whatsapp_unanswered_failed'/, 'ends in _failed so the health alerts pick it up');
  assert.deepStrictEqual(expr(log.parameters.options.queryReplacement, { json: two }), ['PN1', 1, '48600100200']);
});

// ───────────── 39: email ─────────────
const build = (input, executionId = '1001') => run(nodeOf(wf39, 'Build Resend Email').parameters.jsCode, {
  json: { sender: { name: 'Agency', address: 'agency@mail.getelliot.eu', reply_to: 'office@agency.pl' } },
  nodes: { 'When Executed by Another Workflow': input },
  globals: { $execution: { id: executionId } },
})[0].json;

test('39: every email has an Idempotency-Key, so a retry can\'t send it twice', () => {
  const mail = { tenant_id: 't1', to: 'anna@example.com', subject: 'Your viewing', text: 'See you on Friday.' };
  const a = build(mail);
  assert.match(a.idempotency_key, /^elliot-1001-[a-z0-9]+$/);
  assert.ok(a.idempotency_key.length <= 256, 'Resend allows 256 characters');
  assert.strictEqual(build(mail).idempotency_key, a.idempotency_key, 'the same email in the same run: the same key');
  assert.notStrictEqual(build({ ...mail, text: 'See you on Saturday.' }).idempotency_key, a.idempotency_key, 'a different email is never mistaken for a repeat');
  assert.notStrictEqual(build({ ...mail, to: 'bartek@example.com' }).idempotency_key, a.idempotency_key);
  assert.notStrictEqual(build(mail, '1002').idempotency_key, a.idempotency_key, 'sending the same text again later is allowed');
  // A caller's own key wins, made safe for a header.
  assert.strictEqual(build({ ...mail, idempotency_key: 'reminder:appt-1:2026-11-12' }).idempotency_key, 'reminder:appt-1:2026-11-12');
  assert.strictEqual(build({ ...mail, idempotency_key: 'a b\r\nX-Evil: 1' }).idempotency_key, 'a-b--X-Evil:-1');
  assert.strictEqual(a.ok_to_send, true);

  const send = nodeOf(wf39, 'Send via Resend');
  const header = send.parameters.headerParameters.parameters.find((h) => h.name === 'Idempotency-Key');
  assert.strictEqual(expr(header.value, { json: a }), a.idempotency_key);
  assert.strictEqual(send.retryOnFail, true);
  assert.strictEqual(send.parameters.jsonBody, '={{ JSON.stringify($json.email) }}', 'the key is a header, not part of the email');
});

// ───────────── retries ─────────────
test('calls that are safe to repeat are retried', () => {
  const SAFE = { '08-knowledge-ingestion.json': ['Embed Chunk (Voyage AI)'], '09-knowledge-retrieval.json': ['Embed Query (Voyage AI)'],
    '11-check-availability.json': ['Get Busy Times (Google FreeBusy API)'], '12-book-appointment.json': ['Check Calendars (FreeBusy)'],
    '16-email-inbound-trigger.json': ['Sign Attachment'], '40-email-inbound-forwarded.json': ['Fetch Email', 'List Attachments', 'Sign Attachment', 'Download Attachment'],
    '41-calendar-access-check.json': ['Check Free Times', "Elliot's Google Account"], '42-asari-sync.json': ['List Exported Listings', 'Get Listing'] };
  for (const [file, names] of Object.entries(SAFE)) {
    for (const name of names) {
      const n = nodeOf(load(file), name);
      assert.strictEqual(n.retryOnFail, true, `${file} ${name}`);
      assert.ok(n.maxTries >= 2 && n.maxTries <= 5, `${file} ${name}`);
      assert.ok(n.parameters.options && n.parameters.options.timeout > 0, `${file} ${name} has a timeout`);
    }
  }
});

test('calls that send or create something are never retried blindly', () => {
  const ONCE = { '12-book-appointment.json': ['HTTP Request'], '16-email-inbound-trigger.json': ['Send Reply via Gmail', 'Ask Elliot'],
    '23-crm-sync-sweep.json': ['Send To CRM Webhook'], '25-whatsapp-inbound-trigger.json': ['Send WhatsApp Reply', 'Ask Elliot'],
    '27-send-approved-whatsapp.json': ['Send via WhatsApp API', 'Send Follow-Up Template'], '32-send-whatsapp-message.json': ['Send via WhatsApp API'],
    '38-viewing-reminders.json': ['Send WhatsApp Reminder'], '39-send-email.json': ['Send via Gmail (team fallback)'], '40-email-inbound-forwarded.json': ['Ask Elliot'] };
  for (const [file, names] of Object.entries(ONCE)) {
    for (const name of names) {
      const n = nodeOf(load(file), name);
      assert.ok(!n.retryOnFail, `${file} ${name} must not be retried`);
      assert.ok(n.parameters.options && n.parameters.options.timeout > 0, `${file} ${name} has a timeout`);
    }
  }
});

console.log(`\n${passed} passed`);
