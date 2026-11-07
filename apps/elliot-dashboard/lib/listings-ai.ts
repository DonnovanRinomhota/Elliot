// Prompts and tool schemas for the "read any file" listings import.
// Server-only (used by app/api/listings/*).
import { LISTING_FIELDS } from "./listings-import";

const FIELD_HELP = `Listing fields:
- reference: the agency's own id for the unit. Must be unique per row and the same every time the file is uploaded again. If there's no id column, combine address + flat/room number, e.g. "{G} / {H}".
- title: short, for clients, e.g. "Single room, Batorego 29" or "3-room flat with balcony, Mokotów".
- status: available | under_offer | sold | let | withdrawn.
- transaction_type: sale | rent.
- property_type: apartment | house | plot | commercial | room | other. A room in a shared flat is "room"; a studio is "apartment".
- price: what a client pays (asking price for a sale; monthly amount for rent). If there is a total including fees, use the total.
- currency: 3-letter code (zł = PLN).
- city, district, address.
- area_m2, rooms, bedrooms, bathrooms, floor: numbers.
- description: 1-3 short sentences a client would find useful. No internal information.
- url: link to the listing page or photos. image_url: direct link to one photo.
- available_from: first day it can be moved into, from an "available from" column. Not a contract end date.`;

export const PLAN_SYSTEM = `You are setting up a property listings import for Elliot, an assistant that answers estate agencies' website visitors. You are shown one spreadsheet: its columns (by letter, with header and example values) and some sample rows. Return a recipe that turns every row into a listing. Code applies your recipe to all rows, so it must work for rows you haven't seen.

${FIELD_HELP}

How a recipe works:
- fields.<name> is exactly ONE of:
  {"column": "N"}  take column N's value
  {"column": "L", "map": "type_kind"}  translate the value through maps.type_kind (keys match case-insensitively; "*" = anything else)
  {"column": "W", "transform": "title_case"}  e.g. MOKOTÓW -> Mokotów (can be combined with map)
  {"template": "{L:type_label}, {G}"}  text from columns; {X} = column X, {X:map} = column X through a map; [[ ... ]] = optional part, dropped if any column in it is empty
  {"value": "rent"}  same for every row (only when the whole file clearly implies it, e.g. all rentals, all in one city; say so in notes)
- maps: name -> {raw value -> output}. For codes and typos, map every distinct value you can see in the examples.
- features: [{"column": "M", "when": ["YES"], "feature": "balcony"}] or [{"column": "X", "split": true}] (splits "garden / parking").
- skip_rows_where: [{"column": "G", "is_empty": true}] for rows that aren't listings (no address/title).
- ignored: every column you don't use, with a short reason.
- notes: 1-4 short, plain sentences for the agency about assumptions you made.

Rules:
- Only information a client may see. Ignore internal columns: staff/caretaker names, owner or landlord details, payouts and rent splits, commissions, contract end dates, internal counters and totals. Never put personal data about tenants or landlords anywhere.
- Use column letters exactly as given. Don't invent columns.
- Prefer a template for title and reference so every row gets one.`;

