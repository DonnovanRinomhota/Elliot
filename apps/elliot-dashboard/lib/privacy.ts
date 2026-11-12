// A client's access and erasure requests (GDPR Art. 15, 17, 20) and deleting a
// cancelled agency's data. The database does the work (migration 0051); these
// helpers shape what it returns for the dashboard. See docs/data-protection.md.

export type CalendarEvent = { calendar: string; event_id: string; starts_at: string; status: string };

export type EraseResult = {
  conversations: number;
  messages: number;
  leads: number;
  appointments: number;
  drafts: number;
  files: number;
  storage_paths: string[];
  calendar_events: CalendarEvent[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// What erase_client returned, made safe to read.
export function parseEraseResult(raw: unknown): EraseResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const paths = Array.isArray(r.storage_paths) ? r.storage_paths.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
  const events = Array.isArray(r.calendar_events)
    ? (r.calendar_events as Record<string, unknown>[])
        .filter((e) => e && typeof e.event_id === "string" && e.event_id)
        .map((e) => ({
          calendar: String(e.calendar ?? ""),
          event_id: String(e.event_id),
          starts_at: String(e.starts_at ?? ""),
          status: String(e.status ?? ""),
        }))
    : [];
  return {
    conversations: num(r.conversations),
    messages: num(r.messages),
    leads: num(r.leads),
    appointments: num(r.appointments),
    drafts: num(r.drafts),
    files: num(r.files),
    storage_paths: Array.from(new Set(paths)),
    calendar_events: events,
  };
}

// Storage deletes take a list of paths; keep each call small.
export function chunk<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Files of a deleted agency, grouped per bucket.
export function filesByBucket(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!Array.isArray(raw)) return out;
  for (const f of raw as Record<string, unknown>[]) {
    const bucket = typeof f?.bucket === "string" ? f.bucket : "";
    const path = typeof f?.path === "string" ? f.path : "";
    if (!bucket || !path) continue;
    (out[bucket] ??= []).push(path);
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// One line for the team after an erasure.
export function erasedSummary(r: EraseResult): string {
  const parts = [
    plural(r.conversations, "conversation"),
    plural(r.messages, "message"),
    plural(r.appointments, "viewing"),
    plural(r.files, "file"),
  ];
  return `Deleted: ${parts.join(", ")}.`;
}

// The file name for a client's export.
export function exportFileName(name: string | null | undefined, today = new Date()): string {
  const slug =
    (name ?? "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .replace(/Ł/g, "L")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "client";
  return `elliot-${slug}-${today.toISOString().slice(0, 10)}.json`;
}

// The database's refusals, in words the team understands.
export function privacyError(message: string, code?: string): { status: number; error: string } {
  if (/export_client|erase_client|erase_agency/.test(message) && /function|schema cache/i.test(message)) {
    return { status: 500, error: "Run migration 0051 in Supabase first." };
  }
  if (code === "42501" || /admin of the agency|permission denied/i.test(message)) {
    return { status: 403, error: "Only an agency admin can do this." };
  }
  if (code === "P0002" || /not found/i.test(message)) return { status: 404, error: "This client no longer exists." };
  return { status: 400, error: message };
}
