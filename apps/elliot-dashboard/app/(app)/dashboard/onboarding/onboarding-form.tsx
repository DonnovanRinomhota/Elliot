"use client";

import { useState } from "react";

type OnboardResult =
  | { success: true; tenant_id: string; slug: string; name: string; next_steps: string[] }
  | { success: false; error: string };

const PLANS = ["trial", "starter", "pro", "enterprise"];

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function OnboardingForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [industry, setIndustry] = useState("");
  const [plan, setPlan] = useState("trial");
  const [timezone, setTimezone] = useState("UTC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);

  function handleNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  async function handleSubmit() {
    if (!name.trim() || !slug.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(process.env.NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, industry: industry || undefined, plan, timezone }),
      });
      const data: OnboardResult = await res.json();
      setResult(data);
      if (!data.success) setError(data.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result?.success) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 text-sm font-medium text-green-700">
          Tenant &quot;{result.name}&quot; created (slug: {result.slug})
        </div>
        <div className="mb-2 text-xs font-medium text-gray-700">Remaining manual steps:</div>
        <ul className="list-inside list-disc space-y-2 text-xs text-gray-600">
          {result.next_steps.map((step, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {step}
            </li>
          ))}
        </ul>
        <button
          onClick={() => {
            setResult(null);
            setName("");
            setSlug("");
            setSlugTouched(false);
            setIndustry("");
            setPlan("trial");
          }}
          className="mt-4 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
        >
          Onboard another
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-gray-700">Business name</label>
        <input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={busy}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-gray-700">Slug</label>
        <input
          value={slug}
          onChange={(e) => {
            setSlug(slugify(e.target.value));
            setSlugTouched(true);
          }}
          disabled={busy}
          className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
        />
        <p className="mt-1 text-[11px] text-gray-400">
          Used in the chat widget embed and the knowledge-ingestion API. Auto-filled from the name -- edit it
          directly if you need something different.
        </p>
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-gray-700">Industry (optional)</label>
        <input
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          disabled={busy}
          placeholder="e.g. real_estate"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="mb-4 flex gap-4">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-700">Plan</label>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-700">Timezone</label>
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && <p className="mb-3 text-xs text-red-700">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={busy || !name.trim() || !slug.trim()}
        className="rounded-md bg-ink px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create tenant"}
      </button>
    </div>
  );
}
