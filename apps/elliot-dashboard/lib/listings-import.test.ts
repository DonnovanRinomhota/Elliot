// Run with: npm test. Turning messy spreadsheets and CSVs into listings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSV_TEMPLATE } from "./listings";
import {
  applyRecipe,
  autoRecipe,
  autoRecipeIsGood,
  cellText,
  checkRecipe,
  chunkText,
  columnLetter,
  describeTable,
  explainRecipe,
  fillTemplate,
  gridToTable,
  normalizeListing,
  parseDate,
  readCsvListings,
  titleCase,
  type Cell,
  type Recipe,
} from "./listings-import";

// A made-up sheet shaped like a real room-rental agency's: the header is in
// row 1 (merged over rows 1-3 in Excel), rows 2-3 hold counters, Polish and
// English headers are mixed, two columns are both called RENT, and several
// columns are internal (caretaker, owner rent split, contract end).
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const GRID: Cell[][] = [
  ["Lp", "Opiekun", "ADDRESS", "ROOM NUMBER", "No of rooms in flat", "1-PERS./2-PERS./studio/2-ROOMS/FLAT", "BALCONY", "TOTAL PRICE", "Administration fees", "RENT", "CZYNSZ", "RENT", "Liczba wolnych pokoi", "AVAILABLE FROM", "DATE OF CONTRACTS ENDING", "DISTRICT", "REMARKS", "LINKS TO PHOTOS"],
  [null, null, null, null, null, null, null, null, null, null, null, null, 117, null, null, null, null, null],
  [22, null, null, null, null, null, null, null, null, null, null, null, 0.7, null, null, null, null, null],
  [1, "Kowal", "Testowa 1 m.4", 1, null, "2 ROOM FLAT", null, 4700, 680, null, null, 4020, 1, d("2026-09-14"), d("2026-09-13"), "CENTRUM", "METRO ARSENAŁ", "https://photos.test/1"],
  [2, "Nowak", "Próbna 5", "A", 4, "SINGLE", "YES", 2100, 400, 1490, 1290, 1700, null, d("2027-09-01"), d("2027-08-31"), "MOKOTÓW", "Balcony / METRO POLE MOKOTOWSKIE", "https://photos.test/2"],
  [3, "Nowak", "Próbna 5", "B", 4, "DOUBLE", null, 2400, 600, null, null, 1800, null, d("2026-12-01"), d("2026-11-30"), "Moktów", null, "https://photos.test/3"],
  [4, "Kowal", "Przykładowa 9", 1, 5, "STUDIO", "---", 3400, 600, 2690, 2490, 2800, null, null, null, "PRAGA PD", "GARDEN", null],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  [5, "Kowal", null, null, null, "SINGLE", null, 1500, 400, null, null, 1100, null, null, null, "WOLA", null, null], // no address: skipped by the recipe
];

// What Claude is expected to plan for that sheet (letters A..R).
const RECIPE: Recipe = {
  fields: {
    reference: { template: "{C} / {D}" },
    title: { template: "{F:type_label}, {C}" },
    status: { value: "available" },
    transaction_type: { value: "rent" },
    property_type: { column: "F", map: "type_kind" },
    price: { column: "H" },
    currency: { value: "PLN" },
    city: { value: "Warszawa" },
    district: { column: "P", map: "district", transform: "title_case" },
    address: { column: "C" },
    rooms: { column: "F", map: "type_rooms" },
    description: { template: "[[{E} rooms in the flat. ]][[Price includes {I} PLN administration fees.]]" },
    url: { column: "R" },
    available_from: { column: "N" },
  },
  maps: {
    type_label: { SINGLE: "Single room", DOUBLE: "Double room", STUDIO: "Studio", "2 ROOM FLAT": "2-room flat" },
    type_kind: { SINGLE: "room", DOUBLE: "room", STUDIO: "apartment", "2 ROOM FLAT": "apartment", "*": "other" },
    type_rooms: { SINGLE: 1, DOUBLE: 1, STUDIO: 1, "2 ROOM FLAT": 2 },
    district: { "PRAGA PD": "Praga-Południe", "Moktów": "Mokotów" },
  },
  features: [
    { column: "G", when: ["YES"], feature: "balcony" },
    { column: "Q", split: true },
  ],
  skip_rows_where: [{ column: "C", is_empty: true }],
  ignored: [
    { column: "B", reason: "Internal: caretaker" },
    { column: "J", reason: "Internal rent split" },
    { column: "O", reason: "Internal: contract end date" },
  ],
  notes: ["All rentals in Warsaw."],
  source: "ai",
};

test("columnLetter", () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52].map(columnLetter), ["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
});

