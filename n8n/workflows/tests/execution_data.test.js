// What n8n keeps of each run. A run's saved data holds everything that passed
// through it: clients' messages, emails, names and phone numbers. Workflows
// that handle clients keep only failed runs (to find what went wrong) and
// runs started by hand from the editor (testing). Successful runs are not
// stored; the conversation itself is in the database and the dashboard.
// See docs/data-protection.md.
//
// Run: node n8n/workflows/tests/execution_data.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const files = fs.readdirSync(dir).filter((f) => /^\d\d-.*\.json$/.test(f)).sort();
// No client conversations in these: knowledge upload, onboarding, health,
// error recorder, demo clean-up, calendar check, ASARI listings, retention.
const NO_CLIENT_DATA = new Set(['08', '19', '33', '34', '36', '41', '42', '43']);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

test('workflows that handle clients keep only failed and manual runs', () => {
  const checked = [];
  for (const f of files) {
    const num = f.slice(0, 2);
    if (NO_CLIENT_DATA.has(num)) continue;
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).settings || {};
    assert.strictEqual(s.saveDataSuccessExecution, 'none', `${f}: successful runs`);
    assert.strictEqual(s.saveDataErrorExecution, 'all', `${f}: failed runs`);
    assert.strictEqual(s.saveManualExecutions, true, `${f}: manual runs`);
    assert.strictEqual(s.errorWorkflow, f.startsWith('34') ? undefined : 'seDI8X3d4J3gLEgw', `${f}: error workflow`);
    checked.push(num);
  }
  assert.ok(checked.length >= 29, `only ${checked.length} checked`);
  for (const n of ['01', '16', '25', '40', '12', '39', '24']) assert.ok(checked.includes(n), n);
});

test('a new workflow must be put in one group or the other', () => {
  const known = new Set([...NO_CLIENT_DATA]);
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).settings || {};
    if (s.saveDataSuccessExecution === 'none') known.add(f.slice(0, 2));
  }
  for (const f of files) assert.ok(known.has(f.slice(0, 2)), `${f}: decide whether it handles client data`);
});

console.log(`\n${passed} passed`);
