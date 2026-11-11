// Tests for 0039: every agency email goes out through workflow 39 (Resend,
// from the agency's name, Reply-To the agency), and email forwarded to
// <slug>@in.getelliot.eu is answered by workflow 40. Runs the nodes' code and
// expressions out of the workflow JSON.
//
// Run: node n8n/workflows/tests/agency_email.test.js

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
const cond = (wf, name) => nodeOf(wf, name).parameters.conditions.conditions[0].leftValue;
const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const wf39 = load('39-send-email.json');
const wf40 = load('40-email-inbound-forwarded.json');
const T = '11111111-1111-1111-1111-111111111111';
const AGENCY = { name: 'Simon Real Estate', address: 'simon@mail.getelliot.eu', reply_to: 'biuro@simon.pl', inbound_address: 'simon@in.getelliot.eu', own_domain: false };
const build39 = (input, sender = AGENCY) =>
  run(nodeOf(wf39, 'Build Resend Email').parameters.jsCode, { json: { sender }, nodes: { 'When Executed by Another Workflow': input } })[0].json;
const result39 = (nodes) => run(nodeOf(wf39, 'Result').parameters.jsCode, { nodes })[0].json;

console.log('agency_email');

// ── 39 ──
test('39: wired as trigger → sender → build → Resend, Gmail only for the team', () => {
  assert.deepStrictEqual(next(wf39, 'When Executed by Another Workflow'), ['Load Sender']);
  assert.deepStrictEqual(next(wf39, 'Load Sender'), ['Build Resend Email']);
  assert.deepStrictEqual(next(wf39, 'Has Recipient?', 0), ['Send via Resend']);
  assert.deepStrictEqual(next(wf39, 'Has Recipient?', 1), ['Result']);
  assert.deepStrictEqual(next(wf39, 'Team Email Failed?', 0), ['Send via Gmail (team fallback)']);
  assert.deepStrictEqual(next(wf39, 'Team Email Failed?', 1), ['Result']);
  assert.deepStrictEqual(next(wf39, 'Send via Gmail (team fallback)'), ['Result']);
  const load = nodeOf(wf39, 'Load Sender').parameters;
  assert.match(load.query, /email_sender\(nullif\(\$1, ''\)::uuid, \$2\)/);
  assert.deepStrictEqual(expr(load.options.queryReplacement, { json: { tenant_id: T, audience: 'team' } }), [T, 'team']);
  assert.deepStrictEqual(expr(load.options.queryReplacement, { json: { audience: 'whatever' } }), ['', 'client']);
  const resend = nodeOf(wf39, 'Send via Resend');
  assert.strictEqual(resend.parameters.url, 'https://api.resend.com/emails');
  assert.strictEqual(resend.credentials.httpHeaderAuth.name, 'Resend API key');
  assert.strictEqual(resend.parameters.options.response.response.neverError, true);
  const failed = cond(wf39, 'Team Email Failed?');
  assert.strictEqual(expr(failed, { json: { statusCode: 422 }, nodes: { 'Build Resend Email': { audience: 'team' } } }), true);
  assert.strictEqual(expr(failed, { json: { statusCode: 422 }, nodes: { 'Build Resend Email': { audience: 'client' } } }), false);
  assert.strictEqual(expr(failed, { json: { statusCode: 200 }, nodes: { 'Build Resend Email': { audience: 'team' } } }), false);
});

