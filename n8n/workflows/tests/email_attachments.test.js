// Tests for 0046: files attached to emails. Workflows 16 (Gmail) and 40
// (forwarded, via Resend) keep each file in Storage, record it, and hand
// Elliot links to the PDFs and photos; 01 turns those into documents and
// images Claude opens, and only accepts links to the private bucket.
//
// Run: node n8n/workflows/tests/email_attachments.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
const w16 = load('16-email-inbound-trigger.json');
const w40 = load('40-email-inbound-forwarded.json');
const w01 = load('01-main-ai-agent.json');
const nodeOf = (wf, name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node named ${name}`);
  return n;
};
const next = (wf, name, branch = 0) => (wf.connections[name]?.main?.[branch] || []).map((x) => x.node);
function stubs(nodes) {
  return (name) => {
    if (!(name in nodes)) throw new Error(`node ${name} hasn't run`);
    const list = Array.isArray(nodes[name]) ? nodes[name] : [nodes[name]];
    const wrap = (j) => (j && j.__binary ? { json: j.json, binary: j.__binary } : { json: j });
    return { first: () => wrap(list[0]), item: wrap(list[0]), all: () => list.map(wrap) };
  };
}
function run(code, items, nodes = {}) {
  const wrapped = items.map((x) => (x && x.__binary ? { json: x.json, binary: x.__binary } : { json: x }));
  return new Function('$input', '$json', '$', code)({ first: () => wrapped[0], all: () => wrapped }, wrapped[0] && wrapped[0].json, stubs(nodes));
}
const expr = (value, json = {}, nodes = {}) =>
  new Function('$json', '$', `return (${value.replace(/^=\{\{/, '').replace(/\}\}$/, '')});`)(json, stubs(nodes));

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const BASE = 'https://abc.supabase.co';
const common = {
  'Storage Address': { supabase_url: BASE + '/' },
  'Extract Email Fields': { rfc_message_id: '<m1@mail>', resend_id: 'rs1' },
  'Get or Create Conversation (Email)': { id: 'conv1' },
};

test('wiring: conversation → attachments → Elliot, in both email workflows', () => {
  for (const [wf, list] of [[w16, ['Storage Address', 'Attachment Files']], [w40, ['Storage Address', 'List Attachments', 'Attachment Files']]]) {
    assert.deepStrictEqual(next(wf, 'Get or Create Conversation (Email)'), ['Storage Address']);
    assert.deepStrictEqual(next(wf, list[list.length - 1]), ['Has Attachments?']);
    assert.deepStrictEqual(next(wf, 'Has Attachments?', 1), ['Collect Attachments']);
    assert.deepStrictEqual(next(wf, 'Upload Attachment'), ['Record Attachment']);
    assert.deepStrictEqual(next(wf, 'Record Attachment'), ['Sign Attachment']);
    assert.deepStrictEqual(next(wf, 'Sign Attachment'), ['Collect Attachments']);
    assert.deepStrictEqual(next(wf, 'Collect Attachments'), ['Build Elliot Request']);
    const up = nodeOf(wf, 'Upload Attachment');
    assert.strictEqual(up.parameters.contentType, 'binaryData');
    assert.strictEqual(up.parameters.inputDataFieldName, 'file');
    assert.strictEqual(up.credentials.httpCustomAuth.name, 'Supabase Storage (service role)');
    assert.strictEqual(up.onError, 'continueRegularOutput', 'a failed upload never stops the reply');
    assert.strictEqual(nodeOf(wf, 'Storage Address').alwaysOutputData, true);
  }
  assert.deepStrictEqual(next(w16, 'Has Attachments?', 0), ['Upload Attachment']);
  assert.deepStrictEqual(next(w40, 'Has Attachments?', 0), ['Download Attachment']);
  assert.deepStrictEqual(next(w40, 'Download Attachment'), ['Upload Attachment']);
  assert.strictEqual(nodeOf(w16, 'Gmail Trigger').parameters.options.downloadAttachments, true);
  assert.match(nodeOf(w40, 'List Attachments').parameters.url, /emails\/receiving\/.*resend_id.*\/attachments/);
});

const gmailFiles = (binary, extra = {}) => run(nodeOf(w16, 'Attachment Files').parameters.jsCode, [{}], {
  ...common, 'Lookup Tenant by Mailbox': { tenant_id: 't1' }, 'One Email at a Time': { __binary: binary, json: {} }, ...extra,
});

