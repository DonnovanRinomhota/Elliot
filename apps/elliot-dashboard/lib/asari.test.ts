import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAsariCredentials, splitPastedCredentials, syncState, syncSummary } from "./asari";

test("credentials are checked before saving", () => {
  assert.equal(checkAsariCredentials("12345", "abcdefgh1234", true), null);
  assert.match(checkAsariCredentials("", "abcdefgh1234", true)!, /user ID/);
  assert.match(checkAsariCredentials("12345", "", true)!, /token/);
  assert.equal(checkAsariCredentials("12345", "", false), null, "token may stay as saved");
  assert.match(checkAsariCredentials("12 345", "abcdefgh1234", true)!, /single word/);
  assert.match(checkAsariCredentials("12345:abc", "", false)!, /own boxes/);
  assert.match(checkAsariCredentials("12345", "short", true)!, /doesn't look/);
});

test("ID:token pasted in one box is split", () => {
  assert.deepEqual(splitPastedCredentials(" 12345:abcdEFGH9876 "), { userId: "12345", token: "abcdEFGH9876" });
  assert.equal(splitPastedCredentials("12345"), null);
  assert.equal(splitPastedCredentials("12345:abc"), null);
});

test("sync summary and state", () => {
  assert.equal(syncSummary({ new: 3, updated: 2, withdrawn: 1 }), "3 new, 2 updated, 1 no longer in ASARI");
  assert.equal(syncSummary({ exported: 40 }), "no changes");
  assert.equal(syncSummary({ new: 150, left_for_next_run: 60 }), "150 new; 60 more on the next sync");
  assert.equal(syncSummary(null), "");
  assert.equal(syncState({ connected: false }), "off");
  const base = { connected: true as const, enabled: true, api_user_id: "1", last_sync_at: null, last_sync_ok: null, last_sync_error: null, last_sync_counts: null, listings: 0 };
  assert.equal(syncState(base), "waiting");
  assert.equal(syncState({ ...base, enabled: false }), "paused");
  assert.equal(syncState({ ...base, last_sync_at: "2026-11-11T10:00:00Z", last_sync_ok: true }), "ok");
  assert.equal(syncState({ ...base, last_sync_at: "2026-11-11T10:00:00Z", last_sync_ok: false }), "error");
});
