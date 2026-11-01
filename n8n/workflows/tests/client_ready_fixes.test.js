// Tests for the client-ready fix pack: Header Auth on the internal webhooks
// (08/17/19/21/22/28/30), WhatsApp verify token + Meta signature check (25),
// cancel-appointment decisions (30) and the lead-scoring status fix (10).
//
// Unlike chunking_logic.test.js, this does NOT copy the node code: it reads
// each node's jsCode straight out of the workflow JSON and runs it with a
// small stand-in for n8n's runtime ($input, $json, $env, $vars, $(),
// this.helpers). So the
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
//
// env/vars model where secrets come from. Pass env: BLOCKED_ENV to mimic n8n
// Cloud, where touching $env throws.
const BLOCKED_ENV = new Proxy({}, { get() { throw new Error('access to env vars denied'); } });

async function run(code, { json = {}, binary, env = {}, vars = {}, nodes = {} } = {}) {
  const item = { json, binary };
  const $input = { first: () => item, all: () => [item] };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`node ${name} not stubbed`);
    return { first: () => ({ json: nodes[name] }) };
  };
  const helpers = {
    getBinaryDataBuffer: async (i, prop) => binary[prop].__raw,
  };
  const fn = new AsyncFunction('$input', '$json', '$env', '$vars', '$', 'require', code);
  const out = await fn.call({ helpers }, $input, json, env, vars, $, require);
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
  // ───────────── Internal webhooks: Header Auth ─────────────
  console.log('Internal webhooks use Header Auth (08, 17, 19, 21, 22, 28, 30)');
  const HOOKS = {
    '08-knowledge-ingestion.json': 'Ingest Webhook',
    '17-manual-send-draft.json': 'Send Draft Webhook',
    '28-manual-send-whatsapp-draft.json': 'Send WhatsApp Draft Webhook',
    '19-tenant-onboarding.json': 'Onboarding Webhook',
    '21-start-follow-up-run.json': 'Start Follow-Up Webhook',
    '22-queue-crm-sync.json': 'Queue Sync Webhook',
    '30-cancel-appointment.json': 'Cancel Appointment Webhook',
  };
  for (const [file, hookName] of Object.entries(HOOKS)) {
    await test(`${file}: webhook requires the shared Header Auth credential`, () => {
      const wf = JSON.parse(fs.readFileSync(path.join(WF_DIR, file), 'utf8'));
      const hook = wf.nodes.find((n) => n.name === hookName);
      assert.strictEqual(hook.parameters.authentication, 'headerAuth');
      assert.strictEqual(hook.credentials.httpHeaderAuth.name, 'Elliot Internal Webhook Secret');
      // No leftover $env gate (blocked on n8n Cloud) and nothing skips the webhook node.
      assert.ok(!JSON.stringify(wf).includes('$env'), 'no $env use');
      assert.ok(!wf.nodes.some((n) => n.name === 'Check Webhook Secret'), 'old Code gate removed');
    });
  }

  // ───────────── WhatsApp verify token ─────────────
  console.log('WhatsApp verify token (25)');
  const verifyCode = nodeCode('25-whatsapp-inbound-trigger.json', 'Check Verify Token');
  const TOKEN = 'my-verify-token';
  const pastedVerify = verifyCode.replace('PASTE_WHATSAPP_VERIFY_TOKEN_HERE', TOKEN);
  const handshake = (token) => ({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': 'ch-1' } });

  await test('pasted token answers the handshake on n8n Cloud ($env blocked)', async () => {
    const out = await run(pastedVerify, { json: handshake(TOKEN), env: BLOCKED_ENV });
    assert.deepStrictEqual(out, { ok: true, challenge: 'ch-1' });
  });
  await test('wrong token is refused', async () => {
    const out = await run(pastedVerify, { json: handshake('nope'), env: BLOCKED_ENV });
    assert.strictEqual(out.ok, false);
  });
  await test('placeholder left in place refuses every handshake', async () => {
    const out = await run(verifyCode, { json: handshake('PASTE_WHATSAPP_VERIFY_TOKEN_HERE'), env: BLOCKED_ENV });
    assert.strictEqual(out.ok, false);
  });
  await test('a WHATSAPP_VERIFY_TOKEN variable still works (Pro / self-hosted)', async () => {
    const viaVars = await run(verifyCode, { json: handshake(TOKEN), env: BLOCKED_ENV, vars: { WHATSAPP_VERIFY_TOKEN: TOKEN } });
    const viaEnv = await run(verifyCode, { json: handshake(TOKEN), env: { WHATSAPP_VERIFY_TOKEN: TOKEN } });
    assert.strictEqual(viaVars.ok, true);
    assert.strictEqual(viaEnv.ok, true);
  });

  // ───────────── Meta signature check ─────────────
  console.log('WhatsApp Meta signature check (25)');
  const sigRaw = nodeCode('25-whatsapp-inbound-trigger.json', 'Verify Meta Signature');
  const APP_SECRET = 'meta-app-secret-123';
  // As set up on n8n Cloud Starter: secret pasted into the node, $env blocked.
  const sig = sigRaw.replace('PASTE_META_APP_SECRET_HERE', APP_SECRET);
  const rawBody = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ type: 'text' }] } }] }] }));
  const sign = (buf, secret = APP_SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(buf).digest('hex');
  const metaReq = (header, raw = rawBody) => ({
    json: { headers: header === undefined ? {} : { 'x-hub-signature-256': header }, body: JSON.parse(raw.toString()) },
    binary: { data: { __raw: raw } },
  });
  const env = BLOCKED_ENV;

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
  await test('placeholder left in place fails closed', async () => {
    const out = await run(sigRaw, { ...metaReq(sign(rawBody)), env: BLOCKED_ENV });
    assert.strictEqual(out._signature, 'no_secret_configured');
  });
  await test('a META_APP_SECRET variable works without pasting (Pro / self-hosted)', async () => {
    const viaVars = await run(sigRaw, { ...metaReq(sign(rawBody)), env: BLOCKED_ENV, vars: { META_APP_SECRET: APP_SECRET } });
    const viaEnv = await run(sigRaw, { ...metaReq(sign(rawBody)), env: { META_APP_SECRET: APP_SECRET } });
    assert.strictEqual(viaVars._signature, 'valid');
    assert.strictEqual(viaEnv._signature, 'valid');
  });
  await test('WHATSAPP_SIGNATURE_CHECK=off skips the check (local testing only)', async () => {
    const out = await run(sig, { ...metaReq(undefined), env: { WHATSAPP_SIGNATURE_CHECK: 'off' } });
    assert.strictEqual(out._signature, 'skipped');
  });
  await test('the repo never contains a real secret (placeholders only)', () => {
    assert.ok(sigRaw.includes("const META_APP_SECRET = 'PASTE_META_APP_SECRET_HERE';"));
    assert.ok(verifyCode.includes("const WHATSAPP_VERIFY_TOKEN = 'PASTE_WHATSAPP_VERIFY_TOKEN_HERE';"));
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