test("gridToTable finds the header, renames duplicates and drops counter rows", () => {
  const t = gridToTable(GRID);
  assert.equal(t.headerRow, 0);
  assert.equal(t.columns.find((c) => c.letter === "L")?.header, "RENT (2)");
  assert.equal(t.rows.length, 5); // 4 real rows + the one without address (kept here, skipped by the recipe)
  assert.equal(t.skipped, 2); // the two counter rows
});

test("header row further down the sheet is found", () => {
  const t = gridToTable([["Agency stock list"], [null], ["Title", "Price", "City"], ["Flat", 100, "Kraków"], ["House", 200, "Kraków"]]);
  assert.equal(t.headerRow, 2);
  assert.deepEqual(t.columns.map((c) => c.header), ["Title", "Price", "City"]);
  assert.equal(t.rows.length, 2);
});

test("the planned recipe turns the messy sheet into clean listings", () => {
  const t = gridToTable(GRID);
  assert.deepEqual(checkRecipe(RECIPE, t), []);
  const rows = applyRecipe(t, RECIPE);
  assert.equal(rows.length, 4, "row without an address is skipped");
  assert.ok(rows.every((r) => r.errors.length === 0), JSON.stringify(rows.map((r) => r.errors)));
  const [flat, single, double, studio] = rows.map((r) => r.listing!);

  assert.equal(flat.title, "2-room flat, Testowa 1 m.4");
  assert.equal(flat.reference, "Testowa 1 m.4 / 1");
  assert.equal(flat.property_type, "apartment");
  assert.equal(flat.transaction_type, "rent");
  assert.equal(flat.rooms, 2);
  assert.equal(flat.price, 4700);
  assert.equal(flat.district, "Centrum");
  assert.equal(flat.city, "Warszawa");
  assert.equal(flat.available_from, "2026-09-14");
  assert.equal(flat.description, "Price includes 680 PLN administration fees.");
  assert.deepEqual(flat.features, ["Metro Arsenał"]);
  assert.equal(flat.url, "https://photos.test/1");

  assert.equal(single.title, "Single room, Próbna 5");
  assert.equal(single.property_type, "room");
  assert.equal(single.district, "Mokotów");
  assert.deepEqual(single.features, ["balcony", "Balcony", "Metro Pole Mokotowskie"]);
  assert.equal(single.description, "4 rooms in the flat. Price includes 400 PLN administration fees.");

  assert.equal(double.district, "Mokotów", "typo fixed by the district map");
  assert.equal(studio.district, "Praga-Południe");
  assert.equal(studio.available_from, null, "no date = available now");
  assert.deepEqual(studio.features, ["Garden"], "'---' in BALCONY is not a yes");

  // Internal columns never reach a listing.
  const all = JSON.stringify(rows);
  for (const secret of ["Kowal", "Nowak", "1290", "2027-08-31"]) assert.ok(!all.includes(secret), `${secret} leaked`);
});

test("checkRecipe catches columns and maps that don't exist", () => {
  const t = gridToTable(GRID);
  const bad: Recipe = { fields: { title: { template: "{ZZ}" }, property_type: { column: "F", map: "nope" } } };
  assert.deepEqual(checkRecipe(bad, t), ["title uses column ZZ, which isn't in the file", "property_type uses a map called nope that isn't defined"]);
  assert.deepEqual(checkRecipe({ fields: {} }, t), ["No title"]);
});

test("explainRecipe describes the plan in plain words", () => {
  const t = gridToTable(GRID);
  const ex = explainRecipe(RECIPE, t);
  assert.deepEqual(ex.find((e) => e.field === "Price"), { field: "Price", from: "“TOTAL PRICE”" });
  assert.deepEqual(ex.find((e) => e.field === "City"), { field: "City", from: "always “Warszawa”" });
  assert.deepEqual(ex.find((e) => e.field === "Title"), { field: "Title", from: "built from “1-PERS./2-PERS./studio/2-ROOMS/FLAT”, “ADDRESS”" });
  assert.match(ex.find((e) => e.field === "Features")!.from, /“balcony” when “BALCONY” is YES/);
});

test("describeTable gives Claude headers, examples and sample rows without blanks", () => {
  const desc = describeTable(gridToTable(GRID), 2);
  const type = desc.columns.find((c) => c.letter === "F")!;
  assert.equal(type.header, "1-PERS./2-PERS./studio/2-ROOMS/FLAT");
  assert.deepEqual(type.examples.sort(), ["2 ROOM FLAT", "DOUBLE", "SINGLE", "STUDIO"]);
  assert.equal(desc.total_rows, 5);
  assert.equal(desc.sample_rows.length, 2);
  assert.equal(desc.sample_rows[0].N, "2026-09-14");
  assert.ok(!("J" in desc.sample_rows[0]), "empty cells left out");
});

