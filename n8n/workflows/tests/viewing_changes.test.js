// Tests for 0038: clients confirming, moving or cancelling a booking by
// message (01's change_viewing → workflow 37), reminders the day before
// (workflow 38), and notice + buffer in workflow 11. Runs the nodes' code and
// expressions out of the workflow JSON.
//
// Run: node n8n/workflows/tests/viewing_changes.test.js
// (the buffer test needs luxon on NODE_PATH; skipped otherwise)

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
const fromB64 = (s) => Buffer.from(s, 'base64').toString('utf8');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const decode = (raw) => { const m = fromB64url(raw); const [h, b] = m.split('\r\n\r\n'); return { head: h, body: fromB64(b) }; };

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const wf01 = load('01-main-ai-agent.json');
const wf11 = load('11-check-availability.json');
const wf37 = load('37-client-viewing-changes.json');
const wf38 = load('38-viewing-reminders.json');
const T = '11111111-1111-1111-1111-111111111111';
const C = '22222222-2222-2222-2222-222222222222';
const A = '33333333-3333-3333-3333-333333333333';
const later = (h) => new Date(Date.now() + h * 3600e3).toISOString();

console.log('viewing_changes');

// ── 01 ──
test('01: change_viewing is offered, allowed and routed to workflow 37', () => {
  const tools = JSON.parse(expr(nodeOf(wf01, 'Call Claude').parameters.jsonBody, {
    json: { system_prompt: 's', claude_messages: [] }, nodes: { 'Merge Tenant Context': { assistant_mode: 'agency' } } })).tools;
  const t = tools.find((x) => x.name === 'change_viewing');
  assert.deepStrictEqual(t.input_schema.properties.action.enum, ['confirm', 'reschedule', 'cancel']);
  assert.deepStrictEqual(t.input_schema.required, ['appointment_id', 'action']);
  assert.ok(!('contact_id' in t.input_schema.properties), 'the model must not choose whose booking to change');
  const ref = JSON.parse(fs.readFileSync(path.join(WF_DIR, 'tool_schemas.json'), 'utf8')).tools.find((x) => x.name === 'change_viewing');
  assert.deepStrictEqual(ref.input_schema, t.input_schema, 'tool_schemas.json out of sync');
  assert.match(nodeOf(wf01, 'Extract Tool Call').parameters.jsCode, /'change_viewing'[,\]]/);
  const rules = nodeOf(wf01, 'Route by Tool').parameters.rules.values;
  const idx = rules.findIndex((r) => r.conditions.conditions[0].rightValue === 'change_viewing');
  assert.strictEqual(wf01.connections['Route by Tool'].main[idx][0].node, 'Execute: Change Viewing Sub-Workflow');
  assert.deepStrictEqual(next(wf01, 'Execute: Change Viewing Sub-Workflow'), ['Build Tool Result Message']);
});

test('01: the client is taken from the conversation, never from the model', () => {
  const v = nodeOf(wf01, 'Execute: Change Viewing Sub-Workflow').parameters.workflowInputs.value;
  const nodes = { 'Identify Visitor': { visitor: { contact_id: C } }, 'Extract Tool Call': { tool_input: { appointment_id: A, action: 'cancel', contact_id: 'EVIL' } } };
  assert.strictEqual(expr(v.contact_id, { nodes }), C);
  assert.strictEqual(expr(v.contact_id, { nodes: { ...nodes, 'Identify Visitor': { visitor: {} } } }), '');
  assert.strictEqual(expr(v.appointment_id, { nodes }), A);
});

