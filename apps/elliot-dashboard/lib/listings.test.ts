// Run with: npm test. CSV and number parsing for the Listings import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseNumber, formatPrice } from "./listings";

test("parseCsv handles quotes, escaped quotes, CRLF and semicolons", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [
    ["a", "b"],
    ["x, y", 'say "hi"'],
  ]);
  assert.deepEqual(parseCsv("tytuł;cena\nMieszkanie;820 000\n"), [
    ["tytuł", "cena"],
    ["Mieszkanie", "820 000"],
  ]);
  assert.deepEqual(parseCsv("﻿a,b\n\n1,2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseNumber understands Polish and English number formats", () => {
  assert.equal(parseNumber("820000"), 820000);
  assert.equal(parseNumber("1 250 000"), 1250000);
  assert.equal(parseNumber("1.250.000,50"), 1250000.5);
  assert.equal(parseNumber("1,250,000.50"), 1250000.5);
  assert.equal(parseNumber("1,250,000"), 1250000);
  assert.equal(parseNumber("48,5"), 48.5);
  assert.equal(parseNumber("820 000 zł"), 820000);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("n/a"), null);
});

test("formatPrice", () => {
  assert.equal(formatPrice(820000, "PLN", "sale"), "820 000 PLN");
  assert.equal(formatPrice("3200", "PLN", "rent"), "3 200 PLN / month");
  assert.equal(formatPrice(null, "PLN", "sale"), "Price on request");
});
