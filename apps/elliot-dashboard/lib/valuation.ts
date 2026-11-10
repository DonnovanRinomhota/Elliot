// Sellers and landlords (0043): what Elliot recorded about the property they
// want valued, for the Leads page. Plain functions, shared with tests.

export type Valuation = {
  address?: string;
  city?: string;
  district?: string;
  property_type?: string;
  area_m2?: number | string;
  rooms?: number | string;
  floor?: string | number;
  year_built?: string | number;
  condition?: string;
  extras?: string;
  intent?: string;
  timeline?: string;
  within_3_months?: boolean;
  expected_price?: string;
  notes?: string;
  requested_at?: string;
};

const TYPE: Record<string, string> = { apartment: "Flat", house: "House", plot: "Plot", commercial: "Commercial", other: "Property" };

export function valuationOf(answers: Record<string, unknown> | null | undefined): Valuation | null {
  const v = answers?.valuation;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Valuation) : null;
}

/** "Seller" / "Landlord" for a lead that asked for a valuation, else null. */
export function sellerLabel(intent: string | null | undefined, answers: Record<string, unknown> | null | undefined): string | null {
  const v = valuationOf(answers);
  const i = intent || v?.intent;
  if (i === "let") return "Landlord";
  if (i === "sell" || v) return "Seller";
  return null;
}

export function valuationAddress(v: Valuation): string {
  return [v.address, v.district, v.city].map((x) => String(x ?? "").trim()).filter(Boolean).join(", ");
}

/** Label/value rows for the details panel, only what Elliot actually has. */
export function valuationRows(v: Valuation): [string, string][] {
  const rows: [string, string | null][] = [
    ["Wants to", v.intent === "let" ? "Let it" : "Sell it"],
    ["Address", valuationAddress(v) || null],
    ["Type", v.property_type ? TYPE[v.property_type] ?? v.property_type : null],
    ["Size", v.area_m2 != null && v.area_m2 !== "" ? `${v.area_m2} m²` : null],
    ["Rooms", v.rooms != null && v.rooms !== "" ? String(v.rooms) : null],
    ["Floor", v.floor != null && v.floor !== "" ? String(v.floor) : null],
    ["Built", v.year_built ? String(v.year_built) : null],
    ["Condition", v.condition || null],
    ["Extras", v.extras || null],
    ["When", v.timeline ? `${v.timeline}${v.within_3_months ? " (within 3 months)" : ""}` : v.within_3_months ? "Within 3 months" : null],
    ["Hopes for", v.expected_price || null],
    ["Notes", v.notes || null],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}
