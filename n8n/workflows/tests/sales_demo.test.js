// Tests for getelliot.eu's own assistant and the demo agency (0037):
// workflow 01 in 'sales' and 'demo' mode, 11's call lengths, 12's Google Meet
// calls and DEMO confirmations, 18's notification, and the new workflows 35
// (website booking and demo access) and 36 (demo clean-up). Runs the nodes'
// code and expressions out of the workflow JSON.
//
// Run: node n8n/workflows/tests/sales_demo.test.js
// (the workflow 11 test needs luxon: `npm i luxon` somewhere on NODE_PATH; it is skipped otherwise)

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

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const wf01 = load('01-main-ai-agent.json');
const wf11 = load('11-check-availability.json');
const wf12 = load('12-book-appointment.json');
const wf18 = load('18-demo-request-intake.json');
const wf35 = load('35-website-booking-and-demo.json');
const wf36 = load('36-demo-cleanup.json');

const ctx = (mode) => ({ tenant_id: 't1', tenant_name: mode === 'demo' ? 'Demo Nieruchomości' : 'Elliot', tenant_industry: 'x', assistant_mode: mode, message: 'Hi', channel: 'chat_widget' });
function buildPrompt(mode, visitor = {}) {
  return run(nodeOf(wf01, 'Build Claude Request').parameters.jsCode, {
    nodes: {
      'Merge Tenant Context': ctx(mode), 'Load AI Config': {}, 'Identify Visitor': { visitor },
      'Load Conversation History': [],
    },
  })[0].json.system_prompt;
}
function tools(mode) {
  const body = nodeOf(wf01, 'Call Claude').parameters.jsonBody;
  return JSON.parse(expr(body, { json: { system_prompt: 's', claude_messages: [] }, nodes: { 'Merge Tenant Context': ctx(mode) } })).tools;
}

console.log('sales_demo');

// ── 01 ──
test('01: the account mode comes with the tenant', () => {
  assert.match(nodeOf(wf01, 'Resolve Tenant').parameters.query, /industry as tenant_industry, assistant_mode,\s+tenant_service_state\(id\) as service_state\s+from tenants/);
});

test('01: the sales assistant answers without asking for details first; agencies still ask', () => {
  const left = nodeOf(wf01, 'Visitor Identified?').parameters.conditions.conditions[0].leftValue;
  const with_ = (mode, visitor) => expr(left, { json: { visitor }, nodes: { 'Merge Tenant Context': ctx(mode) } });
  assert.strictEqual(with_('sales', { ready: false }), true);
  assert.strictEqual(with_('agency', { ready: false }), false);
  assert.strictEqual(with_('demo', { ready: false }), false);
  assert.strictEqual(with_('agency', { ready: true }), true);
});

test('01: sales prompt is about Elliot the product, books calls, never searches flats', () => {
  const p = buildPrompt('sales');
  assert.match(p, /^You are Elliot, the AI assistant on getelliot\.eu/);
  assert.match(p, /You are NOT an estate agency/);
  assert.match(p, /15-minute intro call/);
  assert.match(p, /30-minute live demo/);
  assert.match(p, /Google Meet link/);
  assert.match(p, /call_type \("intro" or "demo"\)/);
  assert.ok(!/search_listings/.test(p), 'sales prompt mentions search_listings');
  assert.match(p, /No details given yet/);
  assert.match(buildPrompt('sales', { name: 'Anna', email: 'a@x.pl', contact_id: 'c9' }), /contact_id is c9/);
});

test('01: demo agency = agency prompt plus a demo note; real agencies unchanged', () => {
  const demo = buildPrompt('demo', { name: 'Anna', email: 'a@x.pl', ready: true });
  const agency = buildPrompt('agency', { name: 'Anna', email: 'a@x.pl', ready: true });
  assert.match(demo, /^You are the AI assistant for Demo Nieruchomości/);
  assert.match(demo, /THIS IS A DEMO/);
  assert.ok(!/THIS IS A DEMO/.test(agency));
  assert.ok(!/getelliot\.eu/.test(agency.split('VISITOR:')[0].replace(/https:\/\/app\.getelliot\.eu/g, '')), 'agency prompt changed');
});

