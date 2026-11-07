"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LISTING_STATUSES,
  PROPERTY_LABEL,
  PROPERTY_TYPES,
  STATUS_LABEL,
  TRANSACTION_LABEL,
  TRANSACTION_TYPES,
  parseNumber,
} from "@/lib/listings";
import { ErrorText, Panel, btn } from "../../../_ui/ui";

type Listing = Record<string, any>;

const FIELDS_TEXT = ["reference", "title", "currency", "city", "district", "address", "description", "url", "image_url"] as const;
const FIELDS_NUM = ["price", "area_m2", "rooms", "bedrooms", "bathrooms", "floor"] as const;

export default function ListingForm({ tenantId, listing }: { tenantId: string; listing?: Listing }) {
  const router = useRouter();
  const supabase = createClient();
  const init = (k: string, fallback = "") => (listing?.[k] == null ? fallback : String(listing[k]));
  const [f, setF] = useState<Record<string, string>>({
    reference: init("reference"),
    title: init("title"),
    status: init("status", "available"),
    transaction_type: init("transaction_type", "sale"),
    property_type: init("property_type", "apartment"),
    price: init("price"),
    currency: init("currency", "PLN"),
    city: init("city"),
    district: init("district"),
    address: init("address"),
    area_m2: init("area_m2"),
    rooms: init("rooms"),
    bedrooms: init("bedrooms"),
    bathrooms: init("bathrooms"),
    floor: init("floor"),
    description: init("description"),
    features: (listing?.features ?? []).join(", "),
    url: init("url"),
    image_url: init("image_url"),
    available_from: init("available_from"),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setError(null);
    if (!f.title.trim()) return setError("Give the listing a title.");
    const row: Record<string, any> = {
      status: f.status,
      transaction_type: f.transaction_type,
      property_type: f.property_type,
      features: f.features.split(",").map((s) => s.trim()).filter(Boolean),
    };
    for (const k of FIELDS_TEXT) row[k] = f[k].trim() || null;
    row.currency = (row.currency || "PLN").toUpperCase();
    row.available_from = f.available_from || null;
    for (const k of FIELDS_NUM) {
      if (!f[k].trim()) {
        row[k] = null;
        continue;
      }
      const n = parseNumber(f[k]);
      if (n == null) return setError(`"${f[k]}" is not a number.`);
      row[k] = ["rooms", "bedrooms", "bathrooms", "floor"].includes(k) ? Math.round(n) : n;
    }

    setBusy(true);
    const { error: e } = listing
      ? await supabase.from("listings").update(row).eq("id", listing.id)
      : await supabase.from("listings").insert({ ...row, tenant_id: tenantId });
    setBusy(false);
    if (e) {
      setError(e.code === "23505" ? "Another listing already uses this reference." : e.message);
      return;
    }
    router.push("/dashboard/listings");
    router.refresh();
  }

  async function remove() {
    if (!listing || !window.confirm(`Delete "${listing.title}"? If it's sold or let, consider changing the status instead so you keep the record.`)) return;
    setBusy(true);
    const { error: e } = await supabase.from("listings").delete().eq("id", listing.id);
    setBusy(false);
    if (e) return setError(e.message);
    router.push("/dashboard/listings");
    router.refresh();
  }

  const label = "mb-1 block text-[12.5px] font-medium text-gray-600";
  const input = (k: string, l: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className={label} htmlFor={`f-${k}`}>{l}</label>
      <input id={`f-${k}`} value={f[k]} onChange={set(k)} className="h-9 w-full px-3" {...props} />
    </div>
  );

  return (
    <div className="grid max-w-3xl gap-6">
      <Panel title="The property">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{input("title", "Title", { placeholder: "2-room flat with balcony, Mokotów" })}</div>
          {input("reference", "Your reference", { placeholder: "e.g. W-101" })}
          <div>
            <label className={label} htmlFor="f-status">Status</label>
            <select id="f-status" value={f.status} onChange={set("status")} className="h-9 w-full px-3">
              {LISTING_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="f-tx">Sale or rent</label>
            <select id="f-tx" value={f.transaction_type} onChange={set("transaction_type")} className="h-9 w-full px-3">
              {TRANSACTION_TYPES.map((s) => (
                <option key={s} value={s}>{TRANSACTION_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="f-pt">Type</label>
            <select id="f-pt" value={f.property_type} onChange={set("property_type")} className="h-9 w-full px-3">
              {PROPERTY_TYPES.map((s) => (
                <option key={s} value={s}>{PROPERTY_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-[1fr_96px] gap-2">
            {input("price", f.transaction_type === "rent" ? "Rent per month" : "Price", { inputMode: "decimal" })}
            {input("currency", "Currency")}
          </div>
          {input("area_m2", "Area (m²)", { inputMode: "decimal" })}
          {input("rooms", "Rooms", { inputMode: "numeric" })}
          {input("bedrooms", "Bedrooms", { inputMode: "numeric" })}
          {input("bathrooms", "Bathrooms", { inputMode: "numeric" })}
          {input("floor", "Floor", { inputMode: "numeric" })}
          <div>
            {input("available_from", "Available from", { type: "date" })}
            <p className="mb-0 mt-1 text-[12px] text-gray-500">Leave empty if it&apos;s available now.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Location">
        <div className="grid gap-4 sm:grid-cols-2">
          {input("city", "City")}
          {input("district", "District")}
          <div className="sm:col-span-2">{input("address", "Address", { placeholder: "Shown to clients only if Elliot is told to share it" })}</div>
        </div>
      </Panel>

      <Panel title="What Elliot tells clients">
        <div className="grid gap-4">
          <div>
            <label className={label} htmlFor="f-description">Description</label>
            <textarea id="f-description" rows={5} value={f.description} onChange={set("description")} className="w-full p-3 leading-relaxed" />
          </div>
          {input("features", "Features (comma-separated)", { placeholder: "balcony, lift, parking, garden" })}
          {input("url", "Link to the listing page", { type: "url", placeholder: "https://" })}
          {input("image_url", "Photo link (optional)", { type: "url", placeholder: "https://" })}
        </div>
      </Panel>

      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={busy} className={btn.primary}>
            {busy ? "Saving…" : listing ? "Save changes" : "Add listing"}
          </button>
          <a href="/dashboard/listings" className={btn.ghost}>Cancel</a>
        </div>
        {listing && (
          <button type="button" onClick={remove} disabled={busy} className={btn.dangerGhost}>
            Delete listing
          </button>
        )}
      </div>
    </div>
  );
}
