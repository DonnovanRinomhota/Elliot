// Run with: npm test. Cleaning what Claude returns before it's used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanRecipe, RECIPE_TOOL } from "./listings-ai";
import { LISTING_FIELDS } from "./listings-import";

test("cleanRecipe keeps one source per field and normalises letters", () => {
  const r = cleanRecipe({
    fields: {
      title: { template: "{l:type}, {G}", column: "X" },
      price: { column: " n " },
      city: { value: "Warszawa" },
      district: { column: "w", map: "d", transform: "title_case" },
      rooms: { map: "only a map" },
      floor: "nonsense",
    },
    features: [{ column: "m", when: ["YES"], feature: "balcony" }, { column: "x" }, { nothing: true }],
    skip_rows_where: [{ column: "g", is_empty: true }],
    notes: ["a", 5],
  });
  assert.deepEqual(r.fields, {
    title: { template: "{l:type}, {G}" },
    price: { column: "N" },
    city: { value: "Warszawa" },
    district: { column: "W", map: "d", transform: "title_case" },
  });
  assert.deepEqual(r.features, [{ column: "M", when: ["YES"], feature: "balcony" }, { column: "X", split: true }]);
  assert.deepEqual(r.skip_rows_where, [{ column: "G", is_empty: true }]);
  assert.deepEqual(r.notes, ["a"]);
  assert.equal(r.source, "ai");
});

test("the recipe tool offers every listing field", () => {
  assert.deepEqual(Object.keys((RECIPE_TOOL.input_schema as any).properties.fields.properties), [...LISTING_FIELDS]);
});
