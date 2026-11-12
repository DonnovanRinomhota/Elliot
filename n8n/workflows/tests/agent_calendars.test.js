// Tests for 0042: agents' own Google Calendars. 11 offers a time when at
// least one agent is free, 12 books into a free agent's calendar (the
// client's own agent first), 30 cancels in the calendar the viewing is in,
// and 41 checks what Elliot's Google account may do with each calendar.
//
// Run: node n8n/workflows/tests/agent_calendars.test.js
// (the slot test needs luxon on NODE_PATH; skipped otherwise)

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
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const wf11 = load('11-check-availability.json');
const wf12 = load('12-book-appointment.json');
const wf30 = load('30-cancel-appointment.json');
const wf41 = load('41-calendar-access-check.json');
console.log('agent_calendars');

// ── 11 ──
test('11: asks Google about every agent calendar at once', () => {
  assert.match(nodeOf(wf11, 'Load AI Config').parameters.query, /availability_calendars\(ac\.tenant_id\)/);
  const merge = nodeOf(wf11, 'Merge Config').parameters.jsCode;
  const m = (calendar_ids) => run(merge, { json: { google_calendar_id: 'office@a.pl', calendar_ids }, nodes: { 'When Executed by Another Workflow': { tenant_id: 't' } } })[0].json;
  assert.deepStrictEqual(m(['ola@a.pl', 'jan@a.pl']).calendar_ids, ['ola@a.pl', 'jan@a.pl']);
  assert.deepStrictEqual(m('["ola@a.pl"]').calendar_ids, ['ola@a.pl']);
  assert.deepStrictEqual(m([]).calendar_ids, ['office@a.pl']);
  const body = JSON.parse(expr(nodeOf(wf11, 'Get Busy Times (Google FreeBusy API)').parameters.jsonBody,
    { json: { date_range_start: '2026-12-01', date_range_end: '2026-12-02', timezone: 'Europe/Warsaw', calendar_ids: ['ola@a.pl', 'jan@a.pl'] } }));
  assert.deepStrictEqual(body, { timeMin: '2026-12-01T00:00:00.000Z', timeMax: '2026-12-02T23:59:59.000Z', timeZone: 'Europe/Warsaw', items: [{ id: 'ola@a.pl' }, { id: 'jan@a.pl' }] });
});

let DateTime = null;
try { ({ DateTime } = require('luxon')); } catch (e) { /* skipped */ }
test('11: a time is free when at least one agent is; unreadable calendars are left out', () => {
  if (!DateTime) { console.log('    (skipped: luxon not installed)'); return; }
  const day = DateTime.now().setZone('Europe/Warsaw').plus({ days: 3 }).toISODate();
  const dn = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][DateTime.fromISO(day).weekday % 7];
  const at = (h) => DateTime.fromISO(`${day}T${h}`, { zone: 'Europe/Warsaw' }).toUTC().toISO();
  const config = { date_range_start: day, date_range_end: day, timezone: 'Europe/Warsaw', duration_minutes: 60, buffer_minutes: 0,
    business_hours: { [dn]: { open: '10:00', close: '13:00' } }, calendar_ids: ['ola@a.pl', 'jan@a.pl'] };
  const slots = (calendars) => run(nodeOf(wf11, 'Compute Available Slots').parameters.jsCode,
    { json: { calendars }, nodes: { 'Merge Config': config }, globals: { DateTime } })[0].json.available_slots.map((s) => DateTime.fromISO(s.starts_at).setZone('Europe/Warsaw').toFormat('HH:mm'));
  // Ola busy 10-12, Jan busy 11-13: 10:00 (Jan free), 11:00 taken (both busy), 12:00 (Ola free).
  assert.deepStrictEqual(slots({ 'ola@a.pl': { busy: [{ start: at('10:00'), end: at('12:00') }] }, 'jan@a.pl': { busy: [{ start: at('11:00'), end: at('13:00') }] } }), ['10:00', '12:00']);
  // Jan's calendar isn't shared: only Ola counts.
  assert.deepStrictEqual(slots({ 'ola@a.pl': { busy: [{ start: at('10:00'), end: at('12:00') }] }, 'jan@a.pl': { errors: [{ reason: 'notFound' }], busy: [] } }), ['12:00']);
  // Nothing readable: as before (every slot), so the booking reports the problem.
  assert.deepStrictEqual(slots({ 'ola@a.pl': { errors: [{ reason: 'notFound' }] }, 'jan@a.pl': { errors: [{ reason: 'notFound' }] } }), ['10:00', '11:00', '12:00']);
});