test('39: a Gmail-style raw email becomes a Resend email from the agency, replies to the agency', () => {
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const raw = b64url(['To: anna@x.pl', `Subject: =?UTF-8?B?${b64('Viewing confirmed: Płochocińska')}?=`, 'In-Reply-To: <m1@x.pl>', 'References: <m0@x.pl> <m1@x.pl>',
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'].join('\r\n') + '\r\n\r\n' + b64('Dzień dobry,\nżółć\n'));
  const out = build39({ tenant_id: T, audience: 'client', raw_message: raw });
  assert.strictEqual(out.ok_to_send, true);
  assert.deepStrictEqual(out.email, {
    from: '"Simon Real Estate" <simon@mail.getelliot.eu>', to: ['anna@x.pl'], subject: 'Viewing confirmed: Płochocińska',
    text: 'Dzień dobry,\nżółć\n', reply_to: ['biuro@simon.pl'], headers: { 'In-Reply-To': '<m1@x.pl>', References: '<m0@x.pl> <m1@x.pl>' } });
  // The Gmail copy (team fallback) says the same.
  const g = Buffer.from(out.gmail_raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(g, /^To: anna@x\.pl\r\n/);
  assert.match(g, /In-Reply-To: <m1@x\.pl>/);
});

test('39: plain (unencoded) raw emails, several recipients, team audience, structured input', () => {
  const raw = b64url('To: a@x.pl, b@x.pl\r\nSubject: [Elliot] Simon: 2 new leads, 1 viewing today\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nGood morning Ania,\n\nLine 2 ąę');
  const out = build39({ tenant_id: T, audience: 'team', raw_message: raw }, { name: 'Elliot · Simon "RE"', address: 'simon@mail.getelliot.eu', reply_to: null });
  assert.deepStrictEqual(out.email.to, ['a@x.pl', 'b@x.pl']);
  assert.strictEqual(out.email.subject, '[Elliot] Simon: 2 new leads, 1 viewing today');
  assert.strictEqual(out.email.text, 'Good morning Ania,\n\nLine 2 ąę');
  assert.strictEqual(out.email.from, '"Elliot · Simon RE" <simon@mail.getelliot.eu>');
  assert.ok(!('reply_to' in out.email) && !('headers' in out.email));
  assert.strictEqual(out.audience, 'team');
  const s = build39({ tenant_id: T, audience: 'client', to: 'c@x.pl', subject: 'Re: Flat', text: 'Hi', in_reply_to: '<z@x>', references: '<y@x> <z@x>' }, '{"name":"S","address":"s@mail.getelliot.eu","reply_to":"s@in.getelliot.eu"}');
  assert.deepStrictEqual(s.email, { from: '"S" <s@mail.getelliot.eu>', to: ['c@x.pl'], subject: 'Re: Flat', text: 'Hi', reply_to: ['s@in.getelliot.eu'], headers: { 'In-Reply-To': '<z@x>', References: '<y@x> <z@x>' } });
  // No usable recipient: nothing is sent.
  assert.strictEqual(build39({ tenant_id: T, raw_message: b64url('To: not-an-email\r\nSubject: x\r\n\r\nx') }).ok_to_send, false);
  assert.strictEqual(build39({}, {}).email.from, '"Elliot" <notifications@mail.getelliot.eu>');
});

test('39: one answer shape for every caller', () => {
  const built = { ok_to_send: true, audience: 'client', email: { from: 'F', to: ['a@x.pl'] } };
  const ok = result39({ 'Build Resend Email': built, 'Send via Resend': { statusCode: 200, body: { id: 're_1' } } });
  assert.deepStrictEqual([ok.ok, ok.statusCode, ok.id, ok.error, ok.body, ok.provider], [true, 200, 're_1', null, { id: 're_1' }, 'Resend']);
  const bad = result39({ 'Build Resend Email': built, 'Send via Resend': { statusCode: 403, body: { statusCode: 403, name: 'validation_error', message: 'The simon.pl domain is not verified.' } } });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.statusCode, 403);
  assert.strictEqual(bad.error.message, 'Resend: The simon.pl domain is not verified.');
  assert.deepStrictEqual(bad.body, { error: bad.error });
  const team = result39({ 'Build Resend Email': { ...built, audience: 'team' }, 'Send via Resend': { statusCode: 500, body: 'oops' }, 'Send via Gmail (team fallback)': { statusCode: 200, body: { id: 'gm1' } } });
  assert.deepStrictEqual([team.ok, team.id, team.provider], [true, 'gm1', 'Gmail']);
  const none = result39({ 'Build Resend Email': { ...built, ok_to_send: false } });
  assert.deepStrictEqual([none.ok, none.error.message], [false, 'no valid recipient']);
});

// ── the callers ──
const CALLERS = [
  ['12-book-appointment.json', 'Send Confirmation Email', 'client'],
  ['15-send-approved-email.json', 'Send Email', 'client'],
  ['18-demo-request-intake.json', 'Send Notification', 'team'],
  ['20-follow-up-sweep.json', 'Send Email', 'client'],
  ['24-escalate-to-human.json', 'Send Notification', 'team'],
  ['31-daily-summary-email.json', 'Send Email', 'team'],
  ['35-website-booking-and-demo.json', 'Send Owner Email', 'team'],
  ['37-client-viewing-changes.json', 'Send Email', null],
  ['38-viewing-reminders.json', 'Send Email Reminder', 'client'],
  ['40-email-inbound-forwarded.json', 'Send Reply', 'client'],
];

test('every agency email goes through 39; Gmail is left only in 16 (its own inbox) and 33/39 fallbacks', () => {
  for (const [file, name, audience] of CALLERS) {
    const wf = load(file);
    const n = nodeOf(wf, name);
    assert.strictEqual(n.type, 'n8n-nodes-base.executeWorkflow', file);
    assert.strictEqual(n.parameters.workflowId.cachedResultName, '39 - Send Email', file);
    assert.strictEqual(n.parameters.mode, 'each', file);
    assert.strictEqual(n.onError, 'continueRegularOutput', file);
    if (audience) assert.strictEqual(n.parameters.workflowInputs.value.audience, audience, file);
  }
  for (const file of fs.readdirSync(WF_DIR).filter((f) => f.endsWith('.json') && /^\d\d-/.test(f))) {
    const s = fs.readFileSync(path.join(WF_DIR, file), 'utf8');
    const sends = (s.match(/gmail\/v1\/users\/me\/messages\/send/g) || []).length;
    const allowed = { '16-email-inbound-trigger.json': 1, '33-health-check.json': 1, '39-send-email.json': 1 }[file] || 0;
    assert.strictEqual(sends, allowed, `${file} still sends through Gmail`);
  }
  const wf20 = load('20-follow-up-sweep.json');
  assert.strictEqual(nodeOf(wf20, 'Send Email').continueOnFail, true);
  assert.deepStrictEqual(next(wf20, 'Send Email'), ['Merge Before Advance']);
});

test('callers pass the right agency', () => {
  const v = (file, name) => nodeOf(load(file), name).parameters.workflowInputs.value;
  assert.strictEqual(expr(v('12-book-appointment.json', 'Send Confirmation Email').tenant_id, { nodes: { 'When Executed by Another Workflow': { tenant_id: T } } }), T);
  assert.strictEqual(expr(v('15-send-approved-email.json', 'Send Email').tenant_id, { nodes: { 'Load Draft': { tenant_id: T } } }), T);
  assert.strictEqual(v('18-demo-request-intake.json', 'Send Notification').tenant_id, '');
  assert.strictEqual(expr(v('20-follow-up-sweep.json', 'Send Email').tenant_id, { json: { tenant_id: T } }), T);
  assert.strictEqual(expr(v('24-escalate-to-human.json', 'Send Notification').tenant_id, { nodes: { 'Validate And Default': { tenant_id: T } } }), T);
  assert.strictEqual(expr(v('37-client-viewing-changes.json', 'Send Email').tenant_id, { nodes: { 'Validate Change': { tenant_id: T } } }), T);
  const aud = v('37-client-viewing-changes.json', 'Send Email').audience;
  assert.strictEqual(expr(aud, { json: { kind: 'team' } }), 'team');
  assert.strictEqual(expr(aud, { json: { kind: 'client' } }), 'client');
  const r38 = v('38-viewing-reminders.json', 'Send Email Reminder');
  assert.strictEqual(expr(r38.raw_message, { nodes: { 'Build Reminder': { raw_message: 'RAW' } } }), 'RAW');
  assert.strictEqual(expr(r38.tenant_id, { nodes: { 'Build Reminder': { tenant_id: T } } }), T);
});

test('31 and 38 now carry the agency through, and the real emails read correctly in 39', () => {
  const wf31 = load('31-daily-summary-email.json');
  const s = run(nodeOf(wf31, 'Build Summary Email').parameters.jsCode, { json: { tenant_id: T, tenant_name: 'Simon', recipient_name: 'Ania', recipient_email: 'ania@simon.pl',
    conversations_count: 3, new_leads_count: 2, viewings_booked_count: 1, viewings_today: [], hot_leads: [] } }).json;
  assert.strictEqual(s.tenant_id, T);
  const e = build39({ tenant_id: T, audience: 'team', raw_message: s.raw_message }).email;
  assert.deepStrictEqual(e.to, ['ania@simon.pl']);
  assert.strictEqual(e.subject, '[Elliot] Simon: 2 new leads, 0 viewings today');
  assert.match(e.text, /^Good morning Ania,/);

  const wf38 = load('38-viewing-reminders.json');
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const r = run(nodeOf(wf38, 'Build Reminder').parameters.jsCode, { json: { appointment_id: 'a', tenant_id: T, tenant_name: 'Simon', assistant_mode: 'agency',
    timezone: 'Europe/Warsaw', starts_at: tomorrow, contact_name: 'Anna Nowak', contact_email: 'anna@x.pl', conversation_channel: 'email', listing_title: 'Studio' } }).json;
  assert.strictEqual(r.tenant_id, T);
  const e38 = build39({ tenant_id: T, audience: 'client', raw_message: r.raw_message }).email;
  assert.match(e38.subject, /^Reminder: viewing tomorrow at \d\d:\d\d – Studio$/);
  assert.match(e38.text, /Dzień dobry Anna/);
  assert.deepStrictEqual(e38.reply_to, ['biuro@simon.pl']);
});

test('what callers read back still works with 39\'s answer', () => {
  const ok = { ok: true, statusCode: 200, id: 're_1', error: null, body: { id: 're_1' } };
  const bad = { ok: false, statusCode: 403, id: null, error: { message: 'Resend: domain not verified' }, body: { error: { message: 'Resend: domain not verified' } } };
  const wf12 = load('12-book-appointment.json');
  const br = nodeOf(wf12, 'Booking Result').parameters.jsCode;
  const base = { 'Format Results': { success: true }, 'Build Confirmation Email': { to: 'anna@x.pl' } };
  assert.strictEqual(run(br, { nodes: { ...base, 'Send Confirmation Email': ok } })[0].json.confirmation_sent_to, 'anna@x.pl');
  const f = run(br, { nodes: { ...base, 'Send Confirmation Email': bad } })[0].json;
  assert.deepStrictEqual([f.confirmation_sent_to, f.confirmation_error], [null, 'Resend: domain not verified']);
  // The node failing outright (continueRegularOutput gives { error }) is still a clear "not sent".
  assert.strictEqual(run(br, { nodes: { ...base, 'Send Confirmation Email': { error: 'boom' } } })[0].json.confirmation_sent_to, null);

  const wf38 = load('38-viewing-reminders.json');
  const ce = nodeOf(wf38, 'Check Email').parameters.jsCode;
  assert.strictEqual(run(ce, { json: ok, nodes: { 'Build Reminder': { appointment_id: 'a' } } }).json.ok, true);
  const no = run(ce, { json: bad, nodes: { 'Build Reminder': { appointment_id: 'a' } } }).json;
  assert.deepStrictEqual([no.ok, no.error], [false, 'Resend: domain not verified']);
});

// ── 40 ──
const resendEmail = (over = {}) => ({ statusCode: 200, body: {
  object: 'email', id: 'em_1', to: ['biuro@simon.pl'], from: 'anna@x.pl', subject: 'Studio na Płochocińskiej',
  received_for: ['simon@in.getelliot.eu'], cc: [], bcc: [], reply_to: [],
  text: 'Dzień dobry,\nczy studio jest dostępne?\n\nAnna\n\nW dniu pon., 9 lis 2026 o 10:00 Simon <biuro@simon.pl> napisał:\n> stara wiadomość',
  html: '<p>ignored</p>',
  headers: { from: 'Anna Nowak <anna@x.pl>', 'message-id': '<CAB1@mail.gmail.com>', references: '<old@simon.pl>' },
  message_id: '<CAB1@mail.gmail.com>', ...over } });
const extract40 = (resp) => run(nodeOf(wf40, 'Extract Email Fields').parameters.jsCode, { json: resp })[0].json;

test('40: Resend webhook → fetch the email with our key → agency → Elliot → reply through 39', () => {
  const hook = nodeOf(wf40, 'Resend Webhook').parameters;
  assert.deepStrictEqual([hook.httpMethod, hook.path, hook.responseMode], ['POST', 'email-inbound', 'onReceived']);
  const ev = cond(wf40, 'Email Received?');
  assert.strictEqual(expr(ev, { json: { body: { type: 'email.received', data: { email_id: 'em_1' } } } }), true);
  assert.strictEqual(expr(ev, { json: { body: { type: 'email.sent', data: { email_id: 'em_1' } } } }), false);
  assert.strictEqual(expr(ev, { json: { body: {} } }), false);
  const fetch = nodeOf(wf40, 'Fetch Email');
  assert.strictEqual(expr('={{ `' + fetch.parameters.url.slice(1).replace('{{ ', '${').replace(' }}', '}') + '` }}', { json: { body: { data: { email_id: 'em_1' } } } }), 'https://api.resend.com/emails/receiving/em_1');
  assert.strictEqual(fetch.credentials.httpHeaderAuth.name, 'Resend API key');
  const chain = ['Resend Webhook', 'Email Received?', 'Fetch Email', 'Extract Email Fields', 'Find Agency', 'Agency Found?', 'Gmail Forwarding Code?'];
  for (let i = 0; i < chain.length - 1; i++) assert.deepStrictEqual(next(wf40, chain[i]), [chain[i + 1]], chain[i]);
  assert.deepStrictEqual(next(wf40, 'Agency Found?', 1), ['Log Unknown Address']);
  assert.deepStrictEqual(next(wf40, 'Gmail Forwarding Code?', 0), ['Save Forwarding Code']);
  assert.deepStrictEqual(next(wf40, 'Gmail Forwarding Code?', 1), ['Should Answer?']);
  const rest = ['Should Answer?', 'Claim Message', 'Is New Message?', 'Upsert Contact', 'Get or Create Conversation (Email)', 'Storage Address', 'List Attachments', 'Attachment Files', 'Has Attachments?',
    'Download Attachment', 'Upload Attachment', 'Record Attachment', 'Sign Attachment', 'Collect Attachments', 'Build Elliot Request', 'Ask Elliot', 'Read Elliot Answer']; // 0046: attachments
  for (let i = 0; i < rest.length - 1; i++) assert.deepStrictEqual(next(wf40, rest[i]), [rest[i + 1]], rest[i]);
  assert.deepStrictEqual(next(wf40, 'Read Elliot Answer'), ['Has Reply?', 'Elliot Failed?']);
  assert.deepStrictEqual(next(wf40, 'Has Reply?'), ['Build Reply Email']);
  assert.deepStrictEqual(next(wf40, 'Build Reply Email'), ['Send Reply']);
  assert.deepStrictEqual(next(wf40, 'Send Reply'), ['Check Send Result']);
  assert.deepStrictEqual(next(wf40, 'Check Send Result'), ['Send Failed?']);
  assert.deepStrictEqual(next(wf40, 'Send Failed?'), ['Log Send Failure']);
  assert.ok(!JSON.stringify(wf40).includes("Lookup Tenant by Mailbox"), 'leftover reference to 16');
  assert.ok(!JSON.stringify(wf40).includes("'workflow_16'"));
});

test('40: reads the client, only the new part, and the whole recipient list', () => {
  const f = extract40(resendEmail());
  assert.deepStrictEqual([f.skip, f.kind, f.from_email, f.from_name, f.rfc_message_id], [false, 'email', 'anna@x.pl', 'Anna Nowak', '<CAB1@mail.gmail.com>']);
  assert.deepStrictEqual(f.recipients, ['biuro@simon.pl', 'simon@in.getelliot.eu']);
  assert.strictEqual(f.body, 'Dzień dobry,\nczy studio jest dostępne?\n\nAnna');
  assert.strictEqual(f.message, 'Subject: Studio na Płochocińskiej\n\nDzień dobry,\nczy studio jest dostępne?\n\nAnna');
  assert.strictEqual(f.references, '<old@simon.pl>');
  // html only
  const h = extract40(resendEmail({ text: '', html: '<style>p{}</style><p>Hello&nbsp;there</p><div>Line 2</div>', subject: 'Re: Flat' }));
  assert.strictEqual(h.message, 'Hello there\n Line 2');
  // Find Agency gets the list as a Postgres array; one row always.
  const fa = nodeOf(wf40, 'Find Agency').parameters;
  assert.match(fa.query, /left join lateral email_inbound_tenant\(\$1::text\[\]\) m on true/);
  assert.deepStrictEqual(expr(fa.options.queryReplacement, { json: f }), ['{"biuro@simon.pl","simon@in.getelliot.eu"}']);
  assert.strictEqual(expr(cond(wf40, 'Agency Found?'), { json: { tenant_id: null } }), false);
});

test('40: portal enquiries answer the client in Reply-To; automatic and own emails are skipped', () => {
  const portal = extract40(resendEmail({ headers: { from: 'Otodom <no-reply@otodom.pl>' }, from: 'no-reply@otodom.pl', reply_to: ['Jan <jan@klient.pl>'] }));
  assert.deepStrictEqual([portal.skip, portal.from_email, portal.from_name], [false, 'jan@klient.pl', '']);
  const noreply = extract40(resendEmail({ headers: { from: 'no-reply@bank.pl' }, from: 'no-reply@bank.pl' }));
  assert.deepStrictEqual([noreply.skip, noreply.reason], [true, 'automatic_sender']);
  const ours = extract40(resendEmail({ headers: { from: 'Simon <simon@mail.getelliot.eu>' }, from: 'simon@mail.getelliot.eu' }));
  assert.deepStrictEqual([ours.skip, ours.reason], [true, 'sent_by_elliot']);
  const ooo = extract40(resendEmail({ headers: { from: 'anna@x.pl', 'auto-submitted': 'auto-replied' } }));
  assert.deepStrictEqual([ooo.skip, ooo.reason], [true, 'auto_submitted']);
  const news = extract40(resendEmail({ headers: { from: 'news@shop.pl', 'list-unsubscribe': '<mailto:x>' } }));
  assert.deepStrictEqual([news.skip, news.reason], [true, 'mailing_list']);
  const failed = extract40({ statusCode: 404, body: { message: 'not found' } });
  assert.deepStrictEqual([failed.skip, failed.kind, failed.recipients], [true, 'fetch_failed', []]);
  assert.strictEqual(expr(cond(wf40, 'Should Answer?'), { nodes: { 'Extract Email Fields': noreply } }), false);
  assert.strictEqual(expr(cond(wf40, 'Should Answer?'), { nodes: { 'Extract Email Fields': portal } }), true);
});

test('40: Gmail\'s forwarding confirmation is saved for Settings, never answered', () => {
  const g = extract40(resendEmail({
    from: 'forwarding-noreply@google.com', headers: { from: 'Gmail Team <forwarding-noreply@google.com>' },
    subject: '(#612345678) Gmail Forwarding Confirmation - Receive Mail from biuro@simon.pl', to: ['simon@in.getelliot.eu'], received_for: ['simon@in.getelliot.eu'],
    text: 'biuro@simon.pl has requested to automatically forward mail to your email address simon@in.getelliot.eu.\nConfirmation code: 612345678\n\nTo allow biuro@simon.pl to automatically forward mail to your address, please click the link below to confirm the request:\n\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ_abc%5D-xyz\n\nIf you click the link and it appears to be broken...' }));
  assert.deepStrictEqual([g.skip, g.kind, g.code, g.url], [true, 'gmail_forwarding', '612345678', 'https://mail-settings.google.com/mail/vf-%5BANGjdJ_abc%5D-xyz']);
  assert.strictEqual(expr(cond(wf40, 'Gmail Forwarding Code?'), { nodes: { 'Extract Email Fields': g } }), true);
  const save = nodeOf(wf40, 'Save Forwarding Code').parameters;
  assert.match(save.query, /record_email_forwarding_code\(\$1, \$2, \$3\)/);
  assert.deepStrictEqual(expr(save.options.queryReplacement, { json: { tenant_id: T }, nodes: { 'Extract Email Fields': g } }), [T, '612345678', g.url]);
});

test('40: claimed by Message-ID; the reply threads and goes out from the agency', () => {
  const f = extract40(resendEmail());
  const claim = nodeOf(wf40, 'Claim Message').parameters;
  assert.match(claim.query, /email_inbound_claim\(\$1, \$2, \$3\)/);
  assert.deepStrictEqual(expr(claim.options.queryReplacement, { nodes: { 'Find Agency': { tenant_id: T }, 'Extract Email Fields': f } }), [T, '<CAB1@mail.gmail.com>', 'anna@x.pl']);
  assert.deepStrictEqual(expr(claim.options.queryReplacement, { nodes: { 'Find Agency': { tenant_id: T }, 'Extract Email Fields': { ...f, rfc_message_id: '' } } })[1], 'resend:em_1');
  assert.strictEqual(nodeOf(wf40, 'Build Elliot Request').parameters.jsCode.includes("channel: 'email'"), true);
  const reply = run(nodeOf(wf40, 'Build Reply Email').parameters.jsCode, { json: { reply: '**Yes**, it is. [See photos](https://app.getelliot.eu/p/1)', conversation_id: 'conv-1' },
    nodes: { 'Extract Email Fields': f, 'Find Agency': { tenant_id: T } } })[0].json;
  assert.deepStrictEqual(reply, { tenant_id: T, conversation_id: 'conv-1', to: 'anna@x.pl', subject: 'Re: Studio na Płochocińskiej',
    text: 'Yes, it is. See photos: https://app.getelliot.eu/p/1\n', in_reply_to: '<CAB1@mail.gmail.com>', references: '<old@simon.pl> <CAB1@mail.gmail.com>' });
  const send = nodeOf(wf40, 'Send Reply').parameters.workflowInputs.value;
  const e = build39(Object.fromEntries(Object.entries(send).map(([k, v]) => [k, v.startsWith('=') ? expr(v, { json: reply }) : v])));
  assert.deepStrictEqual(e.email, { from: '"Simon Real Estate" <simon@mail.getelliot.eu>', to: ['anna@x.pl'], subject: 'Re: Studio na Płochocińskiej',
    text: reply.text, reply_to: ['biuro@simon.pl'], headers: { 'In-Reply-To': '<CAB1@mail.gmail.com>', References: '<old@simon.pl> <CAB1@mail.gmail.com>' } });
  const check = nodeOf(wf40, 'Check Send Result').parameters.jsCode;
  const bad = run(check, { json: { ok: false, statusCode: 403, error: { message: 'Resend: x' } }, nodes: { 'Build Reply Email': reply } })[0].json;
  assert.deepStrictEqual([bad.ok, bad.error, bad.tenant_id, bad.conversation_id], [false, 'Resend: x', T, 'conv-1']);
  const lsf = nodeOf(wf40, 'Log Send Failure').parameters;
  assert.deepStrictEqual(expr(lsf.options.queryReplacement, { json: bad }).slice(0, 3), [T, 'conv-1', 'Resend: x']);
  assert.strictEqual(expr(cond(wf40, 'Send Failed?'), { json: bad }), true);
});

console.log(`${passed} passed`);
