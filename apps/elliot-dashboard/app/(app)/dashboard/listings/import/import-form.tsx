"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CSV_TEMPLATE, formatPrice, parseListingsCsv, type ParsedRow } from "@/lib/listings";
import { ErrorText, Notice, Panel, btn } from "../../../../_ui/ui";

export default function ImportForm() {
  const router = useRouter();
  const supabase = createClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [missingTitle, setMissingTitle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ inserted: number; updated: number } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    setDone(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("That file is over 5 MB. Split it into smaller files.");
      return;
    }
    const text = await file.text();
    const parsed = parseListingsCsv(text);
    setFileName(file.name);
    setRows(parsed.rows);
    setMissingTitle(parsed.missingTitle);
  }

  const good = (rows ?? []).filter((r) => r.listing);
  const bad = (rows ?? []).filter((r) => !r.listing);

  async function importNow() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("import_listings", { p_rows: good.map((r) => r.listing) });
    setBusy(false);
    if (e) return setError(e.message);
    setDone(data as { inserted: number; updated: number });
    setRows(null);
    router.refresh();
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "elliot-listings-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="grid max-w-4xl gap-6">
      <Panel title="1. Choose a file">
        <div className="grid gap-3 text-[13px] text-gray-600">
          <p className="m-0">
            One row per property. The only required column is a <strong className="font-medium text-ink">title</strong>. Elliot also
            understands reference, status, transaction (sale/rent), property type, price, currency, city, district, address, area_m2,
            rooms, bedrooms, bathrooms, floor, features, url and description. Polish column names work too (tytuł, cena, miasto,
            dzielnica, powierzchnia, pokoje…).
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className={btn.primary + " cursor-pointer"}>
              Choose CSV file
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" />
            </label>
            <button type="button" onClick={downloadTemplate} className={btn.ghost}>
              Download a template
            </button>
            {fileName && <span className="text-gray-500">{fileName}</span>}
          </div>
          <p className="m-0 text-[12.5px] text-gray-500">From Excel or Google Sheets: File → Save as / Download → CSV.</p>
        </div>
      </Panel>

      {error && <ErrorText>{error}</ErrorText>}
      {done && (
        <Notice>
          Done: {done.inserted} added and {done.updated} updated.{" "}
          <a href="/dashboard/listings" className="text-ink underline">See your listings</a>
        </Notice>
      )}

      {rows && (
        <Panel
          title={`2. Check and import`}
          action={
            <button type="button" onClick={importNow} disabled={busy || good.length === 0 || missingTitle} className={btn.primary}>
              {busy ? "Importing…" : `Import ${good.length} listing${good.length === 1 ? "" : "s"}`}
            </button>
          }
          flush
        >
          {missingTitle ? (
            <p className="m-0 px-5 py-4 text-[13px] text-alert">
              No title column found. Add a column called &ldquo;title&rdquo; (or &ldquo;tytuł&rdquo;) and choose the file again.
            </p>
          ) : (
            <>
              {bad.length > 0 && (
                <div className="border-b border-gray-200 px-5 py-3">
                  <p className="m-0 text-[13px] font-medium text-alert">
                    {bad.length} row{bad.length === 1 ? "" : "s"} will be skipped:
                  </p>
                  <ul className="m-0 mt-1 list-none p-0 text-[12.5px] text-gray-600">
                    {bad.slice(0, 20).map((r) => (
                      <li key={r.line}>
                        Line {r.line}: {r.errors.join("; ")}
                      </li>
                    ))}
                    {bad.length > 20 && <li>…and {bad.length - 20} more</li>}
                  </ul>
                </div>
              )}
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-gray-200 text-[12px] text-gray-500">
                      <th className="px-5 py-2 font-medium">Line</th>
                      <th className="px-3 py-2 font-medium">Title</th>
                      <th className="px-3 py-2 font-medium">Ref</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Location</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {good.slice(0, 200).map(({ line, listing: l }) => (
                      <tr key={line} className="border-b border-gray-100">
                        <td className="tabular px-5 py-2 text-gray-500">{line}</td>
                        <td className="px-3 py-2 text-ink">{l!.title}</td>
                        <td className="px-3 py-2 text-gray-600">{l!.reference || "–"}</td>
                        <td className="tabular whitespace-nowrap px-3 py-2">{formatPrice(l!.price, l!.currency, l!.transaction_type)}</td>
                        <td className="px-3 py-2 text-gray-600">{[l!.district, l!.city].filter(Boolean).join(", ") || "–"}</td>
                        <td className="px-3 py-2 text-gray-600">{l!.status.replace("_", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {good.length > 200 && <p className="m-0 px-5 py-2 text-[12.5px] text-gray-500">Showing the first 200 of {good.length}.</p>}
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
