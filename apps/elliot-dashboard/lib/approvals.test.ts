// Run with: npm test. Dates and the client's message on Approvals cards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftTimeline, inboundFor, stamp } from "./approvals";

const TZ = "Europe/Warsaw";

test("times are shown in the agency's time zone", () => {
  assert.equal(stamp("2026-11-09T16:01:00Z", TZ), "9 Nov 2026, 17:01");
});

test("each draft shows received, drafted and what happened next", () => {
  const base = { created_at: "2026-11-09T16:02:00Z" };
  assert.deepEqual(draftTimeline({ ...base, status: "pending" }, TZ, "2026-11-09T16:01:00Z"), [
    ["Received", "9 Nov 2026, 17:01"],
    ["Drafted", "9 Nov 2026, 17:02"],
  ]);
  assert.deepEqual(draftTimeline({ ...base, status: "sent", reviewed_at: "2026-11-09T16:04:00Z", sent_at: "2026-11-09T16:05:00Z" }, TZ), [
    ["Drafted", "9 Nov 2026, 17:02"],
    ["Sent", "9 Nov 2026, 17:05"],
  ]);
  assert.deepEqual(draftTimeline({ ...base, status: "auto_sent", sent_at: "2026-11-09T16:02:30Z" }, TZ).at(-1), ["Sent automatically", "9 Nov 2026, 17:02"]);
  assert.deepEqual(draftTimeline({ ...base, status: "rejected", reviewed_at: "2026-11-09T16:10:00Z" }, TZ).at(-1), ["Rejected", "9 Nov 2026, 17:10"]);
  assert.deepEqual(draftTimeline({ ...base, status: "approved", reviewed_at: "2026-11-09T16:10:00Z" }, TZ).at(-1), ["Approved, sending", "9 Nov 2026, 17:10"]);
});

test("the client's message is the latest one before the draft, in the same conversation", () => {
  const msgs = [
    { conversation_id: "c1", content: "first", created_at: "2026-11-09T15:00:00Z" },
    { conversation_id: "c1", content: "the question", created_at: "2026-11-09T16:01:00Z" },
    { conversation_id: "c1", content: "a later follow-up", created_at: "2026-11-09T18:00:00Z" },
    { conversation_id: "c2", content: "someone else", created_at: "2026-11-09T16:01:30Z" },
  ];
  assert.equal(inboundFor({ conversation_id: "c1", created_at: "2026-11-09T16:02:00Z" }, msgs)?.content, "the question");
  assert.equal(inboundFor({ conversation_id: "c1", created_at: "2026-11-09T16:00:30Z" }, msgs)?.content, "the question", "a minute's leeway");
  assert.equal(inboundFor({ conversation_id: null, created_at: "2026-11-09T16:02:00Z" }, msgs), null);
  assert.equal(inboundFor({ conversation_id: "c9", created_at: "2026-11-09T16:02:00Z" }, msgs), null);
});
