// Several emails arriving in the same Gmail check (workflow 16). n8n's Gmail
// Trigger hands them over together; before, every step read .first(), so
// all of them were treated as the first email and only it was answered.
// Now each email goes through the steps on its own ("One Email at a Time"),
// and every path ends at "Next Email" exactly once, which brings the next.
//
// Run: node n8n/workflows/tests/email_batch.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '16-email-inbound-trigger.json'), 'utf8'));
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
const outs = (name) => (wf.connections[name]?.main || []).map((b) => (b || []).map((x) => x.node));

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

test('the loop: Gmail → one email at a time → the steps → Next Email → the loop', () => {
  const loop = byName['One Email at a Time'];
  assert.strictEqual(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.strictEqual(loop.typeVersion, 3);
  assert.strictEqual(loop.parameters.batchSize, 1);
  assert.deepStrictEqual(outs('Gmail Trigger'), [['One Email at a Time']]);
  assert.deepStrictEqual(outs('One Email at a Time'), [[], ['Extract Email Fields']]); // 0 = done, 1 = next email
  assert.deepStrictEqual(outs('Next Email'), [['One Email at a Time']]);
});

// Walks every path from the first step. An If node takes one branch; any
// other node passes on to everything it is connected to. For each email, the
// number of times Next Email is reached must be exactly 1 whatever happens:
// 0 would stop the loop (later emails never answered), 2 would skip one.
function arrivals(name, seen = []) {
  assert.ok(!seen.includes(name), `cycle through ${name}`);
  if (name === 'Next Email') return new Set([1]);
  const node = byName[name];
  assert.ok(node, `no node ${name}`);
  const branches = outs(name);
  if (node.type === 'n8n-nodes-base.if') {
    const all = new Set();
    for (const targets of [branches[0] || [], branches[1] || []]) {
      for (const n of combine(targets, [...seen, name])) all.add(n);
    }
    return all;
  }
  return combine(branches.flat(), [...seen, name]);
}
function combine(targets, seen) {
  if (!targets.length) return new Set([0]); // a dead end
  let sums = new Set([0]);
  for (const t of targets) {
    const next = new Set();
    for (const a of sums) for (const b of arrivals(t, seen)) next.add(a + b);
    sums = next;
  }
  return sums;
}

test('every path of an email ends at Next Email exactly once', () => {
  assert.deepStrictEqual([...arrivals('Extract Email Fields')], [1]);
});

test('steps that may insert nothing still pass on, so the loop continues', () => {
  for (const n of ['Log Unmatched Mailbox', 'Log Elliot Failure', 'Log Send Failure']) {
    assert.strictEqual(byName[n].alwaysOutputData, true, n);
  }
});

test('nothing reads the Gmail Trigger directly (that would always be the first email)', () => {
  const src = JSON.stringify(wf.nodes.map((n) => n.parameters));
  assert.ok(!/\$\(\s*\\?'Gmail Trigger\\?'\s*\)/.test(src));
  // The loop's current email is its output 1.
  assert.match(byName['Attachment Files'].parameters.jsCode, /\$\('One Email at a Time'\)\.first\(1\)\.binary/);
  assert.ok(!/\$\('One Email at a Time'\)\.first\(\)/.test(src));
});

// In a loop n8n's $('Node').first() returns that node's latest run, i.e. the
// email being handled now (n8n-workflow's WorkflowDataProxy: runIndex
// defaults to -1, the last run). Simulated: two emails, two runs.
test('two emails in one check: each is claimed and answered under its own id', () => {
  const extract = byName['Extract Email Fields'].parameters.jsCode;
  const claim = byName['Claim Message'].parameters.options.queryReplacement;
  const runs = { 'Extract Email Fields': [], 'Lookup Tenant by Mailbox': [] };
  const $ = (name) => ({ first: () => runs[name][runs[name].length - 1] });
  const keys = [];
  for (const [id, mid, from] of [['g1', '<a@mail>', 'anna@x.pl'], ['g2', '<b@mail>', 'piotr@y.pl']]) {
    const email = { id, threadId: id, messageId: mid, from: { value: [{ address: from }] }, to: { value: [{ address: 'office@agency.pl' }] }, subject: 'Flat', text: 'Is it available?', headers: {} };
    const item = { json: email };
    const out = new Function('$input', '$json', extract)({ first: () => item, all: () => [item] }, email)[0];
    runs['Extract Email Fields'].push(out);
    runs['Lookup Tenant by Mailbox'].push({ json: { tenant_id: 't1' } });
    keys.push(new Function('$', `return (${claim.replace(/^=\{\{/, '').replace(/\}\}$/, '')});`)($));
  }
  assert.deepStrictEqual(keys.map((k) => k[1]), ['<a@mail>', '<b@mail>']);
  assert.deepStrictEqual(keys.map((k) => k[2]), ['g1', 'g2']);
});

console.log(`\n${passed} passed`);
