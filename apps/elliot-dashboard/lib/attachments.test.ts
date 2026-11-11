import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentNote, fileKind, formatSize, placeAttachments, withoutAttachedNote, type Attachment } from "./attachments";

const file = (id: string, at: string, over: Partial<Attachment> = {}): Attachment => ({
  id, filename: `${id}.pdf`, content_type: "application/pdf", size_bytes: 1000, uploaded: true, read_by_elliot: true, created_at: at, ...over,
});

test("the [Attached: …] line is hidden on the page", () => {
  assert.equal(withoutAttachedNote("Here's the plan\n\n[Attached: plan.pdf, photo.jpg]"), "Here's the plan");
  assert.equal(withoutAttachedNote("No files here"), "No files here");
  assert.equal(withoutAttachedNote("[Attached: in the middle] of text"), "[Attached: in the middle] of text");
});

test("files go under the client message they came with", () => {
  const messages = [
    { id: "m1", role: "user", created_at: "2026-11-11T10:00:05Z" },
    { id: "m2", role: "assistant", created_at: "2026-11-11T10:00:20Z" },
    { id: "m3", role: "user", created_at: "2026-11-11T11:00:04Z" },
  ];
  const { byMessage, unplaced } = placeAttachments(messages, [
    file("a", "2026-11-11T10:00:01Z"),
    file("b", "2026-11-11T10:00:02Z"),
    file("c", "2026-11-11T11:00:00Z"),
    file("d", "2026-11-11T12:00:00Z"), // Elliot never answered this one
  ]);
  assert.deepEqual(byMessage.get("m1")?.map((f) => f.id), ["a", "b"]);
  assert.deepEqual(byMessage.get("m3")?.map((f) => f.id), ["c"]);
  assert.equal(byMessage.has("m2"), false);
  assert.deepEqual(unplaced.map((f) => f.id), ["d"]);
});

test("sizes, kinds and the note under each file", () => {
  assert.equal(formatSize(0), "");
  assert.equal(formatSize(900), "900 B");
  assert.equal(formatSize(48_000), "47 KB");
  assert.equal(formatSize(2_400_000), "2.3 MB");
  assert.equal(formatSize(14_000_000), "13 MB");
  assert.equal(fileKind("application/pdf"), "pdf");
  assert.equal(fileKind("image/heic"), "image");
  assert.equal(fileKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "document");
  assert.equal(fileKind(null, "umowa.docx"), "document");
  assert.equal(fileKind("application/zip"), "other");
  assert.equal(attachmentNote(file("a", "x", { size_bytes: 2_400_000 })), "2.3 MB · Read by Elliot");
  assert.equal(attachmentNote(file("a", "x", { read_by_elliot: false, size_bytes: null })), "For the team (Elliot can't open this type)");
  assert.match(attachmentNote(file("a", "x", { uploaded: false })), /Couldn't be saved/);
});
