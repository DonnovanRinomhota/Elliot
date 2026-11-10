// ASARI CRM sync (0044): what the Settings card shows and checks. The
// token itself never comes back to the browser; asari_status() leaves it out.

export type AsariCounts = {
  exported?: number;
  fetched?: number;
  new?: number;
  updated?: number;
  failed?: number;
  withdrawn?: number;
  left_for_next_run?: number;
};

export type AsariStatus =
  | { connected: false }
  | {
      connected: true;
      enabled: boolean;
      api_user_id: string;
      last_sync_at: string | null;
      last_sync_ok: boolean | null;
      last_sync_error: string | null;
      last_sync_counts: AsariCounts | null;
      listings: number;
    };

/** Checks what an admin typed before it is saved. Returns an error message or null. */
export function checkAsariCredentials(userId: string, token: string, tokenRequired: boolean): string | null {
  const u = userId.trim();
  const t = token.trim();
  if (!u) return "Enter the API user ID from ASARI.";
  if (/\s/.test(u) || u.length > 100) return "The API user ID should be a single word or number, as ASARI shows it.";
  if (u.includes(":")) return "Enter the user ID and the token in their own boxes (ASARI shows them as ID:token).";
  if (tokenRequired && !t) return "Enter the API token from ASARI.";
  if (t && (/\s/.test(t) || t.length < 8 || t.length > 500)) return "That doesn't look like an ASARI API token. Copy it again from ASARI.";
  return null;
}

/** "ID:token" pasted into one box: split it, so people can paste what ASARI shows. */
export function splitPastedCredentials(value: string): { userId: string; token: string } | null {
  const m = value.trim().match(/^([^:\s]+):(\S{8,})$/);
  return m ? { userId: m[1], token: m[2] } : null;
}

/** One line under the status: what the last sync did. */
export function syncSummary(c: AsariCounts | null | undefined): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.new) parts.push(`${c.new} new`);
  if (c.updated) parts.push(`${c.updated} updated`);
  if (c.withdrawn) parts.push(`${c.withdrawn} no longer in ASARI`);
  if (c.failed) parts.push(`${c.failed} couldn't be read`);
  if (!parts.length) parts.push("no changes");
  let s = parts.join(", ");
  if (c.left_for_next_run) s += `; ${c.left_for_next_run} more on the next sync`;
  return s;
}

export function syncState(s: AsariStatus): "off" | "paused" | "waiting" | "ok" | "error" {
  if (!s.connected) return "off";
  if (!s.enabled) return "paused";
  if (!s.last_sync_at) return "waiting";
  return s.last_sync_ok ? "ok" : "error";
}