test('01: sales gets 6 tools (no listings) with call types; agencies keep all 7', () => {
  const s = tools('sales');
  assert.deepStrictEqual(s.map((t) => t.name), ['search_company_knowledge', 'capture_lead', 'check_availability', 'book_appointment', 'escalate_to_human', 'change_viewing']);
  const check = s.find((t) => t.name === 'check_availability');
  assert.deepStrictEqual(check.input_schema.properties.call_type.enum, ['intro', 'demo']);
  assert.deepStrictEqual(check.input_schema.required, ['call_type', 'date_range_start', 'date_range_end']);
  const book = s.find((t) => t.name === 'book_appointment');
  assert.deepStrictEqual(book.input_schema.required, ['contact_id', 'call_type', 'starts_at', 'ends_at', 'email']);
  assert.ok(!('listing_id' in book.input_schema.properties));
  const a = tools('agency');
  assert.strictEqual(a.length, 8); // 0043: + record_valuation_request (not in sales mode)
  assert.ok(a.find((t) => t.name === 'book_appointment').input_schema.properties.listing_id);
  assert.deepStrictEqual(tools('demo').map((t) => t.name), a.map((t) => t.name));
});

test('01: call type sets the slot length (15/30) and a 2-hour notice for sales only, as text (11 declares strings)', () => {
  const v = nodeOf(wf01, 'Execute: Check Availability Sub-Workflow').parameters.workflowInputs.value;
  const nodes = (mode, call_type) => ({ 'Extract Tool Call': { tool_input: { call_type } }, 'Merge Tenant Context': ctx(mode) });
  assert.strictEqual(expr(v.duration_minutes, { nodes: nodes('sales', 'intro') }), '15');
  assert.strictEqual(expr(v.duration_minutes, { nodes: nodes('sales', 'demo') }), '30');
  assert.strictEqual(expr(v.duration_minutes, { nodes: nodes('agency', undefined) }), '');
  assert.strictEqual(expr(v.min_notice_minutes, { nodes: nodes('sales', 'intro') }), '120');
  assert.strictEqual(expr(v.min_notice_minutes, { nodes: nodes('agency') }), '');
});

test('01: a sales booking goes to 12 as a consultation with the agency details', () => {
  const v = nodeOf(wf01, 'Execute: Book Appointment Sub-Workflow').parameters.workflowInputs.value;
  const nodes = (mode) => ({ 'Merge Tenant Context': ctx(mode),
    'Extract Tool Call': { tool_input: { call_type: 'demo', agency_name: 'Nowak', agents: '6', crm: 'ASARI', email: 'a@x.pl' } } });
  assert.strictEqual(expr(v.kind, { nodes: nodes('sales') }), 'consultation');
  assert.deepStrictEqual(JSON.parse(expr(v.details, { nodes: nodes('sales') })), { call_type: 'demo', agency: 'Nowak', agents: '6', crm: 'ASARI' });
  assert.strictEqual(expr(v.kind, { nodes: nodes('agency') }), '');
  assert.strictEqual(expr(v.details, { nodes: nodes('agency') }), '');
});

test('01: Elliot is told the Meet link after booking a call', () => {
  const code = nodeOf(wf01, 'Build Tool Result Message').parameters.jsCode;
  const nodes = (output) => ({
    'Assemble Request': { claude_messages: [] }, 'Call Claude': { content: [{ type: 'tool_use', id: 'tu1', name: 'book_appointment', input: {} }] },
    'Extract Tool Call': { tool_name: 'book_appointment', tool_use_id: 'tu1' },
  });
  const out = { success: true, kind: 'consultation', call_label: '30-minute live demo', starts_at: 's', ends_at: 'e', meet_link: 'https://meet.google.com/abc-defg-hij', confirmation_sent_to: 'a@x.pl' };
  const res = run(code, { json: out, nodes: nodes(out) })[0].json;
  const text = JSON.stringify(res);
  assert.match(text, /Call booked: 30-minute live demo from s to e\. Google Meet link: https:\/\/meet\.google\.com\/abc-defg-hij\. A confirmation email was sent to a@x\.pl/);
  const viewing = run(code, { json: { success: true, appointment_id: 'a1', starts_at: 's', ends_at: 'e', status: 'confirmed' }, nodes: nodes() })[0].json;
  assert.match(JSON.stringify(viewing), /Appointment booked successfully/);
});

