// Turning any spreadsheet into listings.
//
// 1. A sheet (CSV or Excel) becomes a Table: find the header row, give every
//    column a letter (A, B, C... like Excel), drop empty and summary rows.
// 2. A Recipe says how to build each listing field from those columns:
//    take a column (optionally through a value map), fill a template, or use
//    a fixed value. Recipes come from simple header matching (autoRecipe) or,
//    for files that don't match, from Claude looking at the headers and a
//    few sample rows (/api/listings/plan). Either way the recipe is plain
//    data, and applying it (applyRecipe) is ordinary code: every row is
//    converted the same way, it's instant for thousands of rows, and the
//    person importing can read what was decided before anything is saved.
// 3. normalizeListing() validates and cleans each result, exactly as for a
//    listing typed in by hand.
//
// Documents without columns (PDF, Word, plain text) go a different way:
// Claude reads the text and returns listings directly (/api/listings/extract);
// those results also pass through normalizeListing().
//
// Pure functions only (no browser APIs), unit tested in listings-import.test.ts.

import {
  LISTING_STATUSES,
  parseCsv,
  PROPERTY_TYPES,
  TRANSACTION_TYPES,
  mapHeaders,
  parseNumber,
  type ListingInput,
  type ListingStatus,
  type PropertyType,
  type TransactionType,
} from "./listings";

export type Cell = string | number | boolean | Date | null | undefined;

export type Column = { letter: string; header: string; index: number };
export type Table = { columns: Column[]; rows: Cell[][]; headerRow: number; skipped: number };

export const LISTING_FIELDS = [
  "reference",
  "title",
  "status",
  "transaction_type",
  "property_type",
  "price",
  "currency",
  "city",
  "district",
  "address",
  "area_m2",
  "rooms",
  "bedrooms",
  "bathrooms",
  "floor",
  "description",
  "url",
  "image_url",
  "available_from",
] as const;
export type ListingField = (typeof LISTING_FIELDS)[number];

export type ListingDraft = ListingInput & { available_from: string | null };

// ── Columns and tables ──

export function columnLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const isBlank = (c: Cell) => c == null || (typeof c === "string" && c.trim() === "");
const isTexty = (c: Cell) => typeof c === "string" && c.trim() !== "" && parseNumber(c) == null;

/**
 * Finds the header row (the row among the first 15 with the most text cells),
 * then keeps data rows. Rows with far fewer filled cells than a typical row
 * (totals, counters, blank spacer rows) are dropped and counted in `skipped`.
 */
export function gridToTable(grid: Cell[][]): Table {
  const width = Math.max(0, ...grid.map((r) => r.length));
  let headerRow = 0;
  let best = -1;
  grid.slice(0, 15).forEach((r, i) => {
    const score = r.filter(isTexty).length;
    if (score > best) {
      best = score;
      headerRow = i;
    }
  });

  const header = grid[headerRow] ?? [];
  const seen = new Map<string, number>();
  const columns: Column[] = [];
  for (let i = 0; i < width; i++) {
    let name = isBlank(header[i]) ? "" : String(header[i]).replace(/\s+/g, " ").trim();
    if (name) {
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      if (n > 1) name = `${name} (${n})`;
    }
    columns.push({ letter: columnLetter(i), header: name, index: i });
  }

  const body = grid.slice(headerRow + 1);
  const filled = body.map((r) => r.filter((c) => !isBlank(c)).length).filter((n) => n > 0);
  const sorted = [...filled].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const minFilled = Math.max(2, Math.ceil(median * 0.4));

  const rows: Cell[][] = [];
  let skipped = 0;
  for (const r of body) {
    const n = r.filter((c) => !isBlank(c)).length;
    if (n === 0) continue;
    if (n < minFilled) {
      skipped++;
      continue;
    }
    rows.push(Array.from({ length: width }, (_, i) => r[i] ?? null));
  }

  // Columns with no header and no data are noise.
  const used = columns.filter((c) => c.header || rows.some((r) => !isBlank(r[c.index])));
  return { columns: used, rows, headerRow, skipped };
}

