// Run with: npm test. Client export/erasure and agency deletion (0051).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk, erasedSummary, exportFileName, filesByBucket, parseEraseResult, privacyError } from "./privacy";

test("an erase result is read safely, files de-duplicated, events kept", () => {
  const r = parseEraseResult({
    conversations: 2,
    messages: 14,
    leads: 1,
    appointments: 1,
    drafts: 0,
    files: 2,
    storage_paths: ["t/c/a.pdf", "t/c/a.pdf", "", 7, "t/c/b.jpg"],
    calendar_events: [{ calendar: "agent@x.pl", event_id: "ev1", starts_at: "2026-12-01T10:00:00Z", status: "confirmed" }, { event_id: "" }],
  });
  assert.deepEqual(r.storage_paths, ["t/c/a.pdf", "t/c/b.jpg"]);
  assert.equal(r.calendar_events.length, 1);
  assert.equal(r.calendar_events[0].calendar, "agent@x.pl");
  assert.equal(erasedSummary(r), "Deleted: 2 conversations, 14 messages, 1 viewing, 2 files.");
});

test("a missing or odd result does not throw", () => {
  const r = parseEraseResult(null);
  assert.equal(r.messages, 0);
  assert.deepEqual(r.storage_paths, []);
  assert.equal(erasedSummary(parseEraseResult({ conversations: 1, messages: 1, appointments: 0, files: 1 })), "Deleted: 1 conversation, 1 message, 0 viewings, 1 file.");
});

test("files of a deleted agency are grouped per bucket", () => {
  assert.deepEqual(
    filesByBucket([
      { bucket: "email-attachments", path: "t/1.pdf" },
      { bucket: "listing-photos", path: "t/p.jpg" },
      { bucket: "email-attachments", path: "t/2.pdf" },
      { bucket: "", path: "x" },
      null,
    ]),
    { "email-attachments": ["t/1.pdf", "t/2.pdf"], "listing-photos": ["t/p.jpg"] }
  );
  assert.deepEqual(filesByBucket(undefined), {});
});

test("deletes go in small batches", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
});

test("the export file is named after the client, without Polish letters", () => {
  const d = new Date("2026-11-12T10:00:00Z");
  assert.equal(exportFileName("Łukasz Żółć", d), "elliot-lukasz-zolc-2026-11-12.json");
  assert.equal(exportFileName(null, d), "elliot-client-2026-11-12.json");
  assert.equal(exportFileName("  ", d), "elliot-client-2026-11-12.json");
});

test("database refusals read as plain words", () => {
  assert.equal(privacyError("Only an admin of the agency can do this.", "42501").status, 403);
  assert.equal(privacyError("Client not found.", "P0002").error, "This client no longer exists.");
  assert.equal(privacyError("Could not find the function public.erase_client(p_contact_id) in the schema cache").error, "Run migration 0051 in Supabase first.");
  assert.equal(privacyError("something else").status, 400);
});
