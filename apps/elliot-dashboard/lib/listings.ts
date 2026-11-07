// Listing fields, labels, CSV parsing and number parsing. Pure functions,
// unit tested in lib/listings.test.ts. Turning a file into listings lives in
// lib/listings-import.ts.

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

export const CSV_TEMPLATE =
  "reference,title,status,transaction,property_type,price,currency,city,district,address,area_m2,rooms,bedrooms,bathrooms,floor,available_from,features,url,description\n" +
  'W-101,2-room flat with balcony,available,sale,apartment,820000,PLN,Warszawa,Mokotów,ul. Puławska 10,48,2,1,1,3,,"balcony|lift",https://example.com/w-101,"Bright flat near the metro."\n' +
  'R-204,Single room in a shared flat,available,rent,room,1700,PLN,Warszawa,Mokotów,ul. Batorego 29,12,1,1,,2,2026-12-01,"balcony",https://example.com/r-204,"Room in a 4-room flat, 5 minutes from Pole Mokotowskie metro. Bills included."\n';