test('11: opening hours stored as text still work; a malformed day counts as closed', () => {
  if (!DateTime) { console.log('    (skipped: luxon not installed)'); return; }
  const day = DateTime.now().setZone('Europe/Warsaw').plus({ days: 3 }).toISODate();
  const dn = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][DateTime.fromISO(day).weekday % 7];
  const base = { date_range_start: day, date_range_end: day, timezone: 'Europe/Warsaw', duration_minutes: 60, buffer_minutes: 0, calendar_ids: ['primary'] };
  const slots = (business_hours) => run(nodeOf(wf11, 'Compute Available Slots').parameters.jsCode,
    { json: { calendars: { primary: { busy: [] } } }, nodes: { 'Merge Config': { ...base, business_hours } }, globals: { DateTime } })[0].json.available_slots.length;
  assert.strictEqual(slots(JSON.stringify({ [dn]: { open: '10:00', close: '12:00' } })), 2);
  assert.strictEqual(slots({ [dn]: { closed: true } }), 0);
  assert.strictEqual(slots({ [dn]: { open: '', close: '17:00' } }), 0);
  assert.strictEqual(slots('not json'), 0);
});

// ── 12 ──
const req = { tenant_id: 't', contact_id: 'c', starts_at: '2026-12-01T10:00:00.000Z', ends_at: '2026-12-01T11:00:00.000Z' };
const OLA = { calendar_id: 'ola@a.pl', agent_id: 'u-ola', agent_email: 'ola@a.pl', agent_name: 'Ola', mode: 'agents', is_owner: false, db_busy: false, upcoming: 3 };
const JAN = { calendar_id: 'jan@a.pl', agent_id: 'u-jan', agent_email: 'jan@a.pl', agent_name: 'Jan', mode: 'agents', is_owner: true, db_busy: false, upcoming: 9 };
const KASIA = { calendar_id: 'kasia-cal@group.calendar.google.com', agent_id: 'u-k', agent_email: 'kasia@a.pl', agent_name: 'Kasia', mode: 'agents', is_owner: false, db_busy: false, upcoming: 1 };
const pick = (candidates, calendars, status = 200, info = {}) => run(nodeOf(wf12, 'Pick Calendar').parameters.jsCode, {
  json: { statusCode: status, body: { calendars } },
  nodes: { 'Load Tenant + Contact Info': { google_calendar_id: 'office@a.pl', booking_buffer_minutes: 30, candidates, contact_name: 'Anna', ...info },
           'When Executed by Another Workflow': req } })[0].json;
const busyAt = (s, e) => ({ busy: [{ start: s, end: e }] });

test('12: wired as load → check calendars → pick → free? → create event', () => {
  assert.deepStrictEqual(next(wf12, 'Load Tenant + Contact Info'), ['Check Calendars (FreeBusy)']);
  assert.deepStrictEqual(next(wf12, 'Check Calendars (FreeBusy)'), ['Pick Calendar']);
  assert.deepStrictEqual(next(wf12, 'Pick Calendar'), ['Calendar Free?']);
  assert.deepStrictEqual(next(wf12, 'Calendar Free?', 0), ['HTTP Request']);
  assert.deepStrictEqual(next(wf12, 'Calendar Free?', 1), ['No Free Calendar']);
  assert.match(nodeOf(wf12, 'Load Tenant + Contact Info').parameters.query, /booking_candidates\(\$1, \$2, \$6::timestamptz, \$7::timestamptz\)/);
  const fb = JSON.parse(expr(nodeOf(wf12, 'Check Calendars (FreeBusy)').parameters.jsonBody, {
    json: { candidates: JSON.stringify([OLA, JAN, OLA]), booking_buffer_minutes: 30 }, nodes: { 'When Executed by Another Workflow': req } }));
  assert.deepStrictEqual(fb, { timeMin: '2026-12-01T09:30:00.000Z', timeMax: '2026-12-01T11:30:00.000Z', items: [{ id: 'ola@a.pl' }, { id: 'jan@a.pl' }] });
  const none = run(nodeOf(wf12, 'No Free Calendar').parameters.jsCode, { json: { checked: [] } })[0].json;
  assert.deepStrictEqual([none.success, none.error], [false, 'slot_unavailable']);
});

