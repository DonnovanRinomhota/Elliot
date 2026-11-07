"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "../../../_ui/ui";

type Outcome = {
  updated: number;
  empty: { id: string; title: string }[];
  failed: { id: string; title: string; error: string }[];
};

// Fills listing photos from their Google Drive folder links, in batches,
// with progress. Used on the Listings page and right after an import.
export default function DriveSync({
  missingCount,
  folderCount,
  autoStart = false,
}: {
  /** Listings with a Drive folder link and no photos yet. */
  missingCount: number;
  /** Listings with a Drive folder link at all. */
  folderCount: number;
  autoStart?: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function run(mode: "missing" | "refresh") {
    setRunning(true);
    setError(null);
    setOutcome(null);
    setDone(0);
    setTotal(mode === "missing" ? missingCount : folderCount);
    const acc: Outcome = { updated: 0, empty: [], failed: [] };
    let cursor: string | null = null;
    let processed = 0;
    try {
      do {
        let res: Response | null = null;
        // A busy answer from Google gets a short pause and a retry.
        for (let attempt = 0; attempt < 3; attempt++) {
          res = await fetch("/api/listings/drive-photos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, cursor }),
          });
          if (res.status !== 429) break;
          await new Promise((r) => setTimeout(r, 15000));
        }
        const data = await res!.json().catch(() => null);
        if (!res!.ok || !data?.success) throw new Error(data?.error || `Request failed (${res!.status})`);
        processed += data.processed;
        acc.updated += data.updated;
        acc.empty.push(...data.empty);
        acc.failed.push(...data.failed);
        setDone(processed);
        if (data.next_cursor) setTotal(processed + data.remaining);
        cursor = data.next_cursor;
      } while (cursor);
      setOutcome(acc);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      if (acc.updated) router.refresh();
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (autoStart && missingCount > 0 && !started.current) {
      started.current = true;
      run("missing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, missingCount]);

  if (!folderCount && !outcome && !error) return null;

  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <section className="mb-4 card px-5 py-4 text-[13px]" aria-live="polite">
      {running ? (
        <div className="grid gap-2">
          <p className="m-0 text-ink">
            Getting photos from Google Drive: <span className="tabular">{done}</span> of <span className="tabular">{total}</span> listings…
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="m-0 text-[12.5px] text-gray-500">Keep this page open until it finishes. About 1,000 listings take 5 to 10 minutes.</p>
        </div>
      ) : outcome ? (
        <div className="grid gap-1.5">
          <p className="m-0 text-ink">
            Done: photos added to <strong className="font-semibold">{outcome.updated}</strong> listing{outcome.updated === 1 ? "" : "s"}.
            {outcome.empty.length > 0 && <> {outcome.empty.length} folder{outcome.empty.length === 1 ? " had" : "s had"} no photos.</>}
          </p>
          {outcome.failed.length > 0 && (
            <details>
              <summary className="cursor-pointer text-alert">
                {outcome.failed.length} folder{outcome.failed.length === 1 ? "" : "s"} couldn&apos;t be read
              </summary>
              <ul className="m-0 mt-1 list-disc pl-5 text-gray-600">
                {outcome.failed.slice(0, 20).map((f) => (
                  <li key={f.id}>
                    <a href={`/dashboard/listings/${f.id}`} className="text-ink underline">{f.title}</a>: {f.error}
                  </li>
                ))}
                {outcome.failed.length > 20 && <li>…and {outcome.failed.length - 20} more</li>}
              </ul>
              <p className="m-0 mt-1 text-gray-500">Usually the folder isn&apos;t shared. In Drive: Share → General access → Anyone with the link.</p>
            </details>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-gray-700">
            {missingCount > 0 ? (
              <>
                <strong className="font-semibold text-ink">{missingCount}</strong> listing{missingCount === 1 ? " has" : "s have"} photos in a Google Drive
                folder. Elliot can show them here automatically.
              </>
            ) : (
              <>{folderCount} listing{folderCount === 1 ? " gets" : "s get"} photos from Google Drive folders. Added photos to a folder? Re-check them.</>
            )}
          </p>
          <div className="flex gap-2">
            {missingCount > 0 && (
              <button type="button" onClick={() => run("missing")} className={btn.primary}>
                Get photos from Drive
              </button>
            )}
            <button type="button" onClick={() => run("refresh")} className={missingCount > 0 ? btn.ghost : btn.secondary}>
              Re-check all folders
            </button>
          </div>
        </div>
      )}
      {error && <p className="m-0 mt-2 text-alert">{error}</p>}
    </section>
  );
}
