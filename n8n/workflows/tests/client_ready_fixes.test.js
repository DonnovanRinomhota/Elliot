// Tests for the Code-node logic added in the client-ready fix pack:
// internal-webhook secret gate (19/21/22/30), Meta signature check (25),
// cancel-appointment decisions (30) and the lead-scoring status fix (10).
//
// Unlike chunking_logic.test.js, this does NOT copy the node code: it reads
// each node's jsCode straight out of the workflow JSON and runs it with a
// small stand-in for n8n's runtime ($input, $env, $(), this.helpers). So the
// tests always exercise exactly what n8n will import.
//
// Run: node n8n/workflows/tests/client_ready_fixes.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WF_DIR = path.join(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function nodeCode(file, nodeName) {
  const wf = JSON.parse(fs.readFileSync(path.join(WF_DIR, file), 'utf8'));
  const node = wf.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`${file}: no node named ${nodeName}`);
  return node.parameters.jsCode;
}

// Runs a Code node ("Run Once for All Items" mode) against one input item.
async function run(code, { json = {}, binary, env = {}, nodes = {} } = {}) {
  const item = { json, binary };
  const $input = { first: () => item, all: () => [item] };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`node ${name} not stubbed`);
    return { first: () => ({ json: nodes[name] }) };
  };
  const helpers = {
    getBinaryDataBuffer: async (i, prop) => binary[prop].__raw,
  };
  const fn = new AsyncFunction('$input', '$json', '$env', '$', 'require', code);
  const out = await fn.call({ helpers }, $input, json, env, $, require);
  return out[0].json;
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  // ───────────── Internal webhook secret gate ─────────────
  console.log('Internal webhook secret gate (19, 21, 22, 30)');
  const gate = nodeCode('19-tenant-onboarding.json', 'Check Webhook Secret');
  for (const f of ['21-start-follow-up-run.json', '22-queue-crm-sync.json', '30-cancel-appointment.json']) {
    await test(`${f} uses the identical gate`, () => assert.strictEqual(nodeCode(f, 'Check Webhook Secret'), gate));
  }

  const SECRET = 'a'.repeat(20) + 'Z9';
  const req = (h) => ({ headers: h, body: { name: 'Acme', slug: 'acme' } });

  await test('correct secret is authorized and body passes through', async () => {
    const out = await run(gate, { json: req({ 'x-elliot-webhook-secret': SECRET }), env: { ELLIOT_WEBHOOK_SECRET: SECRET } });
    assert.strictEqual(out._authorized, true);
    assert.deepStrictEqual(out.body, { name: 'Acme', slug: 'acme' });
  });
  await test('wrong secret of the same length is rejected', async () => {
    const wrong = SECRET.slice(0, -1) + 'X';
    const out = await run(gate, { json: req({ 'x-elliot-webhook-secret': wrong }), env: { ELLIOT_WEBHOOK_SECRET: SECRET } });
    assert.strictEqual(out._authorized, false);
  });
  await test('missing header is rejected', async () => {
    const out = await run(gate, { json: req({}), env: { ELLIOT_WEBHOOK_SECRET: SECRET } });
    assert.strictEqual(out._authorized, false);
  });
  await test('unset env var fails closed, even with an empty header', async () => {
    const out = await run(gate, { json: req({ 'x-elliot-webhook-secret': '' }), env: {} });
    assert.strictEqual(out._authorized, false);
  });
  await test('a too-short configured secret fails closed', async () => {
    const out = await run(gate, { json: req({ 'x-elliot-webhook-secret': 'short' }), env: { ELLIOT_WEBHOOK_SECRET: 'short' } });
    assert.strictEqual(out._authorized, false);
  });

  // ───────────── Meta signature check ─────────────
  console.log('WhatsApp Meta signature check (25)');
  const sig = nodeCode('25-whatsapp-inbound-trigger.json', 'Verify Meta Signature');
  const APP_SECRET = 'meta-app-secret-123';
  const rawBody = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ type: 'text' }] } }] }] }));
  const sign = (buf, secret = APP_SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(buf).digest('hex');
  const metaReq = (header, raw = rawBody) => ({
    json: { headers: header === undefined ? {} : { 'x-hub-signature-256': header }, body: JSON.parse(raw.toString()) },
    binary: { data: { __raw: raw } },
  });
  const env = { META_APP_SECRET: APP_SECRET };

  await test('genuine Meta signature is valid and the body passes through', async () => {
    const out = await run(sig, { ...metaReq(sign(rawBody)), env });
    assert.strictEqual(out._signature, 'valid');
    assert.ok(out.body.entry);
  });
  await test('tampered body is invalid', async () => {
    const tampered = Buffer.from(rawBody.toString().replace('text', 'image'));
    const out = await run(sig, { ...metaReq(sign(rawBody), tampered), env });
    assert.strictEqual(out._signature, 'invalid');
  });
  await test('signature made with another secret is invalid', async () => {
    const out = await run(sig, { ...metaReq(sign(rawBody, 'attacker-guess')), env });
    assert.strictEqual(out._signature, 'invalid');
  });
  await test('malformed signature is invalid, not a crash', async () => {
    const out = await run(sig, { ...metaReq('sha256=zz'), env });
    assert.strictEqual(out._signature, 'invalid');
  });
  await test('missing header is rejected', async () => {
    const out = await run(sig, { ...metaReq(undefined), env });
    assert.strictEqual(out._signature, 'missing');
  });
  await test('no META_APP_SECRET configured fails closed', async () => {
    const out = await run(sig, { ...metaReq(sign(rawBody)), env: {} });
    assert.strictEqual(out._signature, 'no_secret_configured');
  });
  await test('WHATSAPP_SIGNATURE_CHECK=off skips the check (local testing only)', async () => {
    const out = await run(sig, { ...metaReq(undefined), env: { WHATSAPP_SIGNATURE_CHECK: 'off' } });
    assert.strictEqual(out._signature, 'skipped');
  });
  await test('Signature Valid? only lets valid/skipped through', () => {
    const wf = JSON.parse(fs.readFileSync(path.join(WF_DIR, '25-whatsapp-inbound-trigger.json'), 'utf8'));
    const cond = wf.nodes.find((n) => n.name === 'Signature Valid?').parameters.conditions.conditions[0].leftValue;
    assert.strictEqual(cond, "={{ ['valid', 'skipped'].includes($json._signature) }}");
    const post = wf.nodes.find((n) => n.name === 'WhatsApp Webhook (POST)');
    assert.strictEqual(post.parameters.options.rawBody, true, 'POST webhook must keep the raw body');
  });

  // ───────────── Cancel appointment (30) ─────────────
  console.log('Cancel appointment decisions (30)');
  const check = nodeCode('30-cancel-appointment.json', 'Check Appointment');
  const ids = { 'Validate Input': { appointment_id: 'appt-1', tenant_id: 'tenant-1' } };

  await test('unknown appointment -> 404', async () => {
    const out = await run(check, { json: { appointment_id: null }, nodes: ids });
    assert.deepStrictEqual([out.ok, out.code], [false, 404]);
  });
  for (const status of ['cancelled', 'completed', 'no_show']) {
    await test(`already ${status} -> 409`, async () => {
      const out = await run(check, { json: { appointment_id: 'appt-1', status }, nodes: ids });
      assert.deepStrictEqual([out.ok, out.code], [false, 409]);
    });
  }
  await test('confirmed with a calendar event -> delete the event', async () => {
    const out = await run(check, {
      json: { appointment_id: 'appt-1', status: 'confirmed', external_calendar_id: 'evt', google_calendar_id: 'primary' },
      nodes: ids,
    });
    assert.deepStrictEqual([out.ok, out.has_event, out.tenant_id], [true, true, 'tenant-1']);
  });
  await test('confirmed without a calendar event -> just cancel', async () => {
    const out = await run(check, { json: { appointment_id: 'appt-1', status: 'confirmed' }, nodes: ids });
    assert.deepStrictEqual([out.ok, out.has_event], [true, false]);
  });

  const calResult = nodeCode('30-cancel-appointment.json', 'Calendar Result');
  const checked = { 'Check Appointment': { ok: true, appointment_id: 'appt-1', tenant_id: 'tenant-1' } };
  await test('Google 204 (empty output) -> deleted', async () => {
    const out = await run(calResult, { json: {}, nodes: checked });
    assert.strictEqual(out.calendar, 'deleted');
    assert.strictEqual(out.appointment_id, 'appt-1');
  });
  await test('Google 410 Gone -> already_gone', async () => {
    const out = await run(calResult, { json: { error: { message: '410 - "Resource has been deleted"' } }, nodes: checked });
    assert.strictEqual(out.calendar, 'already_gone');
  });
  await test('Google 401 -> failed (dashboard tells the user to remove it by hand)', async () => {
    const out = await run(calResult, { json: { error: { message: '401 - "Invalid Credentials"' } }, nodes: checked });
    assert.strictEqual(out.calendar, 'failed');
  });

  // ───────────── Lead scoring (10) ─────────────
  console.log('Lead scoring statuses (10)');
  const score = nodeCode('10-lead-capture.json', 'Score Lead');
  const ALLOWED = ['NEW', 'QUALIFYING', 'HOT', 'WARM', 'COLD', 'CONVERTED', 'LOST']; // leads_status_check
  const scoreFor = async (answers, contact) =>
    run(score, {
      json: { id: 'contact-1' },
      nodes: { 'When Executed by Another Workflow': { tenant_id: 't', qualification_answers: answers, contact } },
    });

  await test('40-69 band saves as WARM (was QUALIFIED, which the DB rejects)', async () => {
    const low = await scoreFor({ budget: '1M', timeline: 'next year' }, { email: 'a@b.c' }); // 25 + 10 = 35
    const mid = await scoreFor({ budget: '1M', intent_signal: 'viewing' }, {}); // 25 + 20 = 45
    assert.strictEqual(low.status, 'QUALIFYING');
    assert.strictEqual(mid.status, 'WARM');
    assert.strictEqual(mid.score, 45);
  });
  await test('70+ is HOT', async () => {
    const out = await scoreFor({ budget: '1M', timeline: 'asap', intent_signal: 'viewing' }, { email: 'a@b.c' });
    assert.strictEqual(out.status, 'HOT');
  });
  await test('every reachable status is allowed by leads_status_check', async () => {
    for (const answers of [{}, { budget: 'x', intent_signal: 'y' }, { budget: 'x', timeline: 'now', intent_signal: 'y' }]) {
      const out = await scoreFor(answers, {});
      assert.ok(ALLOWED.includes(out.status), out.status);
    }
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
