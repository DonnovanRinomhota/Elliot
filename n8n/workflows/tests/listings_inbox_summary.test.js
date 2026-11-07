// Tests for listings search, live chat takeover, AI usage logging, escalation
// alerts and the daily summary (workflows 01, 10, 24, 31 + migration 0027).
//
// Like client_ready_fixes.test.js, this reads each Code node's source straight
// out of the workflow JSON and runs it with a small stand-in for n8n's runtime,
// so it always tests exactly what n8n will import.
//
// Run: node n8n/workflows/tests/listings_inbox_summary.test.js

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

// Runs Code-node source. `nodes` stubs $('Name') -> { first(), item, all() }.
function run(code, { json = {}, nodes = {}, items } = {}) {
  const item = { json };
  const $input = { first: () => item, all: () => items || [item] };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`node ${name} not stubbed`);
    const v = nodes[name];
    const list = Array.isArray(v) ? v : [v];
    return { first: () => ({ json: list[0] }), item: { json: list[0] }, all: () => list.map((j) => ({ json: j })) };
  };
  const fn = new Function('$input', '$json', '$', 'Buffer', code);
  return fn($input, json, $, Buffer);
}

const decodeRaw = (raw) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const wf01 = load('01-main-ai-agent.json');
const wf10 = load('10-lead-capture.json');
const wf24 = load('24-escalate-to-human.json');
const wf31 = load('31-daily-summary-email.json');

// ───────────── 01: wiring ─────────────

test('01: visitor message goes through the takeover check before Claude', () => {
  const c = wf01.connections;
  assert.strictEqual(c['Log User Message'].main[0][0].node, 'Human Has Taken Over?');
  assert.strictEqual(c['Human Has Taken Over?'].main[0][0].node, 'Respond: Team Member Handling');
  assert.strictEqual(c['Human Has Taken Over?'].main[1][0].node, 'Build Claude Request');
  assert.match(nodeOf(wf01, 'Log User Message').parameters.query, /log_user_message\(\$1, \$2, \$3\)/);
  // These functions are revoked from the public API (0027), so n8n must use
  // its service-role connection for them.
  for (const name of ['Log User Message', 'Search Listings', 'Log AI Usage']) {
    assert.strictEqual(nodeOf(wf01, name).credentials.postgres.name, 'Elliot Postgres (service role)', name);
  }
  const body = nodeOf(wf01, 'Respond: Team Member Handling').parameters.responseBody;
  assert.match(body, /reply: null/);
  assert.match(body, /human: true/);
});

test('01: search_listings is offered, allowed and routed to Search Listings', () => {
  const expr = nodeOf(wf01, 'Call Claude').parameters.jsonBody.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  const payload = JSON.parse(new Function('$json', `return ${expr}`)({ system_prompt: 's', claude_messages: [] }));
  const tool = payload.tools.find((t) => t.name === 'search_listings');
  assert.ok(tool, 'tool definition missing');
  assert.deepStrictEqual(tool.input_schema.properties.transaction_type.enum, ['sale', 'rent']);
  assert.ok(tool.input_schema.properties.move_in_by, 'move_in_by filter missing (0028)');
  assert.strictEqual(payload.tools.length, 6);

  const allowed = run(nodeOf(wf01, 'Extract Tool Call').parameters.jsCode, {
    json: { content: [{ type: 'tool_use', id: 't1', name: 'search_listings', input: { location: 'Mokotów' } }] },
  });
  assert.strictEqual(allowed[0].json.decision, 'auto_approved');

  const rules = nodeOf(wf01, 'Route by Tool').parameters.rules.values;
  assert.strictEqual(rules.length, 6);
  assert.strictEqual(rules[5].conditions.conditions[0].rightValue, 'search_listings');
  assert.strictEqual(wf01.connections['Route by Tool'].main[5][0].node, 'Search Listings');
  assert.strictEqual(wf01.connections['Search Listings'].main[0][0].node, 'Build Tool Result Message');
  assert.match(nodeOf(wf01, 'Search Listings').parameters.query, /search_listings\(\$1, \$2::jsonb\)/);
});

test('01: final reply goes through Log AI Usage, then Log Assistant Message', () => {
  const c = wf01.connections;
  assert.strictEqual(c['Extract Final Text'].main[0][0].node, 'Log AI Usage');
  assert.strictEqual(c['Log AI Usage'].main[0][0].node, 'Log Assistant Message');
  assert.strictEqual(nodeOf(wf01, 'Log AI Usage').continueOnFail, true);
  // The tool-denied path still reaches Log Assistant Message directly.
  assert.strictEqual(c['Tool Denied — Fallback Response'].main[0][0].node, 'Log Assistant Message');
});

// ───────────── 01: code nodes ─────────────

