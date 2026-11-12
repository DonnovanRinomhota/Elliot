// Run with: npm test. What the Conversations and Leads lists say about each row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationActivity, lookingFor } from "./conversation-summary";

test("what a client is looking for comes from the answers Elliot collected", () => {
  assert.equal(lookingFor({ property_type: "2-bed flat, Mokotów", budget: "up to 900k", timeline: "within a month" }), "2-bed flat, Mokotów · up to 900k · within a month");
  assert.equal(lookingFor({ budget: "1 mln zł" }), "1 mln zł");
  assert.equal(lookingFor({ valuation: { address: "ul. Puławska 10/5", city: "Warszawa" } }), "Valuation · ul. Puławska 10/5");
  assert.equal(lookingFor({}), null);
  assert.equal(lookingFor(null), null);
  assert.equal(lookingFor({ budget: 5, property_type: "  " }), null);
});

test("a conversation's line says the most important thing that happened", () => {
  const tz = "Europe/Warsaw";
  assert.deepEqual(conversationActivity({ status: "open", notClient: true, lastRole: "assistant" }).tone, "muted");
  assert.match(conversationActivity({ status: "open", booking: { starts_at: "2026-11-19T16:00:00Z" }, tz }).text, /^Viewing booked .*17:00$/);
  assert.equal(conversationActivity({ status: "escalated", handler: "Ola" }).text, "Ola is handling it");
  assert.equal(conversationActivity({ status: "escalated" }).text, "Handed to a person");
  assert.equal(conversationActivity({ status: "open", draftWaiting: true, lastRole: "user" }).text, "Reply waiting for your approval");
  assert.equal(conversationActivity({ status: "open", lastRole: "assistant" }).text, "Elliot replied");
  assert.equal(conversationActivity({ status: "open", lastRole: "user" }).text, "Waiting for a reply");
  assert.equal(conversationActivity({ status: "open" }).text, "No messages yet");
});