export const RECIPE_TOOL = {
  name: "save_import_recipe",
  description: "Save the recipe that maps the spreadsheet's columns onto listing fields.",
  input_schema: {
    type: "object",
    properties: {
      fields: {
        type: "object",
        description: "Field name -> source. Each source has exactly one of column, template or value.",
        properties: Object.fromEntries(
          LISTING_FIELDS.map((f) => [
            f,
            {
              type: "object",
              properties: {
                column: { type: "string" },
                map: { type: "string" },
                transform: { type: "string", enum: ["title_case"] },
                template: { type: "string" },
                value: { type: ["string", "number", "null"] },
              },
            },
          ])
        ),
        required: ["title"],
      },
      maps: { type: "object", additionalProperties: { type: "object", additionalProperties: { type: ["string", "number", "null"] } } },
      features: {
        type: "array",
        items: {
          type: "object",
          properties: {
            column: { type: "string" },
            when: { type: "array", items: { type: "string" } },
            feature: { type: "string" },
            split: { type: "boolean" },
          },
          required: ["column"],
        },
      },
      skip_rows_where: {
        type: "array",
        items: {
          type: "object",
          properties: { column: { type: "string" }, is_empty: { type: "boolean" }, equals: { type: "array", items: { type: "string" } } },
          required: ["column"],
        },
      },
      ignored: {
        type: "array",
        items: { type: "object", properties: { column: { type: "string" }, reason: { type: "string" } }, required: ["column", "reason"] },
      },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["fields", "ignored", "notes"],
  },
};

export const EXTRACT_SYSTEM = `You read documents from estate agencies (brochures, price lists, exported listing pages, emails) and pull out every property listing in them for Elliot, an assistant that answers the agency's website visitors.

${FIELD_HELP}

Rules:
- Only listings actually in the text. Never invent a property, price or address. If a value isn't stated, leave it out.
- One listing per unit offered (each room, flat or house).
- status is "available" unless the text says sold, let/rented, reserved or withdrawn.
- transaction_type is "rent" when the price is per month or the text says rent/wynajem; otherwise "sale".
- Prices and areas as plain numbers (no currency or units).
- Dates as YYYY-MM-DD.
- Only information a client may see: leave out owner/landlord names and contacts, commissions and internal notes.
- The text may be one part of a longer document. A listing cut off at the start or end of this part: include what's there.
- If there are no listings, return an empty list.`;

export const EXTRACT_TOOL = {
  name: "save_listings",
  description: "Save the listings found in this part of the document.",
  input_schema: {
    type: "object",
    properties: {
      listings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            reference: { type: "string" },
            title: { type: "string" },
            status: { type: "string", enum: ["available", "under_offer", "sold", "let", "withdrawn"] },
            transaction_type: { type: "string", enum: ["sale", "rent"] },
            property_type: { type: "string", enum: ["apartment", "house", "plot", "commercial", "room", "other"] },
            price: { type: "number" },
            currency: { type: "string" },
            city: { type: "string" },
            district: { type: "string" },
            address: { type: "string" },
            area_m2: { type: "number" },
            rooms: { type: "integer" },
            bedrooms: { type: "integer" },
            bathrooms: { type: "integer" },
            floor: { type: "integer" },
            description: { type: "string" },
            features: { type: "array", items: { type: "string" } },
            url: { type: "string" },
            image_url: { type: "string" },
            available_from: { type: "string", description: "YYYY-MM-DD" },
          },
          required: ["title"],
        },
      },
    },
    required: ["listings"],
  },
};

/** Drops empty or malformed parts of a recipe returned by the model. */
export function cleanRecipe(raw: any): any {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries<any>(raw?.fields ?? {})) {
    if (!v || typeof v !== "object") continue;
    if (typeof v.template === "string" && v.template.trim()) fields[k] = { template: v.template };
    else if (typeof v.column === "string" && v.column.trim())
      fields[k] = {
        column: v.column.trim().toUpperCase(),
        ...(v.map ? { map: String(v.map) } : {}),
        ...(v.transform === "title_case" ? { transform: "title_case" } : {}),
      };
    else if ("value" in v && (typeof v.value === "string" || typeof v.value === "number" || v.value === null)) fields[k] = { value: v.value };
  }
  const features = (raw?.features ?? [])
    .filter((f: any) => f && typeof f.column === "string")
    .map((f: any) =>
      Array.isArray(f.when) && f.feature
        ? { column: f.column.toUpperCase(), when: f.when.map(String), feature: String(f.feature) }
        : { column: f.column.toUpperCase(), split: true }
    );
  return {
    fields,
    maps: raw?.maps && typeof raw.maps === "object" ? raw.maps : {},
    features,
    skip_rows_where: (raw?.skip_rows_where ?? []).filter((s: any) => s && typeof s.column === "string").map((s: any) => ({ ...s, column: s.column.toUpperCase() })),
    ignored: (raw?.ignored ?? []).filter((s: any) => s && typeof s.column === "string"),
    notes: (raw?.notes ?? []).filter((n: any) => typeof n === "string").slice(0, 6),
    source: "ai",
  };
}
