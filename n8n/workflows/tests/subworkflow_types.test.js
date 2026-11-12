// Newer n8n checks the type of every value a workflow passes to a
// sub-workflow against the sub-workflow's declared inputs, and fails the run
// on a mismatch ("'duration_minutes' expects a string but we got '30'"). This
// test evaluates every "Execute Workflow" input expression with realistic
// values and checks the result has the type the sub-workflow declares.
//
// Run: node n8n/workflows/tests/subworkflow_types.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WF_DIR = path.join(__dirname, '..');
const workflows = fs.readdirSync(WF_DIR).filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, wf: JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8')) }))
  .filter((x) => Array.isArray(x.wf.nodes));
const byId = Object.fromEntries(workflows.map((x) => [x.wf.id, x]));

let DateTime = null;
try { ({ DateTime } = require('luxon')); } catch (e) { /* $now is stubbed below */ }

/** The input types a sub-workflow declares (null: accepts anything). */
function declared(wf) {
  const t = wf.nodes.find((n) => n.type.endsWith('executeWorkflowTrigger'));
  if (!t) return null;
  const p = t.parameters || {};
  const kind = (v) => (typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : Array.isArray(v) ? 'array' : 'object');
  if (p.inputSource === 'jsonExample') {
    return Object.fromEntries(Object.entries(JSON.parse(p.jsonExample)).map(([k, v]) => [k, kind(v)]));
  }
  if (p.workflowInputs) return Object.fromEntries((p.workflowInputs.values || []).map((v) => [v.name, v.type || 'any']));
  return null;
}

// Realistic values for the fields the expressions read; anything else is an
// "unknown" placeholder whose result is not judged.
const KNOWN = { assistant_mode: 'sales', call_type: 'demo', minutes: 30, kind: 'viewing' };
const UNKNOWN = Symbol('unknown');
function placeholder() {
  const target = function () {};
  return new Proxy(target, {
    get(_, key) {
      if (key === UNKNOWN) return true;
      if (key === Symbol.toPrimitive) return () => 'x';
      if (key === 'toString' || key === 'valueOf') return () => 'x';
      if (typeof key === 'string' && key in KNOWN) return KNOWN[key];
      return placeholder();
    },
    apply() { return placeholder(); },
  });
}
const isPlaceholder = (v) => typeof v === 'function' && v[UNKNOWN] === true;
const node$ = () => ({ first: () => ({ json: placeholder() }), item: { json: placeholder() }, all: () => [{ json: placeholder() }] });

function evaluate(expr) {
  const body = expr.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const $now = DateTime ? DateTime.now() : placeholder();
  // eslint-disable-next-line no-new-func
  return new Function('$', '$json', '$now', `return (${body});`)(node$, placeholder(), $now);
}

const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
let checked = 0;
const problems = [];
for (const { file, wf } of workflows) {
  for (const n of wf.nodes) {
    if (!n.type.endsWith('executeWorkflow')) continue;
    const id = n.parameters.workflowId && (n.parameters.workflowId.value || n.parameters.workflowId);
    const target = byId[id];
    const types = target && declared(target.wf);
    if (!types) continue;
    const values = (n.parameters.workflowInputs || {}).value || {};
    for (const [field, raw] of Object.entries(values)) {
      const want = types[field];
      if (!want || want === 'any') continue;
      let got;
      if (typeof raw === 'string' && raw.startsWith('=')) {
        let v;
        try { v = evaluate(raw); } catch (e) { continue; } // needs data we don't stub
        if (isPlaceholder(v)) continue;
        got = typeOf(v);
      } else {
        got = typeOf(raw);
      }
      checked++;
      const ok = got === want || (want === 'object' && got === 'object');
      if (!ok) problems.push(`${file} → "${n.name}" → ${target.file}: ${field} is a ${got}, the sub-workflow expects a ${want}`);
    }
  }
}

console.log('subworkflow_types');
assert.ok(checked > 20, `only ${checked} inputs checked`);
assert.deepStrictEqual(problems, []);
console.log(`  ok - ${checked} sub-workflow inputs have the type their sub-workflow declares`);
