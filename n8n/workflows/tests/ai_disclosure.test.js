// EU AI Act Art. 50(1): Elliot's first reply on WhatsApp or email says it is
// an AI assistant (the website chat says so in its header).
//
// Run: node n8n/workflows/tests/ai_disclosure.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '01-main-ai-agent.json'), 'utf8'));
const code = wf.nodes.find((n) => n.name === 'Extract Final Text').parameters.jsCode;
function run(reply, ctx, history) {
  const nodes = { 'Assemble Request': { usage_input_tokens: 0, usage_output_tokens: 0 }, 'Merge Tenant Context': ctx, 'Load Conversation History': history };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`node ${name} not stubbed`);
    const v = nodes[name]; const list = Array.isArray(v) ? v : [v];
    return { first: () => ({ json: list[0] }), item: { json: list[0] }, all: () => list.map((j) => ({ json: j })) };
  };
  const json = { content: [{ type: 'text', text: reply }], usage: { input_tokens: 1, output_tokens: 1 } };
  return new Function('$input', '$json', '$', code)({ first: () => ({ json }) }, json, $)[0].json.final_text;
}
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok - ${name}`); };
const agency = { channel: 'whatsapp', tenant_name: 'Simon Real Estate', assistant_mode: 'agency' };
const user = [{ role: 'user', content: 'Hi' }];
console.log('ai_disclosure');

test('first WhatsApp or email reply opens with the AI notice, in the reply\'s language', () => {
  assert.strictEqual(run('Hello! Yes, the flat is available.', agency, user),
    'This is Elliot, the AI assistant of Simon Real Estate. You can ask for someone from the team at any time.\n\nHello! Yes, the flat is available.');
  assert.match(run('Dzień dobry, mieszkanie jest dostępne.', { ...agency, channel: 'email' }, user),
    /^Tu Elliot, asystent AI biura Simon Real Estate\. W każdej chwili mogą Państwo poprosić o kontakt z pracownikiem biura\.\n\nDzień dobry/);
  assert.match(run('Hi!', { ...agency, assistant_mode: 'sales', tenant_name: 'Elliot' }, user), /^This is Elliot, an AI assistant\. You can ask for a person at any time\./);
});

test('only once per conversation, and not in the website chat', () => {
  assert.strictEqual(run('Sure.', agency, [...user, { role: 'assistant', content: 'x' }]), 'Sure.');
  assert.strictEqual(run('Sure.', agency, [...user, { role: 'human_agent', content: 'x' }]), 'Sure.');
  assert.strictEqual(run('Sure.', { ...agency, channel: 'chat_widget' }, user), 'Sure.');
});

console.log(`${passed} passed`);
