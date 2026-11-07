// Listing fields, labels and CSV import parsing. Pure functions, unit tested
// in lib/listings.test.ts.

export const LISTING_STATUSES = ["available", "under_offer", "sold", "let", "withdrawn"] as const;
export const TRANSACTION_TYPES = ["sale", "rent"] as const;
export const PROPERTY_TYPES = ["apartment", "house", "plot", "commercial", "room", "other"] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const STATUS_LABEL: Record<ListingStatus, string> = {
  available: "Available",
  under_offer: "Under offer",
  sold: "Sold",
  let: "Let",
  withdrawn: "Withdrawn",
};
export const TRANSACTION_LABEL: Record<TransactionType, string> = { sale: "For sale", rent: "For rent" };
export const PROPERTY_LABEL: Record<PropertyType, string> = {
  apartment: "Apartment",
  house: "House",
  plot: "Plot",
  commercial: "Commercial",
  room: "Room",
  other: "Other",
};

export type ListingInput = {
  reference: string | null;
  title: string;
  status: ListingStatus;
  transaction_type: TransactionType;
  property_type: PropertyType;
  price: number | null;
  currency: string;
  city: string | null;
  district: string | null;
  address: string | null;
  area_m2: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  description: string | null;
  features: string[];
  url: string | null;
  image_url: string | null;
};

export function formatPrice(price: number | string | null, currency: string, transaction: string): string {
  if (price == null || price === "") return "Price on request";
  const n = Number(price);
  const s = `${n.toLocaleString("en-GB", { maximumFractionDigits: 0 }).replace(/,/g, " ")} ${currency}`;
  return transaction === "rent" ? `${s} / month` : s;
}

// ── CSV ──