test('Gmail: files kept, signature logos dropped, what Elliot reads', () => {
  const out = gmailFiles({
    attachment_0: { fileName: 'Rzut mieszkania ąę.pdf', mimeType: 'application/pdf', fileSize: '1.2 MB' },
    attachment_1: { fileName: 'logo.png', mimeType: 'image/png', fileSize: '8 kB' },
    attachment_2: { fileName: 'salon.jpg', mimeType: 'image/jpeg', fileSize: '2.4 MB' },
    attachment_3: { fileName: 'umowa.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSize: '40 kB' },
    attachment_4: { fileName: 'IMG_1.HEIC', mimeType: 'image/heic', fileSize: '3 MB' },
    attachment_5: { fileName: 'huge.pdf', mimeType: 'application/pdf', fileSize: '14 MB' },
  });
  assert.deepStrictEqual(out.map((o) => [o.json.filename, o.json.readable]),
    [['Rzut mieszkania ąę.pdf', true], ['salon.jpg', true], ['umowa.docx', false], ['IMG_1.HEIC', false], ['huge.pdf', false]]);
  const pdf = out[0].json;
  assert.strictEqual(pdf.size, Math.round(1.2 * 1048576));
  assert.match(pdf.path, /^t1\/conv1\/\d+-1-Rzut_mieszkania_ae\.pdf$/);
  assert.strictEqual(pdf.upload_url, `${BASE}/storage/v1/object/email-attachments/${pdf.path}`);
  assert.strictEqual(pdf.sign_url, `${BASE}/storage/v1/object/sign/email-attachments/${pdf.path}`);
  assert.strictEqual(pdf.email_message_id, '<m1@mail>');
  assert.strictEqual(out[0].binary.file.fileName, 'Rzut mieszkania ąę.pdf', 'the file itself goes on to Upload');
  // No attachments; Storage address not set (files named, not saved).
  assert.deepStrictEqual(gmailFiles({}).map((o) => o.json), [{ none: true }]);
  const unset = gmailFiles({ attachment_0: { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: '1 MB' } }, { 'Storage Address': { supabase_url: null } });
  assert.deepStrictEqual(unset[0].json.not_saved, ['a.pdf']);
  // Elliot reads at most 5 per email; at most 10 kept.
  const many = {};
  for (let i = 0; i < 12; i += 1) many[`attachment_${i}`] = { fileName: `p${i}.jpg`, mimeType: 'image/jpeg', fileSize: '500 kB' };
  const m = gmailFiles(many);
  assert.deepStrictEqual([m.length, m.filter((o) => o.json.readable).length], [10, 5]);
});

test('Resend: list → files (inline logos dropped)', () => {
  const out = run(nodeOf(w40, 'Attachment Files').parameters.jsCode, [{ statusCode: 200, body: { data: [
    { filename: 'oferta.pdf', content_type: 'application/pdf', size: 300000, content_disposition: 'attachment', download_url: 'https://inbound-cdn.resend.com/a?sig=1' },
    { filename: 'sig.png', content_type: 'image/png', size: 40000, content_disposition: 'inline', content_id: 'img001', download_url: 'https://inbound-cdn.resend.com/b' },
    { filename: 'kitchen.webp', content_type: 'image/webp', size: 900000, content_disposition: 'attachment', download_url: 'https://inbound-cdn.resend.com/c' },
  ] } }], { ...common, 'Find Agency': { tenant_id: 't2' } }).map((o) => o.json);
  assert.deepStrictEqual(out.map((f) => [f.filename, f.readable, f.download_url.slice(-5)]), [['oferta.pdf', true, 'sig=1'], ['kitchen.webp', true, 'com/c']]);
  assert.match(out[0].path, /^t2\/conv1\//);
  const none = run(nodeOf(w40, 'Attachment Files').parameters.jsCode, [{ statusCode: 404, body: '{"message":"not found"}' }], { ...common, 'Find Agency': { tenant_id: 't2' } });
  assert.deepStrictEqual(none.map((o) => o.json), [{ none: true }]);
});

test('record and collect: saved files, links only for what Elliot reads', () => {
  const metas = [
    { filename: 'a.pdf', content_type: 'application/pdf', size: 10, readable: true, path: 't/c/1-a.pdf', tenant_id: 't', conversation_id: 'c', email_message_id: '<m>' },
    { filename: 'b.docx', content_type: 'application/msword', size: 20, readable: false, path: 't/c/2-b.docx', tenant_id: 't', conversation_id: 'c', email_message_id: '<m>' },
    { filename: 'c.jpg', content_type: 'image/jpeg', size: 30, readable: true, path: 't/c/3-c.jpg', tenant_id: 't', conversation_id: 'c', email_message_id: '' },
  ];
  const rec = nodeOf(w16, 'Record Attachment').parameters;
  assert.match(rec.query, /insert into message_attachments/);
  assert.deepStrictEqual(expr(rec.options.queryReplacement, { statusCode: 200 }, { 'Attachment Files': metas[0] }), ['t', 'c', '<m>', 'a.pdf', 'application/pdf', 10, 't/c/1-a.pdf', true, true]);
  assert.deepStrictEqual(expr(rec.options.queryReplacement, { statusCode: 200 }, { 'Attachment Files': metas[1] }).slice(7), [true, false]);
  assert.deepStrictEqual(expr(rec.options.queryReplacement, { error: { message: 'boom' } }, { 'Attachment Files': metas[2] }).slice(7), [false, false]);
  const collect = nodeOf(w16, 'Collect Attachments').parameters.jsCode;
  const out = run(collect, [
    { statusCode: 200, body: { signedURL: '/object/sign/email-attachments/t/c/1-a.pdf?token=x' } },
    { statusCode: 200, body: { signedURL: '/object/sign/email-attachments/t/c/2-b.docx?token=y' } },
    { statusCode: 400, body: { error: 'not found' } },
  ], { 'Attachment Files': metas, 'Upload Attachment': [{ statusCode: 200 }, { statusCode: 200 }, { error: {} }], 'Storage Address': { supabase_url: BASE } })[0].json;
  assert.deepStrictEqual(out.files.map((f) => [f.filename, f.saved, f.url]), [
    ['a.pdf', true, `${BASE}/storage/v1/object/sign/email-attachments/t/c/1-a.pdf?token=x`],
    ['b.docx', true, null],
    ['c.jpg', false, null],
  ]);
  // No attachments / Storage not set up.
  assert.deepStrictEqual(run(collect, [{ none: true }], { 'Attachment Files': [{ none: true }], 'Storage Address': {} })[0].json, { files: [] });
  assert.deepStrictEqual(run(collect, [{ none: true }], { 'Attachment Files': [{ none: true, not_saved: ['x.pdf'] }], 'Storage Address': {} })[0].json.files,
    [{ filename: 'x.pdf', saved: false, url: null }]);
});

test('16 / 40: attachments go to Elliot; an email with only files is answered', () => {
  for (const [wf, lookup] of [[w16, 'Lookup Tenant by Mailbox'], [w40, 'Find Agency']]) {
    const files = [{ filename: 'a.pdf', saved: true, url: 'u' }];
    const out = run(nodeOf(wf, 'Build Elliot Request').parameters.jsCode.replace("'PASTE_ELLIOT_CHAT_WEBHOOK_URL_HERE'", "'https://n8n.example/webhook/chat'"), [{ id: 'ignored' }], {
      'Extract Email Fields': { message: 'Hi', from_email: 'a@b.pl', from_name: 'A' }, [lookup]: { tenant_slug: 's' }, 'Upsert Contact': {},
      'Get or Create Conversation (Email)': { id: 'conv1' }, 'Collect Attachments': { files },
    })[0].json;
    assert.deepStrictEqual([out.request.conversation_id, out.request.attachments], ['conv1', files]);
  }
  const ex16 = nodeOf(w16, 'Extract Email Fields').parameters.jsCode;
  const gm = run(ex16, [{ __binary: { attachment_0: { fileName: 'a.pdf' } }, json: { from: { value: [{ address: 'anna@x.pl', name: 'Anna' }] }, to: { value: [{ address: 'biuro@a.pl' }] }, subject: '', text: '', id: 'g1', messageId: 'm1@x' } }])[0].json;
  assert.deepStrictEqual([gm.skip, gm.message], [false, '(No text: the client sent attachments only.)']);
  const gm0 = run(ex16, [{ from: { value: [{ address: 'anna@x.pl' }] }, to: { value: [{ address: 'biuro@a.pl' }] }, subject: '', text: '', id: 'g1' }])[0].json;
  assert.strictEqual(gm0.reason, 'empty');
  const ex40 = nodeOf(w40, 'Extract Email Fields').parameters.jsCode;
  const rs = run(ex40, [{ statusCode: 200, body: { id: 'rs1', from: 'Anna <anna@x.pl>', to: ['biuro@in.getelliot.eu'], subject: '', text: '', headers: {}, attachments: [{ filename: 'a.pdf' }] } }])[0].json;
  assert.deepStrictEqual([rs.skip, rs.message], [false, '(No text: the client sent attachments only.)']);
});

// Elliot's own workflows arrive through /chat-internal ("internal"); the public
// /chat webhook does not, and may not claim a channel or attachments (0047).
const validate = (body, internal = true) => run(nodeOf(w01, 'Validate Input').parameters.jsCode, [{ body, ...(internal ? { internal: true } : {}) }])[0].json;
const SIGNED = `${BASE}/storage/v1/object/sign/email-attachments/t/c/1-a.pdf?token=x`;

test('01: only links to the private bucket, only on email', () => {
  const v = validate({ tenant_slug: 's', message: 'See attached', channel: 'email', attachments: [
    { filename: 'a.pdf', content_type: 'application/pdf', url: SIGNED },
    { filename: 'b.jpg', content_type: 'image/jpeg', url: 'https://evil.example/b.jpg' },
    { filename: 'c.docx', content_type: 'application/msword', url: null },
    { filename: 'd.png', content_type: 'image/png', url: SIGNED.replace('1-a.pdf', '4-d.png') },
  ] });
  assert.strictEqual(v.channel, 'email');
  assert.deepStrictEqual(v.attachments.map((a) => a.filename), ['a.pdf', 'd.png']);
  assert.deepStrictEqual(v.attachment_others, ['b.jpg', 'c.docx']);
  assert.strictEqual(v.message, 'See attached\n\n[Attached: a.pdf, b.jpg, c.docx, d.png]', 'the saved message names every file');
  const web = validate({ tenant_slug: 's', message: 'Hi', attachments: [{ filename: 'a.pdf', content_type: 'application/pdf', url: SIGNED }] });
  assert.deepStrictEqual([web.channel, web.attachments, web.message], ['chat_widget', [], 'Hi'], 'website chat ignores attachments');
  assert.deepStrictEqual(validate({ tenant_slug: 's', message: 'Hi', channel: 'whatsapp' }).channel, 'whatsapp');
  const spoof = validate({ tenant_slug: 's', message: 'Hi', channel: 'email', attachments: [{ filename: 'a.pdf', content_type: 'application/pdf', url: SIGNED }] }, false);
  assert.deepStrictEqual([spoof.channel, spoof.attachments, spoof.verified], ['chat_widget', [], false], 'a public caller cannot pose as email');
});

test('01: Claude gets the PDFs and photos, plus what to do with the rest', () => {
  const code = nodeOf(w01, 'Build Claude Request').parameters.jsCode;
  const fn = code.slice(code.indexOf('function clientTurn'), code.indexOf("// A team member's chat replies are the agency speaking"));
  const clientTurn = new Function(`${fn}; return clientTurn;`)();
  assert.strictEqual(clientTurn({ message: 'Hi' }), 'Hi');
  const blocks = clientTurn({ message: 'Hi\n\n[Attached: a.pdf, b.jpg, c.docx]', attachments: [
    { filename: 'a.pdf', content_type: 'application/pdf', url: 'U1' }, { filename: 'b.jpg', content_type: 'image/jpeg', url: 'U2' }], attachment_others: ['c.docx'] });
  assert.deepStrictEqual(blocks.slice(0, 3), [
    { type: 'document', source: { type: 'url', url: 'U1' }, title: 'a.pdf' },
    { type: 'text', text: 'Attached photo: b.jpg' },
    { type: 'image', source: { type: 'url', url: 'U2' } },
  ]);
  const last = blocks[3].text;
  assert.match(last, /a\.pdf, b\.jpg/);
  assert.match(last, /can't open c\.docx: say the team will look at it/);
  assert.match(last, /PESEL/);
  assert.ok(last.endsWith('Hi\n\n[Attached: a.pdf, b.jpg, c.docx]'));
  assert.match(code, /content: clientTurn\(ctx\)/);
  // Prompt caching still marks the last block of the last message (Call Claude).
  const body = nodeOf(w01, 'Call Claude').parameters.jsonBody;
  assert.match(body, /typeof m\.content === 'string' \? \[ \{ type: 'text', text: m\.content \} \] : \(m\.content \|\| \[\]\)/);
});

console.log(`${passed} passed`);
