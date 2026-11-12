import { Badge, StatusBadge } from "../../../_ui/ui";
import { contactLabel } from "@/lib/contacts";
import { DEFAULT_TZ, bookedAtLabel, channelLabel, clientNotes, dayKey, dayLabel, personName, timeRange, type Appointment } from "@/lib/appointments";
import { APPOINTMENT_GRID } from "./grid";
import AppointmentActions from "./appointment-actions";
import { ListingLine } from "./viewing-bits";

// One row in the Appointments list: when, client, the property being viewed
// (with its cover photo), the agent, status and actions. The client's name
// and the property open the appointment's own page.
export default function AppointmentCard({ appointment, number }: { appointment: Appointment; number?: number }) {
  const a = appointment;
  const tz = a.timezone || DEFAULT_TZ;
  const isFinal = ["cancelled", "completed", "no_show"].includes(a.status);
  const isCancelled = a.status === "cancelled";
  const name = contactLabel(a.contact);
  const contactLine = [a.contact?.name ? a.contact?.email : null, a.contact?.phone].filter(Boolean).join(", ");
  const href = `/dashboard/appointments/${a.id}`;

  return (
    <li className="rounded-2xl border border-[rgba(15,31,56,0.06)] bg-[#f3f6fb] transition-colors hover:border-gold/40 hover:bg-white">
      <div className={`grid gap-2 px-3.5 py-3 ${APPOINTMENT_GRID}`}>
        <span className="tabular hidden text-right text-[12px] text-gray-400 xl:block">{number}</span>
        <div className={`flex items-center gap-3 ${isFinal ? "text-gray-500" : "text-ink"}`}>
          {/* A small calendar page: weekday and day, gold while it's still to come */}
          <span
            aria-hidden="true"
            className={`flex h-12 w-12 flex-shrink-0 flex-col items-center justify-center rounded-xl ${isFinal ? "bg-gray-100 text-gray-500" : "gold-fill text-ink shadow-gold"}`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em]">{dayLabel(dayKey(a.starts_at, tz), "weekday")}</span>
            <span className="tabular text-[18px] font-bold leading-none">{Number(dayKey(a.starts_at, tz).slice(8))}</span>
          </span>
          <span className="min-w-0">
            <span className="sr-only">{dayLabel(dayKey(a.starts_at, tz))}, </span>
            <span className="tabular block text-[14px] font-semibold">
              {timeRange(a, tz)}
              {tz !== DEFAULT_TZ ? ` (${tz})` : ""}
            </span>
            <span className="tabular block whitespace-nowrap text-[11.5px] text-gray-500" title={`Booked ${bookedAtLabel(a.created_at, tz)}${a.conversation ? ` on ${channelLabel(a.conversation.channel)}` : ""}`}>
              Booked {bookedAtLabel(a.created_at, tz, false)}
            </span>
          </span>
        </div>

        <div className="min-w-0">
          <a
            href={href}
            className={`block truncate text-[14px] font-semibold no-underline hover:underline ${isCancelled ? "text-gray-500 line-through decoration-gray-300" : "text-ink"}`}
          >
            {name}
          </a>
          {contactLine && <div className="truncate text-[12.5px] text-gray-500">{contactLine}</div>}
        </div>

        <a href={href} className={`block min-w-0 rounded-xl no-underline hover:bg-white ${isCancelled ? "opacity-60" : ""}`}>
          <ListingLine appointment={a} />
        </a>

        <div className="min-w-0 text-[13px]">
          <span className="text-gray-400 xl:hidden">Agent: </span>
          {a.agent ? (
            <span className="inline-flex min-w-0 items-center gap-2 text-gray-700">
              <span aria-hidden="true" className="gold-fill flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-ink">
                {personName(a.agent)
                  .split(/[\s.@_-]+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0]!.toUpperCase())
                  .join("")}
              </span>
              <span className="truncate">{personName(a.agent)}</span>
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-brass-soft px-2.5 py-0.5 text-[12px] font-semibold text-brass-dark">No agent yet</span>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-1">
          <StatusBadge kind="appointment" value={a.status} />
          {clientNotes(a, tz).map((n) => (
            <Badge key={n.text} tone={n.tone === "ok" ? "ink" : n.tone === "warn" ? "brass" : "muted"}>
              {n.text}
            </Badge>
          ))}
        </div>

        <AppointmentActions id={a.id} status={a.status} startsAt={a.starts_at} />
      </div>
    </li>
  );
}