// ── 11 ──
let DateTime = null;
try { ({ DateTime } = require('luxon')); } catch (e) { /* skipped below */ }
test('11: 15- and 30-minute slots with notice; viewings keep 60 minutes', () => {
  const merge = run(nodeOf(wf11, 'Merge Config').parameters.jsCode, {
    json: { business_hours: {}, timezone: 'Europe/Warsaw' },
    nodes: { 'When Executed by Another Workflow': { tenant_id: 't', date_range_start: 'a', date_range_end: 'b', duration_minutes: '30', min_notice_minutes: '120' } },
  })[0].json;
  assert.deepStrictEqual([merge.duration_minutes, merge.min_notice_minutes], [30, 120]);
  const plain = run(nodeOf(wf11, 'Merge Config').parameters.jsCode, {
    json: {}, nodes: { 'When Executed by Another Workflow': { tenant_id: 't', date_range_start: 'a', date_range_end: 'b' } },
  })[0].json;
  assert.deepStrictEqual([plain.duration_minutes, plain.min_notice_minutes], [60, 0]);
  if (!DateTime) { console.log('    (slot computation skipped: luxon not installed)'); return; }
  const day = DateTime.now().setZone('Europe/Warsaw').plus({ days: 2 }).toISODate();
  const hours = { [['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][DateTime.fromISO(day).weekday % 7]]: { open: '09:00', close: '10:00' } };
  const slots = (mins) => run(nodeOf(wf11, 'Compute Available Slots').parameters.jsCode, {
    json: { calendars: { primary: { busy: [] } } },
    nodes: { 'Merge Config': { google_calendar_id: 'primary', business_hours: hours, timezone: 'Europe/Warsaw', date_range_start: day, date_range_end: day, duration_minutes: mins, min_notice_minutes: 0 } },
    globals: { DateTime },
  })[0].json.available_slots.length;
  assert.deepStrictEqual([slots(15), slots(30), slots(60), slots(undefined)], [4, 2, 1, 1]);
});

test('11: a caller can ask for more than 200 slots (a month of 15-minute calls), up to 3000', () => {
  const merge = (max_slots) => run(nodeOf(wf11, 'Merge Config').parameters.jsCode, {
    json: {}, nodes: { 'When Executed by Another Workflow': { tenant_id: 't', date_range_start: 'a', date_range_end: 'b', max_slots } } })[0].json.max_slots;
  assert.deepStrictEqual([merge(undefined), merge(''), merge('3000'), merge('99999')], [200, 200, 3000, 3000]);
  if (!DateTime) return;
  const start = DateTime.now().setZone('Europe/Warsaw').plus({ days: 1 }).toISODate();
  const end = DateTime.fromISO(start).plus({ days: 29 }).toISODate();
  const hours = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => [d, { open: '09:00', close: '21:00' }]));
  const count = (max_slots) => run(nodeOf(wf11, 'Compute Available Slots').parameters.jsCode, {
    json: { calendars: { primary: { busy: [] } } },
    nodes: { 'Merge Config': { google_calendar_id: 'primary', business_hours: hours, timezone: 'Europe/Warsaw', date_range_start: start, date_range_end: end, duration_minutes: 15, min_notice_minutes: 0, max_slots } },
    globals: { DateTime },
  })[0].json.available_slots.length;
  assert.deepStrictEqual([count(undefined), count(3000)], [200, 30 * 48]);
});

// ── 12 ──
const info = { timezone: 'Europe/Warsaw', contact_name: 'Anna Nowak', contact_email: 'anna@agency.pl', contact_phone: '+48600', tenant_name: 'Elliot', assistant_mode: 'sales' };
const callReq = { starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2026-11-12T09:30:00.000Z', kind: 'consultation', notes: 'Wants WhatsApp',
                  details: JSON.stringify({ call_type: 'demo', agency: 'Nowak Nieruchomości', agents: '6-20', crm: 'ASARI' }) };

test('12: the account mode is loaded', () => {
  assert.match(nodeOf(wf12, 'Load Tenant + Contact Info').parameters.query, /t\.name as tenant_name, t\.assistant_mode,/);
  assert.strictEqual(nodeOf(wf12, 'HTTP Request').parameters.url, '=https://www.googleapis.com/calendar/v3/calendars/{{ encodeURIComponent($json.google_calendar_id) }}/events?conferenceDataVersion=1');
});

test('12: a call becomes a calendar event with Google Meet and the agency details', () => {
  const ev = JSON.parse(expr(nodeOf(wf12, 'HTTP Request').parameters.jsonBody, { json: info, nodes: { 'When Executed by Another Workflow': callReq } }));
  assert.strictEqual(ev.summary, 'Elliot 30-min live demo — Anna Nowak (Nowak Nieruchomości)');
  assert.strictEqual(ev.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.match(ev.conferenceData.createRequest.requestId, /^elliot-\d+-[a-z0-9]+$/);
  assert.deepStrictEqual(ev.attendees, [{ email: 'anna@agency.pl' }]);
  assert.match(ev.description, /Agency: Nowak Nieruchomości\nAgents: 6-20\nCRM: ASARI\nPhone: \+48600\nNotes: Wants WhatsApp/);
});

test('12: a viewing event is unchanged (no Meet)', () => {
  const ev = JSON.parse(expr(nodeOf(wf12, 'HTTP Request').parameters.jsonBody, {
    json: { ...info, assistant_mode: 'agency', listing_title: 'Studio', agent_email: 'ag@x.pl', agent_invite: 'ag@x.pl' }, // 0042: Pick Calendar decides who's invited
    nodes: { 'When Executed by Another Workflow': { starts_at: 's', ends_at: 'e' } } }));
  assert.match(ev.summary, /^Property viewing — Anna Nowak — Studio$/);
  assert.ok(!ev.conferenceData);
  assert.deepStrictEqual(ev.attendees, [{ email: 'anna@agency.pl' }, { email: 'ag@x.pl' }]);
});

test('12: the call is saved with what it is and the Meet link', () => {
  const q = nodeOf(wf12, 'Insert Appointment').parameters.options.queryReplacement;
  const nodes = { 'When Executed by Another Workflow': { ...callReq, tenant_id: 't', contact_id: 'c' }, 'Load Tenant + Contact Info': info };
  const p = expr(q, { json: { id: 'ev1', hangoutLink: 'https://meet.google.com/xyz' }, nodes });
  assert.strictEqual(p[6], '30-min live demo · Agency: Nowak Nieruchomości · Agents: 6-20 · CRM: ASARI · Wants WhatsApp · Google Meet: https://meet.google.com/xyz');
  const v = expr(q, { json: { id: 'ev1' }, nodes: { ...nodes, 'When Executed by Another Workflow': { tenant_id: 't', contact_id: 'c', notes: 'Viewing note' } } });
  assert.strictEqual(v[6], 'Viewing note');
});

test('12: Format Results reports kind, label and Meet link', () => {
  const out = run(nodeOf(wf12, 'Format Results').parameters.jsCode, {
    json: { id: 'a1', starts_at: 's', ends_at: 'e', status: 'confirmed' },
    nodes: { 'Load Tenant + Contact Info': info, 'When Executed by Another Workflow': callReq, 'HTTP Request': { hangoutLink: 'https://meet.google.com/xyz' } },
  })[0].json;
  assert.deepStrictEqual([out.kind, out.call_label, out.meet_link], ['consultation', '30-minute live demo', 'https://meet.google.com/xyz']);
});

const confirm = (infoOver, booked, req) => run(nodeOf(wf12, 'Build Confirmation Email').parameters.jsCode, {
  json: booked, nodes: { 'Load Tenant + Contact Info': { ...info, ...infoOver }, 'When Executed by Another Workflow': req } })[0].json;

test('12: call confirmation in English and Polish with the Meet link', () => {
  const r = confirm({}, { kind: 'consultation', call_label: '30-minute live demo', meet_link: 'https://meet.google.com/xyz' }, callReq);
  assert.strictEqual(r.subject, 'Booked: Elliot 30-minute live demo, Thu 12 Nov 10:00');
  assert.match(r.body, /^Hi Anna,\n\nYour 30-minute live demo with Elliot is booked\.\n\nWhen: +Thursday, 12 November 2026, 10:00–10:30 \(Warsaw time\)\nGoogle Meet: +https:\/\/meet\.google\.com\/xyz/);
  assert.match(r.body, /potwierdzamy: 30-minutowa prezentacja na żywo z Elliot\./);
  assert.ok(!/viewing/i.test(r.body));
  const raw = fromB64url(r.raw_message);
  assert.match(raw, /^To: anna@agency\.pl\r\n/);
});

test('12: demo agency confirmations are clearly marked DEMO', () => {
  const r = confirm({ assistant_mode: 'demo', tenant_name: 'Demo Nieruchomości', listing_title: 'Studio' }, { kind: 'viewing' },
                    { starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2026-11-12T10:00:00.000Z' });
  assert.match(r.subject, /^\[DEMO\] Viewing confirmed: Thu 12 Nov, 10:00 – Studio$/);
  assert.match(r.body, /^Hi Anna,\n\nThis is a DEMO booking made on getelliot\.eu\./);
  assert.match(r.body, /To jest rezerwacja DEMO z getelliot\.eu/);
});

test('12: real agency confirmations are unchanged', () => {
  const r = confirm({ assistant_mode: 'agency', tenant_name: 'Simon Real Estate', listing_title: 'Studio' }, { kind: 'viewing' },
                    { starts_at: '2026-11-12T09:00:00.000Z', ends_at: '2026-11-12T10:00:00.000Z' });
  assert.strictEqual(r.subject, 'Viewing confirmed: Thu 12 Nov, 10:00 – Studio');
  assert.match(r.body, /^Hi Anna,\n\nYour viewing with Simon Real Estate is confirmed\./);
  assert.ok(!/DEMO/.test(r.body));
});

// ── 18 ──
test('18: contact-form requests become sales leads and go to the platform alert email', () => {
  assert.match(nodeOf(wf18, 'Insert Demo Request').parameters.query, /upsert_sales_lead\(ins\.name, ins\.email, null, ins\.company/);
  assert.match(nodeOf(wf18, 'Insert Demo Request').parameters.query, /sales_notify_email\(\) as notify_to/);
  const js = nodeOf(wf18, 'Build Notification Email').parameters.jsCode;
  assert.ok(!js.includes('spiritustec'), 'old hard-coded address still there');
  const r = run(js, { json: { name: 'A', company: 'C', email: 'a@x.pl', industry: 'Real Estate', employees: '1–10', notify_to: 'me@x.pl', created_at: 'now' } })[0].json;
  assert.match(fromB64url(r.raw_message), /^To: me@x\.pl\r\n/);
  assert.deepStrictEqual(next(wf18, 'Build Notification Email'), ['Has Notify Address?']);
  assert.deepStrictEqual(next(wf18, 'Has Notify Address?', 0), ['Send Notification']);
  assert.deepStrictEqual(next(wf18, 'Has Notify Address?', 1), ['Respond to Webhook']);
  assert.strictEqual(nodeOf(wf18, 'Send Notification').onError, 'continueRegularOutput');
});

// ── 35 ──
const future = new Date(Date.now() + 2 * 86400000).toISOString();
const validate = (body) => run(nodeOf(wf35, 'Validate Booking').parameters.jsCode, { json: { body } })[0].json;
const good = { type: 'demo', starts_at: future, name: ' Anna  Nowak ', email: 'Anna@Agency.PL', agency: 'Nowak', agents: '6-20', crm: 'ASARI', lang: 'pl' };

test('35: webhooks are public with CORS; booking and demo validated', () => {
  for (const [n, m, p] of [['Slots Webhook', 'GET', 'consultation-slots'], ['Book Webhook', 'POST', 'book-consultation'], ['Demo Access Webhook', 'POST', 'demo-access']]) {
    const h = nodeOf(wf35, n).parameters;
    assert.deepStrictEqual([h.httpMethod, h.path, h.options.allowedOrigins, h.responseMode], [m, p, '*', 'responseNode']);
  }
});

test('35: a good booking is cleaned and gets its end time from the call type', () => {
  const v = validate(good);
  assert.strictEqual(v.ok, true);
  assert.deepStrictEqual([v.name, v.email, v.type], ['Anna Nowak', 'anna@agency.pl', 'demo']);
  assert.strictEqual(new Date(v.ends_at) - new Date(v.starts_at), 30 * 60000);
  assert.deepStrictEqual(JSON.parse(v.details_json), { call_type: 'demo', agency: 'Nowak', agents: '6-20', crm: 'ASARI', lang: 'pl' });
  assert.strictEqual(new Date(validate({ ...good, type: 'intro' }).ends_at) - new Date(future), 15 * 60000);
});

test('35: bad bookings are refused with a clear message', () => {
  assert.deepStrictEqual(validate({ ...good, website: 'spam' }).ok, false);
  assert.strictEqual(validate({ ...good, type: 'other' }).error, 'Choose an intro call or a live demo.');
  assert.strictEqual(validate({ ...good, email: 'nope' }).error, 'Please enter a valid email address.');
  assert.strictEqual(validate({ ...good, agency: ' ' }).error, 'Please enter your agency name.');
  const soon = validate({ ...good, starts_at: new Date(Date.now() + 10 * 60000).toISOString() });
  assert.deepStrictEqual([soon.ok, soon.code], [false, 409]);
});

test('35: the booking goes to 12 as a consultation; the lead is saved first', () => {
  assert.match(nodeOf(wf35, 'Save Booking Lead').parameters.query, /upsert_sales_lead\(\$1, \$2, \$3, \$4, \$5::jsonb, 'consultation_booking'\)/);
  const v = nodeOf(wf35, 'Book Via 12').parameters;
  assert.strictEqual(v.workflowId.cachedResultName, '12 - Book Appointment');
  assert.strictEqual(v.workflowInputs.value.kind, 'consultation');
  const val = validate(good);
  assert.strictEqual(expr(v.workflowInputs.value.details, { nodes: { 'Validate Booking': val } }), val.details_json);
  assert.deepStrictEqual(next(wf35, 'Booking Valid?', 1), ['Respond Invalid']);
  assert.deepStrictEqual(next(wf35, 'Booking Account Exists?', 1), ['Respond Not Set Up']);
});

test('35: booking answers: success with Meet link, taken slot = 409', () => {
  const code = nodeOf(wf35, 'Booking Response').parameters.jsCode;
  const nodes = { 'Validate Booking': validate(good) };
  let r = run(code, { json: { success: true, starts_at: 's', ends_at: 'e', meet_link: 'https://meet.google.com/x', confirmation_sent_to: 'anna@agency.pl' }, nodes })[0].json;
  assert.deepStrictEqual([r.code, r.notify, r.body.meet_link, r.body.type], [200, true, 'https://meet.google.com/x', 'demo']);
  r = run(code, { json: { success: false, error: 'slot_unavailable' }, nodes })[0].json;
  assert.deepStrictEqual([r.code, r.notify, r.body.success], [409, false, false]);
  r = run(code, { json: { success: false, error: 'boom' }, nodes })[0].json;
  assert.strictEqual(r.code, 502);
});

test('35: free times come from 11 with the call length and 2 hours notice', () => {
  const v = run(nodeOf(wf35, 'Validate Slots Request').parameters.jsCode, { json: { query: { type: 'demo' } } })[0].json;
  assert.deepStrictEqual([v.type, v.minutes], ['demo', 30]);
  assert.strictEqual((new Date(v.date_range_end) - new Date(v.date_range_start)) / 86400000, 14);
  assert.strictEqual(run(nodeOf(wf35, 'Validate Slots Request').parameters.jsCode, { json: { query: { type: 'x' } } })[0].json.type, 'intro');
  const call = nodeOf(wf35, 'Free Times Via 11').parameters;
  assert.strictEqual(call.workflowId.cachedResultName, '11 - Check Availability');
  assert.strictEqual(call.workflowInputs.value.min_notice_minutes, '120');
  assert.strictEqual(expr(call.workflowInputs.value.duration_minutes, { nodes: { 'Validate Slots Request': v } }), '30');
  assert.strictEqual(call.workflowInputs.value.max_slots, '3000');
  const slot = (iso) => ({ starts_at: iso, ends_at: iso });
  const out = run(nodeOf(wf35, 'Slots Response').parameters.jsCode, {
    json: { available_slots: [slot('2026-12-01T08:00:00.000Z'), slot('2026-12-01T23:30:00.000Z'), slot('2026-12-03T09:00:00.000Z')], timezone: 'Europe/Warsaw' },
    nodes: { 'Validate Slots Request': v } })[0].json;
  // 23:30 UTC on 1 Dec is 00:30 on 2 Dec in Warsaw.
  assert.deepStrictEqual(out.body.days, [{ date: '2026-12-01', count: 1 }, { date: '2026-12-02', count: 1 }, { date: '2026-12-03', count: 1 }]);
  assert.deepStrictEqual([out.body.success, out.body.type, out.body.minutes, out.body.slots.length, out.body.more, out.body.last_date], [true, 'demo', 30, 3, false, v.last_date]);
});

test('35: the booking calendar asks for any month up to three months ahead, at most 42 days at once', () => {
  const ask = (query) => run(nodeOf(wf35, 'Validate Slots Request').parameters.jsCode, { json: { query: { type: 'intro', ...query } } })[0].json;
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const r1 = ask({ from: day(30), to: day(45) });
  assert.deepStrictEqual([r1.date_range_start, r1.date_range_end, r1.empty], [day(30), day(45), false]);
  // A month that started in the past begins today; one past the horizon is cut at it.
  assert.strictEqual(ask({ from: day(-10), to: day(5) }).date_range_start, today);
  const r2 = ask({ from: day(80), to: day(120) });
  assert.deepStrictEqual([r2.date_range_end, r2.last_date], [r2.last_date, r2.date_range_end]);
  assert.ok(new Date(r2.last_date) - new Date(today) <= 91 * 86400000);
  // Beyond the horizon altogether: nothing to show.
  assert.strictEqual(ask({ from: day(150), to: day(170) }).empty, true);
  // Longer than 42 days is cut; nonsense falls back to the next two weeks.
  const r3 = ask({ from: day(1), to: day(80) });
  assert.strictEqual((new Date(r3.date_range_end) - new Date(r3.date_range_start)) / 86400000, 42);
  const r4 = ask({ from: 'x', to: '2026-13-45' });
  assert.deepStrictEqual([r4.date_range_start, (new Date(r4.date_range_end) - new Date(r4.date_range_start)) / 86400000], [today, 14]);
  // Empty requests return no times even if 11 found some.
  const out = run(nodeOf(wf35, 'Slots Response').parameters.jsCode, {
    json: { available_slots: [{ starts_at: '2026-12-01T08:00:00.000Z', ends_at: 'b' }] }, nodes: { 'Validate Slots Request': { ...ask({ from: day(150) }), empty: true } } })[0].json;
  assert.deepStrictEqual([out.body.days, out.body.slots], [[], []]);
});

test('35: a booking more than three months ahead is refused', () => {
  const code = nodeOf(wf35, 'Validate Booking').parameters.jsCode;
  const body = (days) => ({ type: 'intro', starts_at: new Date(Date.now() + days * 86400000).toISOString(), name: 'A', email: 'a@x.pl', agency: 'Ag' });
  assert.strictEqual(run(code, { json: { body: body(60) } })[0].json.ok, true);
  assert.strictEqual(run(code, { json: { body: body(120) } })[0].json.ok, false);
});

test('35: demo access needs name, email and agency, and returns the demo agency', () => {
  const code = nodeOf(wf35, 'Validate Demo Access').parameters.jsCode;
  const ok = run(code, { json: { body: { name: 'A', email: 'A@X.PL', agency: 'Ag', lang: 'pl' } } })[0].json;
  assert.deepStrictEqual([ok.ok, ok.email, ok.lang], [true, 'a@x.pl', 'pl']);
  assert.strictEqual(run(code, { json: { body: { name: 'A', email: 'a@x.pl' } } })[0].json.error, 'Please enter your agency name.');
  const resp = nodeOf(wf35, 'Respond Demo Access').parameters;
  assert.deepStrictEqual(JSON.parse(expr(resp.responseBody, { json: { demo_slug: 'demo-nieruchomosci' } })), { success: true, tenant_slug: 'demo-nieruchomosci' });
  assert.strictEqual(expr(resp.options.responseCode, { json: {} }), 503);
  assert.match(nodeOf(wf35, 'Save Demo Lead').parameters.query, /'live_demo'\) as contact_id/);
});

test('35: you are emailed about bookings and demo visitors, after they have their answer', () => {
  assert.deepStrictEqual(next(wf35, 'Respond Booking'), ['Which Request?']);
  assert.deepStrictEqual(next(wf35, 'Respond Demo Access'), ['Which Request?']);
  const val = validate(good);
  const nodes = { 'Which Request?': { kind: 'booking' }, 'Save Booking Lead': { notify_to: 'me@x.pl' }, 'Validate Booking': val, 'Book Via 12': { meet_link: 'https://meet.google.com/x' } };
  const r = run(nodeOf(wf35, 'Build Owner Email').parameters.jsCode, { nodes })[0].json;
  assert.match(r.subject, /^New live demo: Nowak, /);
  const raw = fromB64url(r.raw_message);
  assert.match(raw, /^To: me@x\.pl\r\n/);
  const body = fromB64(raw.split('\r\n\r\n')[1]);
  assert.match(body, /Anna Nowak \(anna@agency\.pl\) booked a 30-minute live demo\./);
  assert.match(body, /Google Meet: https:\/\/meet\.google\.com\/x\nAgency: Nowak\nAgents: 6-20\nCRM: ASARI/);
  assert.strictEqual(nodeOf(wf35, 'Send Owner Email').onError, 'continueRegularOutput');
});

// ── 36 ──
test('36: nightly, deletes demo calendar events first, then demo data', () => {
  assert.deepStrictEqual(next(wf36, 'Every Night at 03:30'), ['Demo Events To Delete', 'Delete Old Demo Data']);
  assert.ok(nodeOf(wf36, 'Demo Events To Delete').position[1] < nodeOf(wf36, 'Delete Old Demo Data').position[1], 'events branch must run first');
  const url = expr(nodeOf(wf36, 'Delete Demo Event').parameters.url, { json: { calendar_id: 'abc@group.calendar.google.com', event_id: 'ev 1' } });
  assert.strictEqual(url, 'https://www.googleapis.com/calendar/v3/calendars/abc%40group.calendar.google.com/events/ev%201');
  assert.match(nodeOf(wf36, 'Delete Old Demo Data').parameters.query, /select demo_cleanup\(\) as result;/);
});

console.log(`\n${passed} passed`);