test('12: the client\'s own agent first, else the least busy free agent; buffer and dashboard bookings count', () => {
  const free = { busy: [] };
  let p = pick([OLA, JAN, KASIA], { 'ola@a.pl': free, 'jan@a.pl': free, 'kasia-cal@group.calendar.google.com': free });
  assert.deepStrictEqual([p.ok, p.google_calendar_id, p.agent_id, p.agent_name, p.agent_invite], [true, 'jan@a.pl', 'u-jan', 'Jan', null]);
  // Jan has something ending 09:45: inside the 30-minute buffer.
  p = pick([OLA, JAN, KASIA], { 'ola@a.pl': free, 'jan@a.pl': busyAt('2026-12-01T09:00:00Z', '2026-12-01T09:45:00Z'), 'kasia-cal@group.calendar.google.com': free });
  assert.deepStrictEqual([p.agent_name, p.agent_invite], ['Kasia', 'kasia@a.pl']); // fewest upcoming; invited, calendar isn't her email
  p = pick([OLA, JAN, { ...KASIA, db_busy: true }], { 'ola@a.pl': free, 'jan@a.pl': busyAt('2026-12-01T10:30:00Z', '2026-12-01T11:00:00Z'), 'kasia-cal@group.calendar.google.com': free });
  assert.strictEqual(p.agent_name, 'Ola');
  p = pick([OLA, JAN], { 'ola@a.pl': busyAt('2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z'), 'jan@a.pl': { errors: [{ reason: 'notFound' }] } });
  assert.strictEqual(p.ok, false);
});

test('12: Google not answering falls back to the database rule; the agency calendar works as before', () => {
  let p = pick([OLA, { ...JAN, db_busy: true }], {}, 500);
  assert.deepStrictEqual([p.ok, p.agent_name], [true, 'Ola']);
  const office = { calendar_id: 'office@a.pl', agent_id: 'u-jan', agent_email: 'jan@a.pl', agent_name: 'Jan', mode: 'agency', is_owner: false, db_busy: false, upcoming: 0 };
  p = pick([office], { 'office@a.pl': { busy: [] } });
  assert.deepStrictEqual([p.ok, p.google_calendar_id, p.calendar_mode, p.agent_invite], [true, 'office@a.pl', 'agency', 'jan@a.pl']);
  p = pick([office], { 'office@a.pl': busyAt('2026-12-01T10:00:00Z', '2026-12-01T10:30:00Z') });
  assert.strictEqual(p.ok, false); // someone put something in the office calendar since
  p = pick('[]', {}, 200, { agent_email: 'x@a.pl', agent_name: 'X' });
  assert.deepStrictEqual([p.ok, p.google_calendar_id, p.agent_name], [true, 'office@a.pl', 'X']);
});

test('12: the event goes in the picked calendar, the agent and calendar are saved, cleanup uses it', () => {
  const http = nodeOf(wf12, 'HTTP Request').parameters;
  assert.strictEqual(expr(http.url.replace(/^=/, '={{ `').replace(/\{\{ encode/, '${encode').replace(/\) \}\}\/events/, ')}/events') + '` }}', { json: { google_calendar_id: 'kasia-cal@group.calendar.google.com' } }),
    'https://www.googleapis.com/calendar/v3/calendars/kasia-cal%40group.calendar.google.com/events?conferenceDataVersion=1');
  const ev = JSON.parse(expr(http.jsonBody, { json: { timezone: 'Europe/Warsaw', contact_name: 'Anna', contact_email: 'anna@x.pl', agent_email: 'kasia@a.pl', agent_invite: null, agent_name: 'Kasia' },
    nodes: { 'When Executed by Another Workflow': req } }));
  assert.deepStrictEqual(ev.attendees, [{ email: 'anna@x.pl' }]);
  assert.match(ev.description, /Agent: Kasia/);
  const ins = nodeOf(wf12, 'Insert Appointment').parameters;
  const p = expr(ins.options.queryReplacement, { json: { id: 'ev1' }, nodes: { 'When Executed by Another Workflow': req,
    'Load Tenant + Contact Info': { timezone: 'Europe/Warsaw' }, 'Pick Calendar': { agent_id: 'u-k', google_calendar_id: 'kasia-cal@group.calendar.google.com' } } });
  assert.deepStrictEqual(p.slice(10, 12), ['u-k', 'kasia-cal@group.calendar.google.com']);
  assert.match(nodeOf(wf12, 'Delete Orphaned Calendar Event').parameters.url, /encodeURIComponent\(\$\('Pick Calendar'\)\.first\(\)\.json\.google_calendar_id\)/);
  const fr = run(nodeOf(wf12, 'Format Results').parameters.jsCode, { json: { id: 'a1' }, nodes: {
    'When Executed by Another Workflow': req, 'HTTP Request': {}, 'Load Tenant + Contact Info': {}, 'Pick Calendar': { agent_name: 'Kasia' } } })[0].json;
  assert.strictEqual(fr.agent_name, 'Kasia');
});