/** RFC 4180-ish CSV: quoted fields, "" escapes, commas or semicolons. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  // Polish Excel exports use semicolons.
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Header names we accept for each field (English and Polish), compared
// lower-case with spaces/underscores/dashes removed.
const HEADER_ALIASES: Record<keyof ListingInput, string[]> = {
  reference: ["reference", "ref", "id", "listingid", "numer", "nroferty", "numeroferty", "sygnatura"],
  title: ["title", "name", "tytul", "tytuł", "nazwa"],
  status: ["status"],
  transaction_type: ["transaction", "transactiontype", "type", "saleorrent", "transakcja", "rodzajtransakcji"],
  property_type: ["propertytype", "kind", "category", "rodzaj", "typ", "typnieruchomosci", "rodzajnieruchomosci"],
  price: ["price", "cena"],
  currency: ["currency", "waluta"],
  city: ["city", "town", "miasto", "miejscowosc", "miejscowość"],
  district: ["district", "area", "neighbourhood", "neighborhood", "dzielnica"],
  address: ["address", "street", "adres", "ulica"],
  area_m2: ["aream2", "size", "sizem2", "sqm", "m2", "powierzchnia", "metraz", "metraż"],
  rooms: ["rooms", "pokoje", "liczbapokoi"],
  bedrooms: ["bedrooms", "sypialnie"],
  bathrooms: ["bathrooms", "lazienki", "łazienki"],
  floor: ["floor", "pietro", "piętro"],
  description: ["description", "opis"],
  features: ["features", "amenities", "udogodnienia", "cechy"],
  url: ["url", "link", "website"],
  image_url: ["imageurl", "image", "photo", "zdjecie", "zdjęcie"],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.()]/g, "");

export function mapHeaders(headers: string[]): Partial<Record<keyof ListingInput, number>> {
  const map: Partial<Record<keyof ListingInput, number>> = {};
  headers.forEach((h, i) => {
    const key = norm(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof ListingInput, string[]][]) {
      if (map[field] === undefined && aliases.map(norm).includes(key)) {
        map[field] = i;
        return;
      }
    }
  });
  return map;
}

/** "1 250 000", "1.250.000,50", "1,250,000.50", "820000 zł" -> number. */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[^\d.,\-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1,250,000" is thousands; "48,5" is a decimal.
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot > -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const pick = <T extends string>(raw: string, allowed: readonly T[], synonyms: Record<string, T>): T | null => {
  const k = norm(raw);
  if (!k) return null;
  if ((allowed as readonly string[]).includes(k)) return k as T;
  return synonyms[k] ?? null;
};

const STATUS_SYNONYMS: Record<string, ListingStatus> = {
  active: "available", forsale: "available", dostepne: "available", dostępne: "available", aktywna: "available", aktywne: "available",
  underoffer: "under_offer", reserved: "under_offer", rezerwacja: "under_offer", zarezerwowane: "under_offer",
  sprzedane: "sold", wynajete: "let", wynajęte: "let", rented: "let", wycofane: "withdrawn", inactive: "withdrawn",
};
const TRANSACTION_SYNONYMS: Record<string, TransactionType> = {
  buy: "sale", sell: "sale", forsale: "sale", sprzedaz: "sale", sprzedaż: "sale",
  rental: "rent", letting: "rent", forrent: "rent", tolet: "rent", wynajem: "rent", najem: "rent",
};
const PROPERTY_SYNONYMS: Record<string, PropertyType> = {
  flat: "apartment", mieszkanie: "apartment", apartament: "apartment",
  dom: "house", bungalow: "house", detached: "house", semidetached: "house",
  land: "plot", dzialka: "plot", działka: "plot",
  office: "commercial", shop: "commercial", lokal: "commercial", lokaluzytkowy: "commercial", biuro: "commercial",
  pokoj: "room", pokój: "room",
};

export type ParsedRow = { line: number; listing: ListingInput | null; errors: string[] };

export function parseListingsCsv(text: string): { rows: ParsedRow[]; missingTitle: boolean; mapped: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], missingTitle: true, mapped: [] };
  const map = mapHeaders(table[0]);
  const cell = (r: string[], f: keyof ListingInput) => {
    const i = map[f];
    return i === undefined ? "" : (r[i] ?? "").trim();
  };

  const rows: ParsedRow[] = table.slice(1).map((r, idx) => {
    const errors: string[] = [];
    const title = cell(r, "title");
    if (!title) errors.push("Missing title");

    const statusRaw = cell(r, "status");
    const status = statusRaw ? pick(statusRaw, LISTING_STATUSES, STATUS_SYNONYMS) : "available";
    if (!status) errors.push(`Unknown status "${statusRaw}"`);

    const txRaw = cell(r, "transaction_type");
    const transaction_type = txRaw ? pick(txRaw, TRANSACTION_TYPES, TRANSACTION_SYNONYMS) : "sale";
    if (!transaction_type) errors.push(`Unknown sale/rent value "${txRaw}"`);

    const ptRaw = cell(r, "property_type");
    const property_type = ptRaw ? pick(ptRaw, PROPERTY_TYPES, PROPERTY_SYNONYMS) ?? "other" : "apartment";

    const num = (f: keyof ListingInput, label: string, integer = false) => {
      const raw = cell(r, f);
      if (!raw) return null;
      const n = parseNumber(raw);
      if (n == null) {
        errors.push(`${label} "${raw}" is not a number`);
        return null;
      }
      return integer ? Math.round(n) : n;
    };

    const listing: ListingInput = {
      reference: cell(r, "reference") || null,
      title,
      status: status ?? "available",
      transaction_type: transaction_type ?? "sale",
      property_type,
      price: num("price", "Price"),
      currency: (cell(r, "currency") || "PLN").toUpperCase().replace("ZŁ", "PLN").replace("ZL", "PLN"),
      city: cell(r, "city") || null,
      district: cell(r, "district") || null,
      address: cell(r, "address") || null,
      area_m2: num("area_m2", "Area"),
      rooms: num("rooms", "Rooms", true),
      bedrooms: num("bedrooms", "Bedrooms", true),
      bathrooms: num("bathrooms", "Bathrooms", true),
      floor: num("floor", "Floor", true),
      description: cell(r, "description") || null,
      features: cell(r, "features")
        .split(/[|,;]/)
        .map((s) => s.trim())
        .filter(Boolean),
      url: cell(r, "url") || null,
      image_url: cell(r, "image_url") || null,
    };
    return { line: idx + 2, listing: errors.length ? null : listing, errors };
  });

  return { rows, missingTitle: map.title === undefined, mapped: Object.keys(map) };
}

export const CSV_TEMPLATE =
  "reference,title,status,transaction,property_type,price,currency,city,district,address,area_m2,rooms,bedrooms,bathrooms,floor,features,url,description\n" +
  'W-101,2-room flat with balcony,available,sale,apartment,820000,PLN,Warszawa,Mokotów,ul. Puławska 10,48,2,1,1,3,"balcony|lift",https://example.com/w-101,"Bright flat near the metro."\n';