const baseNodes = {
  'Merge Tenant Context': { tenant_id: 't1', tenant_name: 'Acme Realty', tenant_industry: 'real estate', message: 'Any flats in Mokotów?' },
  'Load AI Config': {},
};

test('01: history keeps team-member replies as marked assistant turns and drops system notes', () => {
  const out = run(nodeOf(wf01, 'Build Claude Request').parameters.jsCode, {
    nodes: {
      ...baseNodes,
      'Load Conversation History': [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'system', content: 'Ola joined the conversation.' },
        { role: 'human_agent', content: 'Ola here, I can help.' },
      ],
    },
  });
  const msgs = out[0].json.claude_messages;
  assert.deepStrictEqual(msgs.map((m) => m.role), ['user', 'assistant', 'assistant', 'user']);
  assert.strictEqual(msgs[2].content, '[Team member] Ola here, I can help.');
  assert.ok(!msgs.some((m) => String(m.content).includes('joined the conversation')));
  assert.match(out[0].json.system_prompt, /10\. When a visitor asks what properties are available/);
  assert.strictEqual(out[0].json.usage_input_tokens, 0);
});

test('01: listing results are turned into text Claude can quote, and usage accumulates', () => {
  const code = nodeOf(wf01, 'Build Tool Result Message').parameters.jsCode;
  const state = { claude_messages: [{ role: 'user', content: 'x' }], tool_turns: 1, usage_input_tokens: 1000, usage_output_tokens: 100 };
  const nodes = {
    'Assemble Request': state,
    'Call Claude': { content: [{ type: 'tool_use' }], usage: { input_tokens: 500, output_tokens: 50 } },
    'Extract Tool Call': { tool_name: 'search_listings', tool_use_id: 'tu1' },
  };
  const found = run(code, {
    json: { result: { found: true, count: 1, listings: [{
      title: '2-room flat with balcony', reference: 'A-1', transaction_type: 'sale', price: 820000, currency: 'PLN',
      city: 'Warszawa', district: 'Mokotów', area_m2: 48, rooms: 2, floor: 3, features: ['balcony'], url: 'https://x.test/a1',
    }] } },
    nodes,
  })[0].json;
  const text = found.claude_messages[2].content[0].content;
  assert.match(text, /1 available listing\(s\) found/);
  assert.match(text, /2-room flat with balcony \(ref A-1\)/);
  assert.match(text, /For sale: 820000 PLN/);
  assert.match(text, /Mokotów, Warszawa, 48 m2, 2 rooms, floor 3/);
  assert.match(text, /Link: https:\/\/x\.test\/a1/);
  assert.match(text, /Available now/);
  assert.strictEqual(found.usage_input_tokens, 1500);
  assert.strictEqual(found.usage_output_tokens, 150);
  assert.strictEqual(found.tool_turns, 2);

  const later = run(code, {
    json: { result: { found: true, count: 1, listings: [{ title: 'Single room', transaction_type: 'rent', price: 1700, currency: 'PLN', available_from: '2026-12-01' }] } },
    nodes,
  })[0].json;
  assert.match(later.claude_messages[2].content[0].content, /Available from 2026-12-01 \(not before\)/);
  assert.match(later.claude_messages[2].content[0].content, /For rent: 1700 PLN/);

  const none = run(code, { json: { result: { found: false, count: 0, listings: [] } }, nodes })[0].json;
  assert.match(none.claude_messages[2].content[0].content, /Do not invent any/);
});

test('01: lead result builder also accumulates usage', () => {
  const out = run(nodeOf(wf01, 'Build Lead Result Message').parameters.jsCode, {
    json: { success: true, status: 'WARM', contact_id: 'c1' },
    nodes: {
      'Assemble Request': { claude_messages: [], usage_input_tokens: 10, usage_output_tokens: 1 },
      'Call Claude': { content: [], usage: { input_tokens: 5, output_tokens: 2 } },
      'Extract Tool Call': { tool_use_id: 'tu' },
    },
  })[0].json;
  assert.strictEqual(out.usage_input_tokens, 15);
  assert.strictEqual(out.usage_output_tokens, 3);
});

test('01: final text carries the total tokens for the reply', () => {
  const out = run(nodeOf(wf01, 'Extract Final Text').parameters.jsCode, {
    json: { content: [{ type: 'text', text: 'Here you go.' }], usage: { input_tokens: 700, output_tokens: 80 } },
    nodes: { 'Assemble Request': { usage_input_tokens: 1500, usage_output_tokens: 150 } },
  })[0].json;
  assert.strictEqual(out.final_text, 'Here you go.');
  assert.strictEqual(out.usage_input_tokens, 2200);
  assert.strictEqual(out.usage_output_tokens, 230);
});

// ───────────── 10 and 24: alerts ─────────────

