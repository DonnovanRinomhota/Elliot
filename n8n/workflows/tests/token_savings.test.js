// Tests for the token savings in workflow 01: prompt caching, cached tokens
// counted at their real cost, and thank-you messages answered without
// calling Claude. Listing descriptions stay in full.
//
// Run: node n8n/workflows/tests/token_savings.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WF_DIR = path.join(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(WF_DIR, '01-main-ai-agent.json'), 'utf8'));
const nodeOf = (name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node named ${name}`);
  return n;
};
const next = (name, branch = 0) => (wf.connections[name]?.main?.[branch] || []).map((x) => x.node);
function stubs(nodes) {
  return (name) => {
    const executed = name in nodes;
    const v = nodes[name];
    const list = Array.isArray(v) ? v : [v];
    return {
      isExecuted: executed,
      first: () => { if (!executed) throw new Error(`node ${name} not executed`); return { json: list[0] }; },
      item: { get json() { if (!executed) throw new Error(`node ${name} not executed`); return list[0]; } },
      all: () => list.map((j) => ({ json: j })),
    };
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

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log('token_savings');

const call = (mode, messages) => JSON.parse(expr(nodeOf('Call Claude').parameters.jsonBody, {
  json: { system_prompt: 'SYSTEM', claude_messages: messages },
  nodes: { 'Merge Tenant Context': { assistant_mode: mode } },
}));

test('caching: system prompt, last tool and last message are cache points', () => {
  const body = call('agency', [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use', id: 't1', name: 'search_listings', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] },
  ]);
  assert.deepStrictEqual(body.system, [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
  const marked = body.tools.filter((t) => t.cache_control);
  assert.strictEqual(marked.length, 1);
  assert.strictEqual(body.tools[body.tools.length - 1].cache_control.type, 'ephemeral');
  assert.deepStrictEqual(body.messages[0], { role: 'user', content: 'Hi' }, 'earlier messages untouched');
  assert.ok(!JSON.stringify(body.messages[1]).includes('cache_control'));
  assert.deepStrictEqual(body.messages[2].content, [{ type: 'tool_result', tool_use_id: 't1', content: 'x', cache_control: { type: 'ephemeral' } }]);
  const cachePoints = JSON.stringify(body).split('"cache_control"').length - 1;
  assert.ok(cachePoints <= 4, `Anthropic allows 4 cache points, found ${cachePoints}`);
});

test('caching: a plain text message becomes one cached text block; sales tools too', () => {
  const body = call('sales', [{ role: 'user', content: 'How much is it?' }]);
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: [{ type: 'text', text: 'How much is it?', cache_control: { type: 'ephemeral' } }] }]);
  assert.ok(!body.tools.some((t) => t.name === 'search_listings'));
  assert.strictEqual(body.tools[body.tools.length - 1].cache_control.type, 'ephemeral');
  assert.strictEqual(body.tools.filter((t) => t.cache_control).length, 1);
});

test('cached tokens are logged at their real cost (read 0.1x, write 1.25x)', () => {
  const out = run(nodeOf('Extract Final Text').parameters.jsCode, {
    json: { content: [{ type: 'text', text: 'Hi' }], usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 800 } },
    nodes: { 'Assemble Request': { usage_input_tokens: 1000, usage_output_tokens: 20 } },
  })[0].json;
  assert.strictEqual(out.usage_input_tokens, 1000 + 100 + 400 + 1000);
  assert.strictEqual(out.usage_output_tokens, 70);
  const plain = run(nodeOf('Extract Final Text').parameters.jsCode, {
    json: { content: [{ type: 'text', text: 'Hi' }], usage: { input_tokens: 100, output_tokens: 5 } }, nodes: { 'Assemble Request': {} } })[0].json;
  assert.strictEqual(plain.usage_input_tokens, 100);
  assert.match(nodeOf('Build Tool Result Message').parameters.jsCode, /cache_read_input_tokens \|\| 0\) \* 0\.1/);
});

test('listing descriptions are passed to Elliot in full', () => {
  const code = nodeOf('Build Tool Result Message').parameters.jsCode;
  const long = 'Bright flat with a balcony. '.repeat(40);
  const res = run(code, {
    json: { result: { listings: [{ listing_id: 'L1', title: 'Flat', transaction_type: 'sale', price: 1, currency: 'PLN', description: long }] } },
    nodes: { 'Assemble Request': { claude_messages: [] }, 'Call Claude': { content: [] }, 'Extract Tool Call': { tool_name: 'search_listings', tool_use_id: 't' } },
  })[0].json;
  assert.ok(JSON.stringify(res.claude_messages).includes(long.trim()), 'description was shortened');
});

const quick = (message, history) => run(nodeOf('Quick Reply Check').parameters.jsCode, {
  json: { message, tenant_id: 't' }, nodes: { 'Load Conversation History': history } })[0].json.quick_reply;
const said = (text) => [{ role: 'user', content: 'Do you have flats in Mokotów?' }, { role: 'assistant', content: text }];

test('thank-yous after an answer get a free reply in the same language', () => {
  assert.strictEqual(quick('Thanks!', said('Here are 2 flats: https://x/p/1. Happy to book a viewing.')),
    "You're welcome! If anything else comes up, just write here.");
  assert.strictEqual(quick('Dziękuję bardzo', said('Mamy 2 mieszkania.')), 'Nie ma za co! Gdyby coś jeszcze było potrzebne, proszę śmiało pisać.');
  assert.strictEqual(quick('👍', said('Prezentacja zarezerwowana na czwartek o 10:00.')), 'Nie ma za co! Gdyby coś jeszcze było potrzebne, proszę śmiało pisać.');
  assert.strictEqual(quick('ok', said('Your viewing is booked for Thursday at 10:00.')), "You're welcome! If anything else comes up, just write here.");
});

test('anything that might need Claude still goes to Claude', () => {
  assert.strictEqual(quick('ok', said('Shall I book Thursday at 10:00?')), null, 'answering a question');
  assert.strictEqual(quick('Thanks', said('Reminder: your viewing is tomorrow at 10:00. Reply to confirm, or tell us if you need to change it.')), null, 'after a reminder');
  assert.strictEqual(quick('ok', said('Przypomnienie: prezentacja jutro o 10:00.')), null, 'after a Polish reminder');
  assert.strictEqual(quick('Thanks, and is parking included?', said('Here are 2 flats.')), null, 'a real question');
  assert.strictEqual(quick('thanks', [{ role: 'user', content: 'thanks' }]), null, 'first message of a conversation');
  assert.strictEqual(quick('ok great so what about the price for the bigger one', said('Here are 2 flats.')), null);
});

test('the free reply skips Claude but is logged and returned like any other', () => {
  assert.deepStrictEqual(next('Build Claude Request'), ['Quick Reply Check']);
  assert.deepStrictEqual(next('Quick Reply?', 0), ['Use Quick Reply']);
  assert.deepStrictEqual(next('Quick Reply?', 1), ['Assemble Request']);
  assert.deepStrictEqual(next('Use Quick Reply'), ['Log Assistant Message']);
  const used = run(nodeOf('Use Quick Reply').parameters.jsCode, { json: { quick_reply: 'You are welcome!' } })[0].json;
  assert.deepStrictEqual(used, { final_text: 'You are welcome!', usage_input_tokens: 0, usage_output_tokens: 0 });
  const log = nodeOf('Log Assistant Message').parameters.options.queryReplacement;
  assert.strictEqual(expr(log, { json: used, nodes: { 'Merge Tenant Context': { tenant_id: 't' }, 'Get or Create Conversation': { conversation_id: 'c' } } })[2], 'You are welcome!');
  const resp = nodeOf('Respond to Webhook').parameters.responseBody;
  const base = { 'Get or Create Conversation': { conversation_id: 'c' } };
  assert.deepStrictEqual(expr(resp, { nodes: { ...base, 'Use Quick Reply': used } }), { conversation_id: 'c', reply: 'You are welcome!' });
  assert.deepStrictEqual(expr(resp, { nodes: { ...base, 'Extract Final Text': { final_text: 'From Claude' } } }), { conversation_id: 'c', reply: 'From Claude' });
  const pass = run(nodeOf('Quick Reply Check').parameters.jsCode, { json: { message: 'hi', system_prompt: 'S', claude_messages: [1] }, nodes: { 'Load Conversation History': [] } })[0].json;
  assert.deepStrictEqual([pass.system_prompt, pass.claude_messages, pass.quick_reply], ['S', [1], null], 'normal messages pass through unchanged');
});

console.log(`\n${passed} passed`);