/** What Claude is shown to plan a recipe: headers, sample values, sample rows. */
export function describeTable(table: Table, sampleRows = 12) {
  return {
    columns: table.columns.map((c) => {
      const values = table.rows.map((r) => cellText(r[c.index])).filter(Boolean);
      const distinct = Array.from(new Set(values));
      return {
        letter: c.letter,
        header: c.header || "(no header)",
        filled: values.length,
        distinct: distinct.length,
        examples: distinct.slice(0, distinct.length <= 25 ? 25 : 8),
      };
    }),
    total_rows: table.rows.length,
    sample_rows: table.rows.slice(0, sampleRows).map((r) =>
      Object.fromEntries(table.columns.map((c) => [c.letter, cellText(r[c.index])]).filter(([, v]) => v !== ""))
    ),
  };
}

// ── Cell values ──

/** Excel serial day numbers (1900 system) -> Date. */
function excelSerialToDate(n: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Text for templates and display: whole numbers without ".0", dates as YYYY-MM-DD. */
export function cellText(c: Cell): string {
  if (c == null) return "";
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? "" : isoDate(c);
  if (typeof c === "number") return Number.isInteger(c) ? String(c) : String(Math.round(c * 100) / 100);
  if (typeof c === "boolean") return c ? "yes" : "no";
  return c.replace(/\s+/g, " ").trim();
}

/** "2026-09-14", Date, Excel serial, "14.09.2026", "14/09/2026", "now"/"od zaraz" -> YYYY-MM-DD or null. */
export function parseDate(c: Cell): string | null {
  if (c == null || c === "") return null;
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : isoDate(c);
  if (typeof c === "number") return c > 20000 && c < 80000 ? isoDate(excelSerialToDate(c)) : null;
  const s = String(c).trim().toLowerCase();
  if (/^(now|immediately|asap|available|od zaraz|od teraz|zaraz|teraz|dostępne|dostepne)$/.test(s)) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`; // day first, as in Poland and the UK
  const n = parseNumber(s);
  if (n != null && n > 20000 && n < 80000 && /^\d+$/.test(s)) return isoDate(excelSerialToDate(n));
  return null;
}

// ── Recipes ──

/** Where one listing field comes from. Column references are letters (A, B, AA). */
export type FieldSource =
  | { column: string; map?: string; transform?: "title_case" }
  | { template: string }
  | { value: string | number | null };

export type FeatureRule =
  /** Add `feature` when the column's value is one of `when` (case-insensitive), e.g. BALCONY = YES -> "balcony". */
  | { column: string; when: string[]; feature: string }
  /** Add the column's own text, split on "/" "," ";" "|", e.g. "garden / parking". */
  | { column: string; split: true };

export type Recipe = {
  fields: Partial<Record<ListingField, FieldSource>>;
  /** Named value maps used by fields ({column, map}) and templates ({B:map}). Keys match case-insensitively. */
  maps?: Record<string, Record<string, string | number | null>>;
  features?: FeatureRule[];
  /** Rows to leave out, e.g. where the address is empty. */
  skip_rows_where?: { column: string; is_empty?: boolean; equals?: string[] }[];
  /** Columns deliberately not used, with a short reason (shown to the user). */
  ignored?: { column: string; reason: string }[];
  /** Assumptions in plain words (shown to the user). */
  notes?: string[];
  /** "auto" = header matching, "ai" = planned by Claude. */
  source?: "auto" | "ai";
};

const keyOf = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function lookup(map: Record<string, string | number | null> | undefined, raw: string): string | number | null | undefined {
  if (!map) return undefined;
  const k = keyOf(raw);
  for (const [mk, mv] of Object.entries(map)) {
    if (keyOf(mk) === k) return mv;
  }
  if ("*" in map) return map["*"];
  return undefined;
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/(])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
}

function letterIndex(table: Table): Map<string, number> {
  return new Map(table.columns.map((c) => [c.letter, c.index]));
}

/**
 * Fills a template. {B} = column B's text; {B:mapname} = column B through a
 * map. [[ ... ]] = optional part, dropped when any placeholder inside it is
 * empty, e.g. "[[Shared flat with {K} rooms. ]]".
 */
export function fillTemplate(
  template: string,
  row: Cell[],
  letters: Map<string, number>,
  maps: Recipe["maps"] = {}
): string {
  const one = (part: string): { text: string; missing: boolean } => {
    let missing = false;
    const text = part.replace(/\{([A-Z]{1,3})(?::([\w-]+))?\}/g, (_m, letter: string, mapName?: string) => {
      const idx = letters.get(letter);
      const raw = idx === undefined ? "" : cellText(row[idx]);
      let out = raw;
      if (raw && mapName) {
        const mapped = lookup(maps?.[mapName], raw);
        out = mapped === undefined ? raw : mapped == null ? "" : String(mapped);
      }
      if (!out) missing = true;
      return out;
    });
    return { text, missing };
  };
  const withOptional = template.replace(/\[\[([\s\S]*?)\]\]/g, (_m, inner: string) => {
    const r = one(inner);
    return r.missing ? "" : r.text;
  });
  return one(withOptional).text.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
}

/** Problems that make a recipe unusable for this table (bad letters, unknown maps). */
export function checkRecipe(recipe: Recipe, table: Table): string[] {
  const problems: string[] = [];
  const letters = letterIndex(table);
  const maps = recipe.maps ?? {};
  const checkLetter = (l: string, where: string) => {
    if (!letters.has(l)) problems.push(`${where} uses column ${l}, which isn't in the file`);
  };
  for (const [field, src] of Object.entries(recipe.fields ?? {})) {
    if (!(LISTING_FIELDS as readonly string[]).includes(field)) problems.push(`Unknown field ${field}`);
    if (!src) continue;
    if ("column" in src) {
      checkLetter(src.column, field);
      if (src.map && !maps[src.map]) problems.push(`${field} uses a map called ${src.map} that isn't defined`);
    }
    if ("template" in src) {
      for (const m of src.template.matchAll(/\{([A-Z]{1,3})(?::([\w-]+))?\}/g)) {
        checkLetter(m[1], field);
        if (m[2] && !maps[m[2]]) problems.push(`${field} uses a map called ${m[2]} that isn't defined`);
      }
    }
  }
  if (!recipe.fields?.title) problems.push("No title");
  (recipe.features ?? []).forEach((f) => checkLetter(f.column, "features"));
  (recipe.skip_rows_where ?? []).forEach((s) => checkLetter(s.column, "skip rule"));
  return problems;
}