test('10: hot leads are escalated through workflow 24 with reason hot_lead', () => {
  assert.ok(!wf10.nodes.some((n) => n.name === 'Insert Escalation'), 'old silent insert still present');
  const n = nodeOf(wf10, 'Escalate Hot Lead (24)');
  assert.strictEqual(n.type, 'n8n-nodes-base.executeWorkflow');
  assert.strictEqual(n.parameters.workflowInputs.value.reason, 'hot_lead');
  const targets = wf10.connections['Is Hot Lead?'].main[0].map((x) => x.node);
  assert.deepStrictEqual(targets.sort(), ['Escalate Hot Lead (24)', 'Format Results']);

  // The summary expression produces readable text.
  const expr = n.parameters.workflowInputs.value.context_summary.replace(/^=\{\{/, '').replace(/\}\}$/, '');
  const trigger = { contact: { name: 'Anna', phone: '+48 600' }, qualification_answers: { budget: '900k', timeline: 'this month' } };
  const $ = () => ({ first: () => ({ json: trigger }) });
  const summary = new Function('$', '$json', `return ${expr}`)($, { score: 85 });
  assert.strictEqual(summary, 'Hot lead (score 85). Name: Anna. Email: not given. Phone: +48 600. Budget: 900k. Timeline: this month.');
});

test('24: accepts hot_lead, emails every recipient with a link to the conversation', () => {
  const v = run(nodeOf(wf24, 'Validate And Default').parameters.jsCode, {
    json: { tenant_id: 't', conversation_id: 'conv-1', reason: 'hot_lead', priority: 'high', context_summary: 'Hot lead (score 85).' },
  })[0].json;
  assert.strictEqual(v.reason, 'hot_lead');
  assert.match(nodeOf(wf24, 'Insert Escalation').parameters.query, /escalation_recipients\(\$1, \$2\) as notify_email/);

  const out = run(nodeOf(wf24, 'Build Notification Email').parameters.jsCode, {
    json: { tenant_name: 'Acme Realty', notify_email: 'office@acme.test, ola@acme.test', escalation_id: 'e1' },
    nodes: { 'Validate And Default': v },
  })[0].json;
  const raw = decodeRaw(out.raw_message);
  assert.match(raw, /^To: office@acme\.test, ola@acme\.test\r\n/);
  assert.match(raw, /Subject: \[Elliot\] Hot lead ready to talk \(high\)/);
  assert.match(raw, /\/dashboard\/conversations\/conv-1/);
});

// ───────────── 31: daily summary ─────────────

test('31: daily summary reads the right function and writes a useful email', () => {
  assert.match(nodeOf(wf31, 'Load Summaries').parameters.query, /get_daily_digests\(\)/);
  assert.strictEqual(wf31.settings.timezone, 'Europe/Warsaw');
  assert.strictEqual(wf31.nodes[0].parameters.rule.interval[0].triggerAtHour, 8);

  const code = nodeOf(wf31, 'Build Summary Email').parameters.jsCode;
  const out = run(code, {
    json: {
      tenant_name: 'Acme Realty', recipient_email: 'boss@acme.test', recipient_name: 'Boss',
      conversations_count: '7', new_leads_count: '3', hot_leads_count: '1', viewings_booked_count: '2',
      viewings_today: [{ time: '10:00', name: 'Anna', notes: 'Mokotów flat' }],
      open_escalations: '1', pending_approvals: '0',
      hot_leads: [{ name: 'Anna', phone: '+48 600', email: 'anna@x.test' }],
    },
  });
  const raw = decodeRaw(out.json.raw_message);
  assert.match(raw, /^To: boss@acme\.test\r\n/);
  assert.match(raw, /Subject: \[Elliot\] Acme Realty: 3 new leads, 1 viewing today/);
  assert.match(raw, /7 conversations, captured 3 new leads and booked 2 viewings/);
  assert.match(raw, /10:00  Anna -- Mokotów flat/);
  assert.match(raw, /Hot leads waiting for a call \(1\):/);
  assert.match(raw, /Needs you: 1 conversation needs a person\./);
  assert.ok(!/approval/.test(raw.split('Needs you')[1].split('\n')[0]), 'zero approvals should not be listed');

  const quiet = decodeRaw(run(code, {
    json: { tenant_name: 'A', recipient_email: 'a@x', recipient_name: 'A', conversations_count: 1, new_leads_count: 1,
      viewings_booked_count: 0, viewings_today: [], hot_leads: [], open_escalations: 0, pending_approvals: 0 },
  }).json.raw_message);
  assert.match(quiet, /1 conversation, captured 1 new lead and booked 0 viewings/);
  assert.match(quiet, /No viewings booked for today\./);
  assert.ok(!/Needs you/.test(quiet));
});

console.log(`\n${passed} tests passed`);
