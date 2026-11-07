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
      // Goes through the dashboard's server, which adds the webhook secret --
      // see app/api/admin/onboard/route.ts.
      const res = await fetch("/api/admin/onboard", {
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
      <div className="card p-5">
        <div className="mb-3 text-sm font-medium text-ink">
          Tenant &quot;{result.name}&quot; created (slug: {result.slug})
        </div>
        <div className="mb-2 text-[12.5px] font-medium text-gray-700">Remaining manual steps:</div>
        <ul className="list-inside list-disc space-y-2 text-[12.5px] text-gray-600">
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
          className="mt-4 rounded-md border border-gray-300 px-3 py-1.5 text-[12.5px] font-medium hover:bg-gray-50"
        >
          Onboard another
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="mb-4">
        <label className="mb-1 block text-[12.5px] font-medium text-gray-700">Business name</label>
        <input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={busy}
          className="w-full h-9 px-3"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-[12.5px] font-medium text-gray-700">Slug</label>
        <input
          value={slug}
          onChange={(e) => {
            setSlug(slugify(e.target.value));
            setSlugTouched(true);
          }}
          disabled={busy}
          className="w-full h-9 px-3"
        />
        <p className="mt-1 text-[12px] text-gray-400">
          Used in the chat widget embed and the knowledge-ingestion API. Auto-filled from the name -- edit it
          directly if you need something different.
        </p>
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-[12.5px] font-medium text-gray-700">Industry (optional)</label>
        <input
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          disabled={busy}
          placeholder="e.g. real_estate"
          className="w-full h-9 px-3"
        />
      </div>
      <div className="mb-4 flex gap-4">
        <div className="flex-1">
          <label className="mb-1 block text-[12.5px] font-medium text-gray-700">Plan</label>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            disabled={busy}
            className="w-full h-9 px-3"
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[12.5px] font-medium text-gray-700">Timezone</label>
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={busy}
            className="w-full h-9 px-3"
          />
        </div>
      </div>

      {error && <p className="mb-3 text-[12.5px] text-alert">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={busy || !name.trim() || !slug.trim()}
        className="inline-flex h-9 cursor-pointer items-center justify-center rounded-full border-0 bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create tenant"}
      </button>
    </div>
  );
}
