"use client";

import { useState } from "react";

// Real values the ingestion webhook (08-knowledge-ingestion.json) accepts --
// see its Validate Input node.
const SOURCE_TYPES = ["faq", "manual_text", "pdf", "website", "other"];

// pdfjs-dist is imported dynamically inside the event handler, not at the
// top of this file -- a static top-level import risks being evaluated
// during Next.js's server-side render pass even for a "use client"
// component, and pdfjs-dist assumes a real browser environment. Loading it
// on demand, only when a PDF is actually selected, sidesteps that entirely.
async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  // CDN-hosted worker matching the installed package version exactly --
  // avoids Next.js/webpack needing to bundle pdfjs-dist's worker as a
  // static asset, which is a common source of build-time surprises with
  // this package.
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => ("str" in item ? item.str : "")).join(" ");
    pageTexts.push(pageText.trim());
  }

  const text = pageTexts.join("\n\n").trim();
  if (!text) {
    throw new Error(
      "No text found in this PDF -- it may be a scanned image with no real text layer (that needs OCR, which this doesn't do)."
    );
  }
  return text;
}

export default function KnowledgeForm({ tenantSlug }: { tenantSlug: string }) {
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("faq");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ document_id: string; chunks_created: number } | null>(null);

  const isWebsite = sourceType === "website";
  const isPdf = sourceType === "pdf";

  const canSubmit =
    !!title.trim() && (isWebsite ? !!url.trim() : isPdf ? !!pdfFile : !!text.trim());

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      let body: Record<string, string>;

      if (isWebsite) {
        body = { tenant_slug: tenantSlug, title, source_type: "website", url: url.trim() };
      } else if (isPdf) {
        setExtracting(true);
        const extractedText = await extractPdfText(pdfFile!);
        setExtracting(false);
        body = { tenant_slug: tenantSlug, title, source_type: "pdf", text: extractedText };
      } else {
        body = { tenant_slug: tenantSlug, title, source_type: sourceType, text };
      }

      const res = await fetch(process.env.NEXT_PUBLIC_N8N_INGEST_WEBHOOK_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || `Ingestion webhook returned ${res.status}`);
      }
      setSuccess(data);
      setTitle("");
      setText("");
      setUrl("");
      setPdfFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtracting(false);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-gray-700">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          placeholder="e.g. Pricing FAQ"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-gray-700">Source type</label>
        <select
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
          disabled={busy}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {isWebsite ? (
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            placeholder="https://example.com/faq"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            Fetched and extracted server-side. Won&apos;t work on pages that render their content with
            JavaScript (most modern site builders don&apos;t do this for plain FAQ/about pages, but some do).
          </p>
        </div>
      ) : isPdf ? (
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">PDF file</label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            disabled={busy}
            className="w-full text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            Text is extracted in your browser before upload. Scanned/image-only PDFs (no real text layer)
            won&apos;t work -- that needs OCR, which isn&apos;t built.
          </p>
        </div>
      ) : (
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">Content</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            rows={10}
            placeholder="Paste FAQ answers, policy text, property details, etc."
            className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
          />
        </div>
      )}

      {error && <p className="mb-3 text-xs text-red-700">{error}</p>}
      {success && (
        <p className="mb-3 text-xs text-green-700">
          Ingested as {success.chunks_created} chunk{success.chunks_created === 1 ? "" : "s"} (document{" "}
          {success.document_id}).
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={busy || !canSubmit}
        className="rounded-md bg-ink px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {extracting ? "Extracting PDF text…" : busy ? "Ingesting…" : "Add to knowledge base"}
      </button>
    </div>
  );
}