test('01: viewings come with their ids, and the rules explain changing them', () => {
  const p = run(nodeOf(wf01, 'Build Claude Request').parameters.jsCode, { nodes: {
    'Merge Tenant Context': { tenant_name: 'X', tenant_industry: 'real estate', assistant_mode: 'agency', message: 'hi', channel: 'whatsapp' },
    'Load AI Config': {}, 'Load Conversation History': [],
    'Identify Visitor': { visitor: { contact_id: C, upcoming_viewings: [{ appointment_id: A, when: 'Thu 12 Nov 2026, 10:00', title: 'Studio', client_confirmed: true }] } },
  } })[0].json.system_prompt;
  assert.match(p, /- Thu 12 Nov 2026, 10:00: Studio \(appointment_id: 33333333-3333-3333-3333-333333333333, client confirmed\)/);
  assert.match(p, /15\. Changing a booking: .*change_viewing.*check_availability first.*action confirm/);
  const sales = run(nodeOf(wf01, 'Build Claude Request').parameters.jsCode, { nodes: {
    'Merge Tenant Context': { tenant_name: 'Elliot', tenant_industry: 'software', assistant_mode: 'sales', message: 'hi', channel: 'chat_widget' },
    'Load AI Config': {}, 'Load Conversation History': [],
    'Identify Visitor': { visitor: { contact_id: C, upcoming_viewings: [{ appointment_id: A, when: 'Thu 12 Nov 2026, 10:00' }] } },
  } })[0].json.system_prompt;
  assert.match(sales, /9\. If they want to move or cancel a call/);
  assert.match(sales, /UPCOMING CALLS:\n- Thu 12 Nov 2026, 10:00: viewing \(property not recorded\) \(appointment_id: 3333/);
});

test('01: Elliot is told exactly what happened', () => {
  const code = nodeOf(wf01, 'Build Tool Result Message').parameters.jsCode;
  const nodes = { 'Assemble Request': { claude_messages: [] }, 'Call Claude': { content: [] }, 'Extract Tool Call': { tool_name: 'change_viewing', tool_use_id: 'x' } };
  const text = (out) => JSON.stringify(run(code, { json: out, nodes })[0].json);
  assert.match(text({ success: true, action: 'reschedule', when: 'Fri 13 Nov, 14:00', previous_when: 'Thu 12 Nov, 10:00', calendar: 'updated', email_sent_to: 'a@x.pl' }),
    /Moved: the booking is now Fri 13 Nov, 14:00 \(was Thu 12 Nov, 10:00\)\. The team has been told\. A confirmation of the new time went to a@x\.pl/);
  assert.match(text({ success: true, action: 'cancel', when: 'Thu 12 Nov, 10:00', email_sent_to: null }), /Cancelled the booking on Thu 12 Nov, 10:00/);
  assert.match(text({ success: true, action: 'confirm', when: 'Thu 12 Nov, 10:00' }), /Confirmed: the client is coming on Thu 12 Nov, 10:00/);
  assert.match(text({ success: false, action: 'reschedule', error: 'that time was just taken; offer other times' }), /Not done: that time was just taken/);
});

// ── 11 ──
test('11: notice and buffer come from Settings; a caller\'s notice wins', () => {
  assert.match(nodeOf(wf11, 'Load AI Config').parameters.query, /ac\.booking_notice_minutes, ac\.booking_buffer_minutes/);
  const merge = (trigger, config) => run(nodeOf(wf11, 'Merge Config').parameters.jsCode, {
    json: config, nodes: { 'When Executed by Another Workflow': { tenant_id: 't', date_range_start: 'a', date_range_end: 'b', ...trigger } } })[0].json;
  let m = merge({}, { booking_notice_minutes: 120, booking_buffer_minutes: 30 });
  assert.deepStrictEqual([m.min_notice_minutes, m.buffer_minutes, m.duration_minutes], [120, 30, 60]);
  m = merge({ min_notice_minutes: '240' }, { booking_notice_minutes: 120, booking_buffer_minutes: 0 });
  assert.deepStrictEqual([m.min_notice_minutes, m.buffer_minutes], [240, 0]);
  m = merge({}, {});
  assert.deepStrictEqual([m.min_notice_minutes, m.buffer_minutes], [0, 0]);
});

let DateTime = null;
try { ({ DateTime } = require('luxon')); } catch (e) { /* skipped */ }
test('11: the buffer keeps time free around existing viewings', () => {
  if (!DateTime) { console.log('    (skipped: luxon not installed)'); return; }
  const day = DateTime.now().setZone('Europe/Warsaw').plus({ days: 2 }).toISODate();
  const dn = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][DateTime.fromISO(day).weekday % 7];
  const busy = [{ start: DateTime.fromISO(`${day}T12:00`, { zone: 'Europe/Warsaw' }).toUTC().toISO(), end: DateTime.fromISO(`${day}T13:00`, { zone: 'Europe/Warsaw' }).toUTC().toISO() }];
  const slots = (buffer) => run(nodeOf(wf11, 'Compute Available Slots').parameters.jsCode, {
    json: { calendars: { primary: { busy } } },
    nodes: { 'Merge Config': { google_calendar_id: 'primary', business_hours: { [dn]: { open: '10:00', close: '15:00' } }, timezone: 'Europe/Warsaw',
      date_range_start: day, date_range_end: day, duration_minutes: 60, min_notice_minutes: 0, buffer_minutes: buffer } },
    globals: { DateTime },
  })[0].json.available_slots.map((s) => DateTime.fromISO(s.starts_at).setZone('Europe/Warsaw').toFormat('HH:mm'));
  assert.deepStrictEqual(slots(0), ['10:00', '11:00', '13:00', '14:00']);
  assert.deepStrictEqual(slots(30), ['10:00', '14:00']);
});

