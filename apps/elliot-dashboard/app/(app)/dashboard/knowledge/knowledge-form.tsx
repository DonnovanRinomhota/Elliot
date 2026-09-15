"use client";

import { useState } from "react";

// Real values the ingestion webhook (08-knowledge-ingestion.json) accepts --
// see its Validate Input node. 'pdf' and 'website' are valid categories but,
// as of writing, everything is processed identically as pasted plain text
// regardless of which one you pick; there's no actual file/URL parsing yet.
const SOURCE_TYPES = ["faq", "manual_text", "pdf", "website", "other"];

export default function KnowledgeForm({ tenantSlug }: { tenantSlug: string }) {
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("faq");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ document_id: string; chunks_created: number } | null>(null);

  async function handleSubmit() {
    if (!title.trim() || !text.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(process.env.NEXT_PUBLIC_N8N_INGEST_WEBHOOK_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_slug: tenantSlug, title, source_type: sourceType, text }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || `Ingestion webhook returned ${res.status}`);
      }
      setSuccess(data);
      setTitle("");
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
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

      {error && <p className="mb-3 text-xs text-red-700">{error}</p>}
      {success && (
        <p className="mb-3 text-xs text-green-700">
          Ingested as {success.chunks_created} chunk{success.chunks_created === 1 ? "" : "s"} (document{" "}
          {success.document_id}).
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={busy || !title.trim() || !text.trim()}
        className="rounded-md bg-ink px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Ingesting…" : "Add to knowledge base"}
      </button>
    </div>
  );
}
