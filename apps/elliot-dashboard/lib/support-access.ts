// Support access (0040): an agency lets the Elliot team into its dashboard
// for a while, and sees every visit. Keep the durations in step with
// grant_support_access() in the database.

export const ACCESS_OPTIONS = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days (during set-up)" },
] as const;

export type Grant = { expires_at: string; granted_by_email?: string | null; granted_at?: string | null } | null;

export type AccessState =
  | { open: true; reason: "not_required" }
  | { open: true; reason: "own_account" }
  | { open: true; reason: "granted"; until: string; by: string | null }
  | { open: false; reason: "off" | "expired"; expiredAt?: string };

/**
 * assistantMode 'sales' / 'demo' are Elliot's own accounts: no permission needed.
 * required = the control-panel switch (0041); off during testing.
 */
export function supportAccessState(grant: Grant, assistantMode: string | null | undefined, now = new Date(), required = true): AccessState {
  if (assistantMode && assistantMode !== "agency") return { open: true, reason: "own_account" };
  if (!required) return { open: true, reason: "not_required" };
  if (!grant) return { open: false, reason: "off" };
  if (new Date(grant.expires_at).getTime() <= now.getTime()) return { open: false, reason: "expired", expiredAt: grant.expires_at };
  return { open: true, reason: "granted", until: grant.expires_at, by: grant.granted_by_email ?? null };
}

/** "until Tue 17 Nov, 21:40" in the agency's time zone. */
export function untilLabel(iso: string, timeZone = "Europe/Warsaw"): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