// ── 37 ──
const validate = (input) => run(nodeOf(wf37, 'Validate Change').parameters.jsCode, { json: input })[0].json;
const good = { tenant_id: T, contact_id: C, appointment_id: A, action: 'reschedule', new_starts_at: later(48), new_ends_at: later(49), reason: 'work', conversation_id: 'cv1', channel: 'whatsapp' };
const info = { appointment_id: A, status: 'confirmed', starts_at: later(24), ends_at: later(25), timezone: 'Europe/Warsaw', external_calendar_id: 'ev1',
  google_calendar_id: 'cal@x', notes: null, tenant_name: 'Simon RE', assistant_mode: 'agency', contact_name: 'Anna Nowak', contact_email: 'anna@x.pl',
  contact_phone: '+48600', listing_title: 'Studio', listing_address: 'Hoża 41, Warszawa', agent_name: 'Ola', agent_email: 'ola@simon.pl', notify_email: 'office@simon.pl', booking_notice_minutes: 120 };
const check = (v, row) => run(nodeOf(wf37, 'Check Booking').parameters.jsCode, { json: row, nodes: { 'Validate Change': v } })[0].json;

test('37: input is checked; a client without an identity can\'t change anything', () => {
  assert.strictEqual(validate(good).ok, true);
  assert.match(validate({ ...good, contact_id: '' }).error, /not identified/);
  assert.match(validate({ ...good, appointment_id: 'A1' }).error, /not valid/);
  assert.match(validate({ ...good, action: 'delete' }).error, /confirm, reschedule or cancel/);
  assert.deepStrictEqual(next(wf37, 'Valid?', 1), ['Change Result']);
});