/** Applies a recipe to every row. */
export function applyRecipe(table: Table, recipe: Recipe): { line: number; listing: ListingDraft | null; errors: string[] }[] {
  const letters = letterIndex(table);
  const maps = recipe.maps ?? {};
  const out: { line: number; listing: ListingDraft | null; errors: string[] }[] = [];

  table.rows.forEach((row, i) => {
    const line = table.headerRow + 2 + i; // approximate spreadsheet row number, for messages
    const cellAt = (letter: string): Cell => {
      const idx = letters.get(letter);
      return idx === undefined ? null : row[idx];
    };

    for (const rule of recipe.skip_rows_where ?? []) {
      const v = cellText(cellAt(rule.column));
      if (rule.is_empty && !v) return;
      if (rule.equals && rule.equals.some((e) => keyOf(e) === keyOf(v))) return;
    }

    const raw: Partial<Record<ListingField, Cell>> = {};
    for (const field of LISTING_FIELDS) {
      const src = recipe.fields[field];
      if (!src) continue;
      if ("value" in src) raw[field] = src.value;
      else if ("template" in src) raw[field] = fillTemplate(src.template, row, letters, maps) || null;
      else {
        let v: Cell = cellAt(src.column);
        if (src.map && !isBlank(v)) {
          const mapped = lookup(maps[src.map], cellText(v));
          if (mapped !== undefined) v = mapped;
        }
        if (src.transform === "title_case" && typeof v === "string") v = titleCase(v);
        raw[field] = v;
      }
    }

    const features: string[] = [];
    for (const rule of recipe.features ?? []) {
      const v = cellText(cellAt(rule.column));
      if (!v) continue;
      if ("when" in rule) {
        if (rule.when.some((w) => keyOf(w) === keyOf(v))) features.push(rule.feature);
      } else {
        v.split(/[/,;|]/)
          .map((s) => s.trim())
          .filter(Boolean)
          // "METRO ARSENAŁ" -> "Metro Arsenał"; "balcony" stays as written.
          .forEach((s) => features.push(s === s.toUpperCase() && /\p{Ll}/u.test(s.toLowerCase()) && s.length > 3 ? titleCase(s) : s));
      }
    }

    const { listing, errors } = normalizeListing(raw, features);
    out.push({ line, listing, errors });
  });
  return out;
}

// ── Cleaning one listing ──