// ── 30 ──
test('30: cancelling deletes the event from the calendar it was put in', () => {
  assert.match(nodeOf(wf30, 'Load Appointment').parameters.query, /coalesce\(\(select nullif\(booked_calendar_id, ''\) from appointments/);
});

// ── 41 ──
const results = (calendars, added, fbCals, acct = { statusCode: 200, body: { id: 'elliot.cal@gmail.com' } }) =>
  run(nodeOf(wf41, 'Read Results').parameters.jsCode, { nodes: {
    'Split Calendars': calendars, "Add To Elliot's Calendars": added,
    'Check Free Times': { statusCode: 200, body: { calendars: fbCals } }, "Elliot's Google Account": acct } })[0].json;

test('41: protected webhook; one Google call per calendar plus one free-busy check', () => {
  const hook = nodeOf(wf41, 'Calendar Check Webhook');
  assert.deepStrictEqual([hook.parameters.path, hook.parameters.authentication, hook.credentials.httpHeaderAuth.name], ['calendar-check', 'headerAuth', 'Elliot Internal Webhook Secret']);
  const chain = ['Calendar Check Webhook', 'Calendars To Check', 'Split Calendars', "Add To Elliot's Calendars", 'Check Free Times', "Elliot's Google Account", 'Read Results', 'Save Results', 'Respond'];
  for (let i = 0; i < chain.length - 1; i++) assert.deepStrictEqual(next(wf41, chain[i]), [chain[i + 1]], chain[i]);
  for (const n of ['Check Free Times', "Elliot's Google Account", 'Read Results', 'Save Results']) assert.strictEqual(nodeOf(wf41, n).executeOnce, true, n);
  const split = run(nodeOf(wf41, 'Split Calendars').parameters.jsCode, { json: { calendars: '[]' } });
  assert.deepStrictEqual(split.map((i) => i.json), [{ kind: 'none', calendar_id: '' }]);
});

test('41: reads what Elliot may do with each calendar', () => {
  const cals = [
    { kind: 'agent', member_id: 'm1', calendar_id: 'ola@a.pl' },
    { kind: 'agent', member_id: 'm2', calendar_id: 'jan@a.pl' },
    { kind: 'agent', member_id: 'm3', calendar_id: 'typo@a.pl' },
    { kind: 'agency', member_id: null, calendar_id: 'office@a.pl' },
  ];
  const r = results(cals, [
    { statusCode: 200, body: { id: 'ola@a.pl', accessRole: 'writer' } },
    { statusCode: 200, body: { id: 'jan@a.pl', accessRole: 'reader' } },
    { statusCode: 404, body: { error: { message: 'Not Found' } } },
    { statusCode: 409, body: { error: { message: 'Already Exists' } } },
  ], { 'ola@a.pl': { busy: [] }, 'jan@a.pl': { busy: [] }, 'typo@a.pl': { errors: [{ reason: 'notFound' }] }, 'office@a.pl': { busy: [] } });
  assert.strictEqual(r.account_email, 'elliot.cal@gmail.com');
  assert.deepStrictEqual(r.results.map((x) => [x.member_id, x.status, x.role]), [['m1', 'ok', 'writer'], ['m2', 'read_only', 'reader'], ['m3', 'not_shared', ''], [null, 'ok', '']]);
  const odd = results([cals[0]], [{ statusCode: 500, body: { error: { message: 'Backend Error' } } }], { 'ola@a.pl': { busy: [] } });
  assert.deepStrictEqual([odd.results[0].status, odd.results[0].error], ['error', 'Backend Error']);
  const save = nodeOf(wf41, 'Save Results').parameters;
  assert.match(save.query, /record_calendar_checks\(\$1::uuid, \$2::jsonb, \$3\)/);
  assert.deepStrictEqual(expr(save.options.queryReplacement, { json: r, nodes: { 'Calendar Check Webhook': { body: { tenant_id: 't' } } } }), ['t', JSON.stringify(r.results), 'elliot.cal@gmail.com']);
});

console.log(`${passed} passed`);
