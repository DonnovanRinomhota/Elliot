// Run with: npm test. CSV import rules for the Listings page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseNumber, parseListingsCsv, formatPrice, CSV_TEMPLATE } from "./listings";

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

test("the downloadable template imports cleanly", () => {
  const { rows, missingTitle } = parseListingsCsv(CSV_TEMPLATE);
  assert.equal(missingTitle, false);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].errors, []);
  const l = rows[0].listing!;
  assert.equal(l.reference, "W-101");
  assert.equal(l.price, 820000);
  assert.equal(l.transaction_type, "sale");
  assert.deepEqual(l.features, ["balcony", "lift"]);
  assert.equal(l.floor, 3);
});

test("Polish headers and values map onto the right fields", () => {
  const csv = "Numer oferty;Tytuł;Transakcja;Rodzaj;Cena;Miasto;Dzielnica;Powierzchnia;Pokoje;Status\n" +
    "K-7;Dom z ogrodem;sprzedaż;dom;1 900 000;Piaseczno;;145,5;5;dostępne\n" +
    "K-8;Kawalerka;wynajem;mieszkanie;3200;Kraków;Kazimierz;28;1;wynajęte\n";
  const { rows } = parseListingsCsv(csv);
  assert.equal(rows.length, 2);
  const [a, b] = rows.map((r) => r.listing!);
  assert.equal(a.reference, "K-7");
  assert.equal(a.property_type, "house");
  assert.equal(a.transaction_type, "sale");
  assert.equal(a.price, 1900000);
  assert.equal(a.area_m2, 145.5);
  assert.equal(a.status, "available");
  assert.equal(b.transaction_type, "rent");
  assert.equal(b.status, "let");
  assert.equal(b.district, "Kazimierz");
});

test("bad rows are reported with their line number and not imported", () => {
  const { rows } = parseListingsCsv("title,price,status\n,100,available\nFlat,abc,available\nHouse,5,flying\n");
  assert.equal(rows[0].line, 2);
  assert.deepEqual(rows[0].errors, ["Missing title"]);
  assert.deepEqual(rows[1].errors, ['Price "abc" is not a number']);
  assert.deepEqual(rows[2].errors, ['Unknown status "flying"']);
  assert.ok(rows.every((r) => r.listing === null));
});

test("a file without a title column is flagged", () => {
  assert.equal(parseListingsCsv("price,city\n1,Warszawa\n").missingTitle, true);
});

test("formatPrice", () => {
  assert.equal(formatPrice(820000, "PLN", "sale"), "820 000 PLN");
  assert.equal(formatPrice("3200", "PLN", "rent"), "3 200 PLN / month");
  assert.equal(formatPrice(null, "PLN", "sale"), "Price on request");
});