const STATUS_SYNONYMS: Record<string, ListingStatus> = {
  active: "available", forsale: "available", "for sale": "available", free: "available", vacant: "available",
  dostepne: "available", dostępne: "available", aktywna: "available", aktywne: "available", wolne: "available", wolny: "available",
  "under offer": "under_offer", underoffer: "under_offer", reserved: "under_offer", rezerwacja: "under_offer", zarezerwowane: "under_offer",
  sprzedane: "sold", wynajete: "let", wynajęte: "let", rented: "let", taken: "let", occupied: "let", zajęte: "let", zajete: "let",
  wycofane: "withdrawn", inactive: "withdrawn",
};
const TRANSACTION_SYNONYMS: Record<string, TransactionType> = {
  buy: "sale", sell: "sale", "for sale": "sale", forsale: "sale", sprzedaz: "sale", sprzedaż: "sale",
  rental: "rent", letting: "rent", "for rent": "rent", forrent: "rent", "to let": "rent", tolet: "rent", wynajem: "rent", najem: "rent", lease: "rent",
};
const PROPERTY_SYNONYMS: Record<string, PropertyType> = {
  flat: "apartment", mieszkanie: "apartment", apartament: "apartment", studio: "apartment", kawalerka: "apartment",
  dom: "house", bungalow: "house", detached: "house", "semi-detached": "house", townhouse: "house", segment: "house",
  land: "plot", dzialka: "plot", działka: "plot",
  office: "commercial", shop: "commercial", lokal: "commercial", "lokal użytkowy": "commercial", biuro: "commercial",
  pokoj: "room", pokój: "room", "single room": "room", "double room": "room", single: "room", double: "room",
};

function pickEnum<T extends string>(raw: Cell, allowed: readonly T[], synonyms: Record<string, T>): T | null {
  const k = keyOf(cellText(raw)).replace(/_/g, " ");
  if (!k) return null;
  const direct = k.replace(/ /g, "_");
  if ((allowed as readonly string[]).includes(direct)) return direct as T;
  return synonyms[k] ?? synonyms[k.replace(/ /g, "")] ?? null;
}

const str = (c: Cell) => cellText(c) || null;

/** Validates and cleans one listing, from any source (recipe, AI extraction, CSV). */
export function normalizeListing(
  raw: Partial<Record<ListingField, Cell>>,
  features: string[] = []
): { listing: ListingDraft | null; errors: string[] } {
  const errors: string[] = [];
  const title = cellText(raw.title).slice(0, 200);
  if (!title) errors.push("Missing title");

  const status = isBlank(raw.status) ? "available" : pickEnum(raw.status, LISTING_STATUSES, STATUS_SYNONYMS);
  if (!status) errors.push(`Unknown status "${cellText(raw.status)}"`);
  const transaction_type = isBlank(raw.transaction_type) ? "sale" : pickEnum(raw.transaction_type, TRANSACTION_TYPES, TRANSACTION_SYNONYMS);
  if (!transaction_type) errors.push(`Unknown sale/rent value "${cellText(raw.transaction_type)}"`);
  const property_type = isBlank(raw.property_type)
    ? "apartment"
    : pickEnum(raw.property_type, PROPERTY_TYPES, PROPERTY_SYNONYMS) ?? "other";

  const num = (f: ListingField, label: string, integer = false): number | null => {
    const v = raw[f];
    if (isBlank(v)) return null;
    const n = typeof v === "number" ? v : parseNumber(cellText(v));
    if (n == null || !Number.isFinite(n)) {
      errors.push(`${label} "${cellText(v)}" is not a number`);
      return null;
    }
    return integer ? Math.round(n) : n;
  };

  const availableRaw = raw.available_from;
  const available_from = parseDate(availableRaw ?? null);
  if (!isBlank(availableRaw) && available_from == null && !/^(now|immediately|asap|available|od zaraz|od teraz|zaraz|teraz|dostępne|dostepne)$/i.test(cellText(availableRaw))) {
    errors.push(`Available-from "${cellText(availableRaw)}" is not a date`);
  }

  const currencyRaw = (cellText(raw.currency) || "PLN").toUpperCase();
  const currency = /^(ZŁ|ZL|PLN)$/.test(currencyRaw) ? "PLN" : currencyRaw === "€" ? "EUR" : currencyRaw.slice(0, 3);

  const listing: ListingDraft = {
    reference: str(raw.reference)?.slice(0, 120) ?? null,
    title,
    status: status ?? "available",
    transaction_type: transaction_type ?? "sale",
    property_type,
    price: num("price", "Price"),
    currency,
    city: str(raw.city),
    district: str(raw.district),
    address: str(raw.address),
    area_m2: num("area_m2", "Area"),
    rooms: num("rooms", "Rooms", true),
    bedrooms: num("bedrooms", "Bedrooms", true),
    bathrooms: num("bathrooms", "Bathrooms", true),
    floor: num("floor", "Floor", true),
    description: str(raw.description)?.slice(0, 4000) ?? null,
    features: Array.from(new Set(features.map((f) => f.trim()).filter(Boolean))),
    url: str(raw.url),
    image_url: str(raw.image_url),
    available_from,
  };
  return { listing: errors.length ? null : listing, errors };
}

