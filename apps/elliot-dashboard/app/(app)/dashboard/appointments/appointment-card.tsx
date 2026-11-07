import { StatusBadge } from "../../../_ui/ui";
import { DEFAULT_TZ, dayKey, dayLabel, personName, timeRange, type Appointment } from "@/lib/appointments";
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
  const name = a.contact?.name || a.contact?.email || "Unknown contact";
  const contactLine = [a.contact?.name ? a.contact?.email : null, a.contact?.phone].filter(Boolean).join(", ");
  const href = `/dashboard/appointments/${a.id}`;

  return (
    <li className="border-t border-gray-200 first:border-t-0">
      <div className={`grid gap-2 px-5 py-3.5 ${APPOINTMENT_GRID}`}>
        <span className="tabular hidden text-[12.5px] text-gray-400 md:block">{number}</span>
        <div className={isFinal ? "text-gray-500" : "text-ink"}>
          <div className="text-[14px] font-medium">{dayLabel(dayKey(a.starts_at, tz))}</div>
          <div className="tabular text-[12.5px] text-gray-500">
            {timeRange(a, tz)}
            {tz !== DEFAULT_TZ ? ` (${tz})` : ""}
          </div>
        </div>

        <div className="min-w-0">
          <a
            href={href}
            className={`block truncate text-[14px] no-underline hover:underline ${isCancelled ? "text-gray-500 line-through decoration-gray-300" : "text-ink"}`}
          >
            {name}
          </a>
          {contactLine && <div className="truncate text-[12.5px] text-gray-500">{contactLine}</div>}
        </div>

        <a href={href} className={`block min-w-0 rounded-md no-underline hover:bg-gray-50 ${isCancelled ? "opacity-60" : ""}`}>
          <ListingLine appointment={a} />
        </a>

        <div className="min-w-0 text-[13px]">
          <span className="text-gray-400 md:hidden">Agent: </span>
          {a.agent ? <span className="text-gray-700">{personName(a.agent)}</span> : <span className="font-medium text-brass-dark">Unassigned</span>}
        </div>

        <div>
          <StatusBadge kind="appointment" value={a.status} />
        </div>

        <AppointmentActions id={a.id} status={a.status} startsAt={a.starts_at} />
      </div>
    </li>
  );
}
