"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CSV_TEMPLATE, STATUS_LABEL, formatPrice } from "@/lib/listings";
import {
  applyRecipe,
  autoRecipe,
  autoRecipeIsGood,
  checkRecipe,
  chunkText,
  describeTable,
  explainRecipe,
  gridToTable,
  normalizeListing,
  type ListingDraft,
  type Recipe,
  type Table,
} from "@/lib/listings-import";
import { ACCEPTED, readFileForImport } from "@/lib/file-text";
import { ErrorText, Notice, Panel, btn } from "../../../../_ui/ui";

type Row = { line: number; listing: ListingDraft | null; errors: string[] };
type Review = {
  source: string;
  how: "auto" | "ai-table" | "ai-text";
  table?: Table;
  recipe?: Recipe;
  sheet?: string | null;
  otherSheets?: string[];
  rows: Row[];
};

const MAX_ROWS = 3000;

export default function ImportForm() {
  const router = useRouter();
  const supabase = createClient();
  const [stage, setStage] = useState<"choose" | "reading" | "review" | "done">("choose");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [withdrawMissing, setWithdrawMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ inserted: number; updated: number; withdrawn: number } | null>(null);

  function fail(message: string) {
    setError(message);
    setStage("choose");
  }

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  async function planWithAi(table: Table, source: string, sheet: string | null, otherSheets: string[]) {
    setProgress("Elliot is working out what each column means…");
    const { recipe } = await post("/api/listings/plan", { file_name: source, sheet, table: describeTable(table) });
    const problems = checkRecipe(recipe, table);
    if (problems.length) throw new Error(`Elliot couldn't map this file (${problems[0]}). Try again, or use the template.`);
    setReview({ source, how: "ai-table", table, recipe, sheet, otherSheets, rows: applyRecipe(table, recipe) });
    setStage("review");
  }

  async function readText(text: string, source: string) {
    const chunks = chunkText(text, 6000);
    if (!chunks.length) throw new Error("There's no text to read.");
    if (chunks.length > 60) throw new Error("That document is very long. Split it into smaller files (up to about 150 pages each).");
    const found: unknown[][] = new Array(chunks.length);
    let next = 0;
    let finished = 0;
    setProgress(`Elliot is reading ${chunks.length === 1 ? "the document" : `part 1 of ${chunks.length}`}…`);
    const worker = async () => {
      while (next < chunks.length) {
        const i = next++;
        const data = await post("/api/listings/extract", { text: chunks[i], part: i + 1, parts: chunks.length, file_name: source });
        found[i] = data.listings;
        finished++;
        if (chunks.length > 1) setProgress(`Elliot is reading the document: ${finished} of ${chunks.length} parts done…`);
      }
    };
    await Promise.all([worker(), worker()]);

    // A listing split across two parts can come back twice: keep the fuller one.
    const seen = new Map<string, Row>();
    const rows: Row[] = [];
    found.flat().forEach((raw: any, i) => {
      const { listing, errors } = normalizeListing(raw ?? {}, Array.isArray(raw?.features) ? raw.features : []);
      const row: Row = { line: i + 1, listing, errors };
      if (listing) {
        const key = (listing.reference || `${listing.title}|${listing.price ?? ""}|${listing.address ?? ""}`).toLowerCase();
        const prev = seen.get(key);
        if (prev) {
          if (JSON.stringify(listing).length > JSON.stringify(prev.listing).length) prev.listing = listing;
          return;
        }
        seen.set(key, row);
      }
      rows.push(row);
    });
    setReview({ source, how: "ai-text", rows });
    setStage("review");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setDone(null);
    if (file.size > 15 * 1024 * 1024) return fail("That file is over 15 MB. Split it into smaller files.");
    setStage("reading");
    setProgress("Opening the file…");
    try {
      const read = await readFileForImport(file);
      if (read.kind === "text") return await readText(read.text, file.name);
      const table = gridToTable(read.grid);
      if (!table.rows.length) return fail("No rows found in this file.");
      if (table.rows.length > MAX_ROWS) return fail(`This file has ${table.rows.length} rows. Elliot imports up to ${MAX_ROWS} at a time; split the file.`);
      const auto = autoRecipe(table);
      if (autoRecipeIsGood(auto)) {
        setReview({ source: file.name, how: "auto", table, recipe: auto, sheet: read.sheet, otherSheets: read.otherSheets, rows: applyRecipe(table, auto) });
        setStage("review");
      } else {
        await planWithAi(table, file.name, read.sheet, read.otherSheets);
      }
    } catch (err) {
      fail((err as Error).message || "Couldn't read that file.");
    }
  }

  async function onPasted() {
    setError(null);
    setDone(null);
    setStage("reading");
    try {
      await readText(pasted, "pasted text");
    } catch (err) {
      fail((err as Error).message);
    }
  }

  async function rereadWithAi() {
    if (!review?.table) return;
    setError(null);
    setStage("reading");
    try {
      await planWithAi(review.table, review.source, review.sheet ?? null, review.otherSheets ?? []);
    } catch (err) {
      setError((err as Error).message);
      setStage("review");
    }
  }

  const good = (review?.rows ?? []).filter((r) => r.listing);
  const bad = (review?.rows ?? []).filter((r) => !r.listing);
  const withRefs = good.filter((r) => r.listing!.reference).length;
  const today = new Date().toISOString().slice(0, 10);
  const later = good.filter((r) => r.listing!.available_from && r.listing!.available_from > today).length;

  async function importNow() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("import_listings", {
      p_rows: good.map((r) => r.listing),
      p_withdraw_missing: withdrawMissing && withRefs > 0,
    });
    setBusy(false);
    if (e) return setError(e.message);
    setDone(data as { inserted: number; updated: number; withdrawn: number });
    setReview(null);
    setStage("done");
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
    <div className="grid max-w-5xl gap-6">
      {(stage === "choose" || stage === "done") && (
        <Panel title="Choose a file">
          <div className="grid gap-4 text-[13px] text-gray-600">
            <p className="m-0">
              Use the file you already have: an Excel sheet, a CSV, a PDF price list or brochure, or a Word document. Elliot works out
              which column or line is the price, the area, the type and so on, leaves out internal details (staff names, owner payouts,
              contract dates), and shows you everything before saving.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className={`${btn.primary} cursor-pointer`}>
                Choose file
                <input type="file" accept={ACCEPTED} onChange={onFile} className="sr-only" />
              </label>
              <button type="button" onClick={() => setShowPaste((v) => !v)} className={btn.secondary}>
                {showPaste ? "Hide text box" : "Paste text instead"}
              </button>
              <button type="button" onClick={downloadTemplate} className={btn.ghost}>
                Download a template
              </button>
            </div>
            <p className="m-0 text-[12.5px] text-gray-500">
              Excel (.xlsx), CSV, PDF, Word (.docx) or text. Up to {MAX_ROWS.toLocaleString("en-GB")} listings at a time. Scanned PDFs and photos can&apos;t be read yet.
            </p>
            {showPaste && (
              <div className="grid gap-2">
                <label htmlFor="paste" className="text-[12.5px] font-medium text-gray-600">
                  Paste listings from an email, a website or a document
                </label>
                <textarea id="paste" rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} className="w-full p-3 leading-relaxed" />
                <div>
                  <button type="button" onClick={onPasted} disabled={!pasted.trim()} className={btn.primary}>
                    Read this text
                  </button>
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {stage === "done" && done && (
        <Notice>
          Done: {done.inserted} added, {done.updated} updated{done.withdrawn ? `, ${done.withdrawn} withdrawn` : ""}.{" "}
          <a href="/dashboard/listings" className="text-ink underline">
            See your listings
          </a>
        </Notice>
      )}

      {stage === "reading" && (
        <Panel>
          <div className="flex items-center gap-3 text-[14px] text-ink" role="status" aria-live="polite">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-ink-200 border-t-ink" />
            {progress}
          </div>
          <p className="mb-0 mt-2 text-[12.5px] text-gray-500">Nothing is saved until you confirm. Long documents can take a minute or two.</p>
        </Panel>
      )}

      {stage === "review" && review && (
        <>
          <Panel
            title={`${review.source}${review.sheet ? `, sheet “${review.sheet}”` : ""}`}
            action={
              <button type="button" onClick={() => { setStage("choose"); setReview(null); }} className={`${btn.ghost} ${btn.small}`}>
                Start over
              </button>
            }
          >
            <div className="grid gap-4 text-[13px]">
              <p className="m-0 text-ink">
                <strong className="font-semibold">{good.length} listing{good.length === 1 ? "" : "s"} ready to import</strong>
                {bad.length > 0 && <span className="text-alert"> · {bad.length} skipped</span>}
                {later > 0 && <span className="text-gray-500"> · {later} become available later (Elliot says when)</span>}
              </p>

              {review.how !== "ai-text" && review.table && review.recipe && (
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="mb-1.5 mt-0 text-[12.5px] font-medium text-gray-600">
                      How Elliot read your columns {review.how === "auto" ? "(by their names)" : "(worked out by Elliot)"}
                    </p>
                    <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
                      {explainRecipe(review.recipe, review.table).map((r) => (
                        <div key={r.field} className="contents">
                          <dt className="text-gray-500">{r.field}</dt>
                          <dd className="m-0 text-ink">{r.from}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="grid content-start gap-3">
                    {(review.recipe.notes ?? []).length > 0 && (
                      <div>
                        <p className="mb-1.5 mt-0 text-[12.5px] font-medium text-gray-600">Assumptions</p>
                        <ul className="m-0 list-disc pl-5 text-gray-700">
                          {review.recipe.notes!.map((n) => <li key={n}>{n}</li>)}
                        </ul>
                      </div>
                    )}
                    {(review.recipe.ignored ?? []).length > 0 && (
                      <div>
                        <p className="mb-1.5 mt-0 text-[12.5px] font-medium text-gray-600">Not imported</p>
                        <p className="m-0 text-gray-600">
                          {review.recipe.ignored!.map((i) => {
                            const h = review.table!.columns.find((c) => c.letter === i.column)?.header || `column ${i.column}`;
                            return `${h} (${i.reason.toLowerCase()})`;
                          }).join(", ")}
                        </p>
                      </div>
                    )}
                    {review.otherSheets && review.otherSheets.length > 0 && (
                      <p className="m-0 text-gray-500">
                        Other sheets in the file were not read: {review.otherSheets.join(", ")}. Upload them separately if they hold listings.
                      </p>
                    )}
                    {review.how === "auto" && (
                      <div>
                        <button type="button" onClick={rereadWithAi} className={`${btn.secondary} ${btn.small}`}>
                          Doesn&apos;t look right? Let Elliot read it
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {review.how === "ai-text" && (
                <p className="m-0 text-gray-600">Elliot read the document and found these listings. Check them against the original before importing.</p>
              )}
            </div>
          </Panel>

          {bad.length > 0 && (
            <Panel title={`Skipped (${bad.length})`}>
              <ul className="m-0 list-none p-0 text-[12.5px] text-gray-600">
                {bad.slice(0, 30).map((r) => (
                  <li key={r.line}>
                    {review.how === "ai-text" ? `Listing ${r.line}` : `Row ${r.line}`}: {r.errors.join("; ")}
                  </li>
                ))}
                {bad.length > 30 && <li>…and {bad.length - 30} more</li>}
              </ul>
              <p className="mb-0 mt-2 text-[12.5px] text-gray-500">Fix these in your file and import it again; rows already imported will be updated, not duplicated.</p>
            </Panel>
          )}

          <Panel
            title="Preview"
            action={
              <button type="button" onClick={importNow} disabled={busy || good.length === 0} className={btn.primary}>
                {busy ? "Importing…" : `Import ${good.length} listing${good.length === 1 ? "" : "s"}`}
              </button>
            }
            flush
          >
            {withRefs > 0 && (
              <label className="flex items-start gap-2 border-b border-gray-200 px-5 py-3 text-[13px] text-gray-700">
                <input type="checkbox" checked={withdrawMissing} onChange={(e) => setWithdrawMissing(e.target.checked)} className="mt-0.5" />
                <span>
                  This file is my full list: mark listings that aren&apos;t in it as withdrawn, so Elliot stops offering them.{" "}
                  <span className="text-gray-500">Listings you added by hand are never touched.</span>
                </span>
              </label>
            )}
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-200 text-[12px] text-gray-500">
                    <th className="px-5 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Location</th>
                    <th className="px-3 py-2 font-medium">Available</th>
                    <th className="px-3 py-2 font-medium">Features</th>
                  </tr>
                </thead>
                <tbody>
                  {good.slice(0, 300).map(({ line, listing: l }) => (
                    <tr key={line} className="border-b border-gray-100 align-top">
                      <td className="px-5 py-2">
                        <div className="text-ink">{l!.title}</div>
                        {l!.description && <div className="line-clamp-1 text-[12px] text-gray-500">{l!.description}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                        {l!.property_type}, {l!.transaction_type}
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-2">{formatPrice(l!.price, l!.currency, l!.transaction_type)}</td>
                      <td className="px-3 py-2 text-gray-600">{[l!.district, l!.city].filter(Boolean).join(", ") || "–"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{l!.status !== "available" ? STATUS_LABEL[l!.status] : l!.available_from && l!.available_from > today ? l!.available_from : "Now"}</td>
                      <td className="px-3 py-2 text-gray-600">{l!.features.join(", ") || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {good.length > 300 && <p className="m-0 px-5 py-2 text-[12.5px] text-gray-500">Showing the first 300 of {good.length}. All of them will be imported.</p>}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