// ── Header matching (no AI) ──

/** A recipe from column names alone. Good for files that already look like Elliot's template. */
export function autoRecipe(table: Table): Recipe {
  const map = mapHeaders(table.columns.map((c) => c.header));
  const byIndex = (i: number | undefined) => (i === undefined ? undefined : table.columns.find((c) => c.index === i)?.letter);
  const fields: Recipe["fields"] = {};
  for (const [field, idx] of Object.entries(map)) {
    const letter = byIndex(idx);
    if (!letter || field === "features") continue;
    fields[field as ListingField] = { column: letter };
  }
  const available = table.columns.find((c) => /available|dostępn|dostepn|wolne od|from date|data dostępności/i.test(c.header));
  if (available && !fields.available_from) fields.available_from = { column: available.letter };
  const featuresLetter = byIndex(map.features);
  return {
    fields,
    features: featuresLetter ? [{ column: featuresLetter, split: true }] : [],
    source: "auto",
  };
}

/** Is a header-matched recipe good enough, or should Claude plan one? */
export function autoRecipeIsGood(recipe: Recipe): boolean {
  const f = recipe.fields;
  return Boolean(f.title && (f.price || f.district || f.city || f.address));
}

/** Plain-words summary of a recipe for the person importing. */
export function explainRecipe(recipe: Recipe, table: Table): { field: string; from: string }[] {
  const name = (l: string) => {
    const c = table.columns.find((x) => x.letter === l);
    return c?.header ? `“${c.header}”` : `column ${l}`;
  };
  const describe = (src: FieldSource): string => {
    if ("value" in src) return src.value == null ? "left empty" : `always “${src.value}”`;
    if ("column" in src) return `${name(src.column)}${src.map ? " (translated)" : ""}`;
    const cols = Array.from(new Set(Array.from(src.template.matchAll(/\{([A-Z]{1,3})/g)).map((m) => name(m[1]))));
    return cols.length ? `built from ${cols.join(", ")}` : `“${src.template}”`;
  };
  const LABEL: Record<ListingField, string> = {
    reference: "Reference", title: "Title", status: "Status", transaction_type: "Sale or rent", property_type: "Type",
    price: "Price", currency: "Currency", city: "City", district: "District", address: "Address", area_m2: "Area (m²)",
    rooms: "Rooms", bedrooms: "Bedrooms", bathrooms: "Bathrooms", floor: "Floor", description: "Description",
    url: "Link", image_url: "Photo", available_from: "Available from",
  };
  const rows = LISTING_FIELDS.filter((f) => recipe.fields[f]).map((f) => ({ field: LABEL[f], from: describe(recipe.fields[f]!) }));
  if (recipe.features?.length) {
    rows.push({
      field: "Features",
      from: recipe.features.map((r) => ("when" in r ? `“${r.feature}” when ${name(r.column)} is ${r.when.join("/")}` : name(r.column))).join("; "),
    });
  }
  return rows;
}

// ── Long text for AI extraction ──

/** Splits text into pieces of at most `max` characters, at paragraph or line breaks. */
export function chunkText(text: string, max = 6000): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let current = "";
  for (const para of clean.split(/\n\n/)) {
    const pieces = para.length > max ? para.split(/\n/) : [para];
    for (const piece of pieces) {
      const parts = piece.length > max ? piece.match(new RegExp(`[\\s\\S]{1,${max}}`, "g")) ?? [] : [piece];
      for (const p of parts) {
        if (current && current.length + p.length + 2 > max) {
          chunks.push(current);
          current = "";
        }
        current = current ? `${current}\n\n${p}` : p;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** CSV text -> listings, with header matching only (Elliot's template, or close to it). */
export function readCsvListings(text: string) {
  const table = gridToTable(parseCsv(text));
  const recipe = autoRecipe(table);
  return { table, recipe, rows: recipeIsUsable(recipe) ? applyRecipe(table, recipe) : [], missingTitle: !recipe.fields.title };
}

const recipeIsUsable = (r: Recipe) => Boolean(r.fields.title);
