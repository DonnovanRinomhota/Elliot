// Run with: npm test. The control panel's Problems page (0050).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describeProblem, groupProblems, problemDetail, PROBLEM_FILTER } from "./problems";

test("every failure the workflows and database record has plain words and a next step", () => {
  // Every *_failed event written anywhere in the repository.
  const root = path.join(__dirname, "..", "..", "..");
  const files = [
    ...fs.readdirSync(path.join(root, "db", "migrations")).map((f) => path.join(root, "db", "migrations", f)),
    ...fs.readdirSync(path.join(root, "n8n", "workflows")).filter((f) => f.endsWith(".json")).map((f) => path.join(root, "n8n", "workflows", f)),
  ];
  const events = new Set<string>();
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/['"]([a-z]+(?:_[a-z]+)*_failed)['"]/g)) events.add(m[1]);
  for (const e of ["email_send_failed", "whatsapp_send_failed", "chat_send_failed"]) events.add(e); // built as channel || '_send_failed'
  events.delete("fetch_failed"); // a status inside a result, not an audit event
  assert.ok(events.size >= 10, `found ${events.size} events`);
  for (const e of events) {
    const k = describeProblem(e);
    assert.ok(!/ failed$/.test(k.what) || k.what.length > 20, `${e} has no description of its own`);
    assert.ok(k.fix.length > 20, `${e} has no next step`);
  }
});

test("unknown events still read as words", () => {
  assert.equal(describeProblem("calendar_sync_failed").what, "Calendar sync failed");
});

test("details: the useful part only", () => {
  assert.equal(problemDetail({ conversation_id: "c", tool: "book_appointment", error: "invalid_grant" }), "book_appointment · invalid_grant");
  assert.equal(problemDetail({ workflow: "20 - Follow-Up Sweep", node: "Send Email", error: "20 - Follow-Up Sweep / Send Email: timeout" }), "20 - Follow-Up Sweep / Send Email: timeout");
  assert.equal(problemDetail({ workflow: "20 - Follow-Up Sweep", node: "Send Email" }), "20 - Follow-Up Sweep · Send Email");
  assert.equal(problemDetail({ messages_not_answered: 2, from_wa_id: "48" }), "2 not answered");
  assert.equal(problemDetail(null), "");
  assert.equal(problemDetail({ error: "x".repeat(500) }).length, 300);
});

test("grouping and the database filter", () => {
  assert.deepEqual(groupProblems([{ event_type: "b" }, { event_type: "a" }, { event_type: "b" }]), [
    { event_type: "b", count: 2 },
    { event_type: "a", count: 1 },
  ]);
  assert.match(PROBLEM_FILTER, /event_type\.like\.%_failed/);
  assert.match(PROBLEM_FILTER, /workflow_error/);
});