test("fillTemplate drops optional parts with missing values", () => {
  const letters = new Map([["A", 0], ["B", 1]]);
  assert.equal(fillTemplate("[[{A} rooms. ]][[Near {B}.]]", [3, null], letters), "3 rooms.");
  assert.equal(fillTemplate("[[{A} rooms. ]][[Near {B}.]]", [null, "metro"], letters), "Near metro.");
  assert.equal(fillTemplate("{A:m}", ["x"], letters, { m: { X: "mapped" } }), "mapped");
});

test("dates in every common form", () => {
  assert.equal(parseDate(d("2026-09-14")), "2026-09-14");
  assert.equal(parseDate("2026-9-4"), "2026-09-04");
  assert.equal(parseDate("14.09.2026"), "2026-09-14");
  assert.equal(parseDate("14/09/2026"), "2026-09-14");
  assert.equal(parseDate(46279), "2026-09-14"); // Excel serial
  assert.equal(parseDate("od zaraz"), null);
  assert.equal(parseDate("now"), null);
  assert.equal(parseDate("someday"), null);
  assert.equal(cellText(4.0), "4");
  assert.equal(cellText(0.70153), "0.7");
});

test("normalizeListing validates like the form does", () => {
  assert.deepEqual(normalizeListing({ title: "" }).errors, ["Missing title"]);
  assert.deepEqual(normalizeListing({ title: "X", price: "abc" }).errors, ['Price "abc" is not a number']);
  assert.deepEqual(normalizeListing({ title: "X", status: "flying" }).errors, ['Unknown status "flying"']);
  assert.deepEqual(normalizeListing({ title: "X", available_from: "someday" }).errors, ['Available-from "someday" is not a date']);
  const ok = normalizeListing({ title: "X", status: "wynajęte", transaction_type: "wynajem", property_type: "kawalerka", currency: "zł", price: "3 200" });
  assert.deepEqual(
    [ok.listing!.status, ok.listing!.transaction_type, ok.listing!.property_type, ok.listing!.currency, ok.listing!.price],
    ["let", "rent", "apartment", "PLN", 3200]
  );
  assert.equal(normalizeListing({ title: "X", property_type: "castle" }).listing!.property_type, "other");
  assert.equal(normalizeListing({ title: "X", status: "under offer" }).listing!.status, "under_offer");
});

test("Elliot's own CSV template imports with header matching alone", () => {
  const { rows, recipe, missingTitle } = readCsvListings(CSV_TEMPLATE);
  assert.equal(missingTitle, false);
  assert.ok(autoRecipeIsGood(recipe));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.errors.length === 0), JSON.stringify(rows));
  const [a, b] = rows.map((r) => r.listing!);
  assert.equal(a.reference, "W-101");
  assert.equal(a.price, 820000);
  assert.deepEqual(a.features, ["balcony", "lift"]);
  assert.equal(a.available_from, null);
  assert.equal(b.transaction_type, "rent");
  assert.equal(b.property_type, "room");
  assert.equal(b.available_from, "2026-12-01");
});

test("Polish headers and values work with header matching", () => {
  const csv =
    "Numer oferty;Tytuł;Transakcja;Rodzaj;Cena;Miasto;Dzielnica;Powierzchnia;Pokoje;Status\n" +
    "K-7;Dom z ogrodem;sprzedaż;dom;1 900 000;Piaseczno;;145,5;5;dostępne\n" +
    "K-8;Kawalerka;wynajem;mieszkanie;3200;Kraków;Kazimierz;28;1;wynajęte\n";
  const { rows } = readCsvListings(csv);
  const [a, b] = rows.map((r) => r.listing!);
  assert.equal(a.property_type, "house");
  assert.equal(a.price, 1900000);
  assert.equal(a.area_m2, 145.5);
  assert.equal(b.status, "let");
  assert.equal(b.transaction_type, "rent");
});

test("a messy sheet is not good enough for header matching alone", () => {
  const recipe = autoRecipe(gridToTable(GRID));
  assert.equal(autoRecipeIsGood(recipe), false); // no title column -> Claude plans it
});

test("titleCase handles Polish letters and hyphens", () => {
  assert.equal(titleCase("PRAGA-POŁUDNIE"), "Praga-Południe");
  assert.equal(titleCase("BIAŁOŁĘKA"), "Białołęka");
});

test("chunkText splits long documents at paragraph breaks", () => {
  const para = (n: number) => `Listing ${n}\n` + "x".repeat(900);
  const text = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
  const chunks = chunkText(text, 3000);
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((c) => c.length <= 3000));
  assert.ok(chunks[1].startsWith("Listing"), "chunks start at a listing boundary");
  assert.deepEqual(chunkText("   "), []);
  assert.equal(chunkText("y".repeat(10_000), 4000).length, 3);
});
