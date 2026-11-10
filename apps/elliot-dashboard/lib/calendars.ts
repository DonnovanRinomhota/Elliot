// Agents' own Google Calendars (0042): what the Team page says about each.

export type CalendarStatus = "ok" | "read_only" | "not_shared" | "error" | null | undefined;

export type CalendarState = { tone: "ok" | "warn" | "alert" | "none"; label: string; help?: string };

export function calendarState(
  calendarId: string | null | undefined,
  status: CalendarStatus,
  error: string | null | undefined,
  elliotAccount: string | null | undefined
): CalendarState {
  const share = elliotAccount ? `Share it with ${elliotAccount}` : "Share it with Elliot's Google account";
  if (!String(calendarId ?? "").trim()) return { tone: "none", label: "No calendar", help: "Viewings use the agency calendar." };
  switch (status) {
    case "ok":
      return { tone: "ok", label: "Connected" };
    case "read_only":
      return { tone: "warn", label: "Can't add viewings", help: `${share} with “Make changes to events”, not only “See all event details”.` };
    case "not_shared":
      return { tone: "alert", label: "Not shared with Elliot", help: `${share} (“Make changes to events”), or check the address.` };
    case "error":
      return { tone: "alert", label: "Couldn't check", help: error ? `Google said: ${error}` : "Try Check again in a minute." };
    default:
      return { tone: "warn", label: "Not checked yet", help: "Click Check calendars." };
  }
}

/** Calendar IDs are email-like: name@gmail.com, or ...@group.calendar.google.com. */
export function isCalendarId(v: string): boolean {
  return /^[^\s<>"]+@[^\s<>"]+$/.test(v.trim());
}