test('37: only the client\'s own, upcoming, confirmed booking; new time must respect notice', () => {
  assert.match(nodeOf(wf37, 'Load Booking').parameters.query, /client_appointment\(\$1::uuid, \$2::uuid, \$3::uuid\)/);
  const v = validate(good);
  assert.strictEqual(check(v, {}).error, 'no booking with that id for this client');
  assert.strictEqual(check(v, { ...info, status: 'cancelled' }).error, 'that booking is already cancelled');
  assert.strictEqual(check(v, { ...info, starts_at: later(-2) }).error, 'that booking is in the past');
  assert.match(check({ ...v, new_starts_at: later(1), new_ends_at: later(2) }, info).error, /too soon \(bookings need 120 minutes' notice\)/);
  assert.match(check({ ...v, new_starts_at: '', new_ends_at: '' }, info).error, /call check_availability/);
  const ok = check(v, info);
  assert.deepStrictEqual([ok.ok, ok.has_event, typeof ok.new_when], [true, true, 'string']);
});

test('37: routes confirm, cancel and reschedule; clashes are checked before the calendar moves', () => {
  assert.deepStrictEqual(next(wf37, 'Confirm?', 0), ['Mark Confirmed']);
  assert.deepStrictEqual(next(wf37, 'Cancel?', 0), ['Cancel: Has Event?']);
  assert.deepStrictEqual(next(wf37, 'Cancel?', 1), ['Move In Dashboard']);
  assert.deepStrictEqual(next(wf37, 'Move In Dashboard'), ['Moved?']);
  assert.deepStrictEqual(next(wf37, 'Moved?', 1), ['Change Result']);
  assert.deepStrictEqual(next(wf37, 'Delete Calendar Event'), ['Mark Cancelled']);
  assert.match(nodeOf(wf37, 'Move In Dashboard').parameters.query, /client_reschedule_appointment/);
  const c = check(validate(good), info);
  const url = expr(nodeOf(wf37, 'Move Calendar Event').parameters.url, { nodes: { 'Check Booking': c } });
  assert.strictEqual(url, 'https://www.googleapis.com/calendar/v3/calendars/cal%40x/events/ev1?sendUpdates=all');
  const body = JSON.parse(expr(nodeOf(wf37, 'Move Calendar Event').parameters.jsonBody, { nodes: { 'Check Booking': c } }));
  assert.deepStrictEqual(body.start, { dateTime: good.new_starts_at, timeZone: 'Europe/Warsaw' });
  for (const n of ['Delete Calendar Event', 'Move Calendar Event', 'Send Email']) assert.strictEqual(nodeOf(wf37, n).onError, 'continueRegularOutput', n);
});

test('37: after a move, the agent and the client are emailed', () => {
  const c = check(validate(good), info);
  const out = run(nodeOf(wf37, 'Build Emails').parameters.jsCode, { nodes: { 'Check Booking': c, 'Move Calendar Event': { statusCode: 200 } } }).map((x) => x.json);
  assert.deepStrictEqual(out.map((e) => [e.to, e.kind, e.calendar]), [['ola@simon.pl', 'team', 'updated'], ['anna@x.pl', 'client', 'updated']]);
  assert.match(out[0].subject, /^Moved by the client: Anna Nowak, now /);
  const team = decode(out[0].raw_message).body;
  assert.match(team, /Anna Nowak moved their viewing \(Studio, Hoża 41, Warszawa\) via WhatsApp:\nwas .*\nnow .*\nReason: work\nThe calendar entry was updated\.\nConversation: https:\/\/app\.getelliot\.eu\/dashboard\/conversations\/cv1/);
  const client = decode(out[1].raw_message);
  assert.match(client.head, /^To: anna@x\.pl\r\n/);
  assert.match(client.body, /^Hi Anna,\n\nyour viewing \(Studio, Hoża 41, Warszawa\) has moved to /);
  assert.match(client.body, /Dzień dobry Anna,\n\nnowy termin \(Studio, Hoża 41, Warszawa\): /);
});

test('37: after a cancel; calendar failure is flagged; demo agency emails only the visitor', () => {
  const c = check(validate({ ...good, action: 'cancel' }), info);
  let out = run(nodeOf(wf37, 'Build Emails').parameters.jsCode, { nodes: { 'Check Booking': c, 'Delete Calendar Event': { statusCode: 500 } } }).map((x) => x.json);
  assert.match(decode(out[0].raw_message).body, /cancelled their viewing on .* via WhatsApp\.\nReason: work\nThe calendar entry was NOT removed, please delete it by hand\./);
  assert.match(out[1].subject, /^Cancelled: your viewing on /);
  out = run(nodeOf(wf37, 'Build Emails').parameters.jsCode, { nodes: { 'Check Booking': c, 'Delete Calendar Event': { statusCode: 410 } } }).map((x) => x.json);
  assert.strictEqual(out[0].calendar, 'deleted');
  const demo = check(validate({ ...good, action: 'cancel' }), { ...info, assistant_mode: 'demo' });
  out = run(nodeOf(wf37, 'Build Emails').parameters.jsCode, { nodes: { 'Check Booking': demo, 'Delete Calendar Event': { statusCode: 204 } } }).map((x) => x.json);
  assert.deepStrictEqual(out.map((e) => e.kind), ['client']);
  assert.match(out[0].subject, /^\[DEMO\] Cancelled/);
  const noEmail = check(validate({ ...good, action: 'cancel' }), { ...info, assistant_mode: 'demo', contact_email: null });
  out = run(nodeOf(wf37, 'Build Emails').parameters.jsCode, { nodes: { 'Check Booking': noEmail, 'Delete Calendar Event': { statusCode: 204 } } }).map((x) => x.json);
  assert.deepStrictEqual(out, [{ to: null, calendar: 'deleted' }]);
  assert.deepStrictEqual(next(wf37, 'Any Emails?', 1), ['Change Result']);
});

test('37: the result tells 01 what happened', () => {
  const code = nodeOf(wf37, 'Change Result').parameters.jsCode;
  assert.strictEqual(nodeOf(wf37, 'Change Result').executeOnce, true);
  const v = validate(good);
  const c = check(v, info);
  const built = [{ to: 'ola@simon.pl', kind: 'team', calendar: 'updated' }, { to: 'anna@x.pl', kind: 'client', calendar: 'updated' }];
  let r = run(code, { nodes: { 'Validate Change': v, 'Check Booking': c, 'Move In Dashboard': { result: { ok: true } }, 'Build Emails': built,
    'Send Email': [{ statusCode: 200 }, { statusCode: 200 }] } })[0].json;
  assert.deepStrictEqual([r.success, r.action, r.when, r.previous_when, r.calendar, r.email_sent_to], [true, 'reschedule', c.new_when, c.when, 'updated', 'anna@x.pl']);
  r = run(code, { nodes: { 'Validate Change': v, 'Check Booking': c, 'Move In Dashboard': { result: { ok: false, error: 'slot_unavailable' } } } })[0].json;
  assert.deepStrictEqual([r.success, r.error], [false, 'that time was just taken; offer other times']);
  const vc = validate({ ...good, action: 'confirm' });
  r = run(code, { nodes: { 'Validate Change': vc, 'Check Booking': check(vc, info), 'Mark Confirmed': { done: true } } })[0].json;
  assert.deepStrictEqual([r.success, r.action], [true, 'confirm']);
  r = run(code, { nodes: { 'Validate Change': validate({ ...good, contact_id: '' }) } })[0].json;
  assert.match(r.error, /not identified/);
});

// ── 38 ──
const due = { appointment_id: A, tenant_id: T, tenant_name: 'Simon RE', assistant_mode: 'agency', timezone: 'Europe/Warsaw',
  starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2026-11-12T10:00:00.000Z', notes: null, contact_name: 'Anna Nowak', contact_email: 'anna@x.pl',
  contact_phone: '+48 600 100 200', conversation_id: 'cv1', conversation_channel: 'whatsapp', whatsapp_phone_number_id: '111',
  listing_title: 'Studio', listing_address: 'Hoża 41, Warszawa', agent_name: 'Ola', last_client_message: 'Dzień dobry, czy mogę jutro?' };
const build = (row) => run(nodeOf(wf38, 'Build Reminder').parameters.jsCode, { json: row }).json;

test('38: once a day at 17:00 Warsaw time, for tomorrow', () => {
  assert.strictEqual(nodeOf(wf38, 'Every Day at 17:00').parameters.rule.interval[0].expression, '0 17 * * *');
  assert.strictEqual(wf38.settings.timezone, 'Europe/Warsaw');
  assert.strictEqual(nodeOf(wf38, 'Viewings Tomorrow').parameters.query, 'select * from due_viewing_reminders();');
});

test('38: WhatsApp clients get the template in their language; email kept as fallback', () => {
  const b = build(due);
  assert.deepStrictEqual([b.channel, b.to, b.sender_id, b.lang], ['whatsapp', '48600100200', '111', 'pl']);
  assert.deepStrictEqual(b.params, ['Anna', 'Simon RE', 'czwartek, 12 listopada, 10:00', 'Studio, Hoża 41, Warszawa']);
  assert.match(b.log_text, /^Przypomnienie: prezentacja z Simon RE jutro, czwartek, 12 listopada, o 10:00, Studio, Hoża 41, Warszawa\./);
  assert.ok(b.raw_message, 'email ready as a fallback');
  const body = JSON.parse(expr(nodeOf(wf38, 'Send WhatsApp Reminder').parameters.jsonBody, { json: b }));
  assert.deepStrictEqual([body.type, body.template.name, body.template.language.code, body.template.components[0].parameters.length], ['template', 'viewing_reminder', 'pl', 4]);
  const en = build({ ...due, last_client_message: 'Hi, is the flat still available?' });
  assert.strictEqual(en.lang, 'en');
  assert.match(en.log_text, /^Reminder: your viewing with Simon RE is tomorrow, Thursday 12 November at 10:00, Studio, Hoża 41, Warszawa\. Reply to confirm/);
});

test('38: others get an email (EN + PL); calls with Elliot include the Meet link; nothing to send = marked done', () => {
  const e = build({ ...due, conversation_channel: 'chat_widget' });
  assert.strictEqual(e.channel, 'email');
  const m = decode(e.raw_message);
  assert.match(m.head, /^To: anna@x\.pl\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(m.body, /^Hi Anna,\n\nReminder: your viewing with Simon RE is tomorrow/);
  assert.match(m.body, /Dzień dobry Anna,\n\nPrzypomnienie: prezentacja z Simon RE jutro/);
  const call = build({ ...due, assistant_mode: 'sales', tenant_name: 'Elliot', listing_title: null, listing_address: null,
    notes: '30-min live demo · Agency: Nowak · Google Meet: https://meet.google.com/abc', conversation_channel: 'whatsapp' });
  assert.strictEqual(call.channel, 'email', 'calls are emailed');
  assert.match(decode(call.raw_message).body, /Reminder: your call with Elliot is tomorrow, Thursday 12 November at 10:00 \(Warsaw time\)\. Google Meet: https:\/\/meet\.google\.com\/abc/);
  const none = build({ ...due, conversation_channel: 'chat_widget', contact_email: null });
  assert.strictEqual(none.channel, 'none');
  assert.deepStrictEqual(next(wf38, 'Email?', 1), ['Record Reminder']);
});

test('38: a failed WhatsApp falls back to email; results are recorded', () => {
  const b = build(due);
  const wa = (resp) => run(nodeOf(wf38, 'Check WhatsApp').parameters.jsCode, { json: resp, nodes: { 'Build Reminder': b } }).json;
  let r = wa({ statusCode: 200, body: { messages: [{ id: 'w1' }] } });
  assert.deepStrictEqual([r.ok, r.fallback, r.channel], [true, false, 'whatsapp']);
  r = wa({ statusCode: 404, body: { error: { message: 'Template name does not exist', code: 132001 } } });
  assert.deepStrictEqual([r.ok, r.fallback], [false, true]);
  assert.match(r.error, /code 132001/);
  assert.deepStrictEqual(next(wf38, 'WhatsApp Failed, Email Instead?', 0), ['Send Email Reminder']);
  assert.deepStrictEqual(next(wf38, 'WhatsApp Failed, Email Instead?', 1), ['Record Reminder']);
  const rec = nodeOf(wf38, 'Record Reminder').parameters;
  assert.match(rec.query, /record_viewing_reminder\(\$1::uuid, \$2, \$3::boolean, \$4, nullif\(\$5, ''\)::uuid\)/);
  assert.deepStrictEqual(expr(rec.options.queryReplacement, { json: { appointment_id: A, channel: 'whatsapp', ok: true, log_text: 'Przypomnienie', conversation_id: 'cv1' } }),
    [A, 'whatsapp', 'true', 'Przypomnienie', 'cv1']);
  assert.deepStrictEqual(expr(rec.options.queryReplacement, { json: { appointment_id: A, channel: 'email', ok: false, error: 'Invalid Credentials', conversation_id: null } }),
    [A, 'email', 'false', 'Invalid Credentials', '']);
  assert.deepStrictEqual(expr(rec.options.queryReplacement, { json: { appointment_id: A, channel: 'none' } }), [A, 'none', 'true', '', '']);
  const em = run(nodeOf(wf38, 'Check Email').parameters.jsCode, { json: { statusCode: 200 }, nodes: { 'Build Reminder': b } }).json;
  assert.deepStrictEqual([em.ok, em.channel], [true, 'email']);
});

console.log(`\n${passed} passed`);
