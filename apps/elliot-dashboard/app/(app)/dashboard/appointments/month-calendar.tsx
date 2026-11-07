import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, dayKey, dayLabel, groupByDay, monthGrid, monthLabel, timeRange, type Appointment } from "@/lib/appointments";
import { btn } from "../../../_ui/ui";
import { ListingLine, ViewingChip } from "./viewing-bits";

const MAX_CHIPS = 3;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Month view of viewings. Desktop: a month grid with up to three viewings
// per day ("+N more" opens that week in the Calendar page). Phone: the days
// that have viewings, as a list.
export default function MonthCalendar({
  appointments,
  month,
  today,
  tz,
  hrefFor,
  weekHref,
}: {
  appointments: Appointment[];
  month: string;
  today: string;
  tz: string;
  /** Link to this page for another month. */
  hrefFor: (month: string) => string;
  /** Link to the Calendar page for the week of a day. */
  weekHref: (day: string) => string;
}) {
  const weeks = monthGrid(month);
  const byDay = groupByDay(appointments, tz);
  const inMonth = appointments.filter((a) => dayKey(a.starts_at, tz).startsWith(month));
  const upcoming = inMonth.filter((a) => new Date(a.ends_at).getTime() >= Date.now() && a.status !== "cancelled");
  const unassigned = upcoming.filter((a) => !a.agent);
  const daysWithViewings = Array.from(byDay.keys()).filter((k) => k.startsWith(month)).sort();

  return (
    <section aria-label={`Viewings in ${monthLabel(month)}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <a href={hrefFor(addMonths(month, -1))} className={`${btn.ghost} !px-2`} aria-label="Previous month">
            <ChevronLeft size={16} aria-hidden="true" />
          </a>
          <h2 className="m-0 min-w-[150px] text-center text-[15px] font-semibold text-ink">{monthLabel(month)}</h2>
          <a href={hrefFor(addMonths(month, 1))} className={`${btn.ghost} !px-2`} aria-label="Next month">
            <ChevronRight size={16} aria-hidden="true" />
          </a>
          {month !== today.slice(0, 7) && (
            <a href={hrefFor(today.slice(0, 7))} className={`${btn.secondary} ${btn.small} ml-1`}>
              This month
            </a>
          )}
        </div>
        <p className="m-0 text-[13px] text-gray-600">
          <span className="tabular text-ink">{inMonth.length}</span> viewing{inMonth.length === 1 ? "" : "s"} this month,{" "}
          <span className="tabular text-ink">{upcoming.length}</span> still to come
          {unassigned.length > 0 && (
            <>
              , <span className="tabular font-medium text-brass-dark">{unassigned.length} without an agent</span>
            </>
          )}
          .
        </p>
      </div>

      {/* Desktop month grid */}
      <div className="hidden overflow-hidden card md:block">
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-[12px] font-medium text-gray-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
            {week.map((day) => {
              const list = byDay.get(day) ?? [];
              const outside = !day.startsWith(month);
              const isToday = day === today;
              return (
                <div key={day} className={`min-h-[112px] border-r border-gray-100 p-1.5 last:border-r-0 ${outside ? "bg-gray-50/70" : ""}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`tabular inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] ${
                        isToday ? "bg-accent font-semibold text-white" : outside ? "text-gray-400" : "text-gray-700"
                      }`}
                    >
                      {Number(day.slice(8))}
                    </span>
                  </div>
                  <div className="grid gap-1">
                    {list.slice(0, MAX_CHIPS).map((a) => (
                      <ViewingChip key={a.id} appointment={a} tz={tz} showListing />
                    ))}
                    {list.length > MAX_CHIPS && (
                      <a href={weekHref(day)} className="px-1 text-[12px] text-ink-600 no-underline hover:underline">
                        +{list.length - MAX_CHIPS} more
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Phone: days with viewings */}
      <div className="md:hidden">
        {daysWithViewings.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-gray-500">No viewings this month.</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {daysWithViewings.map((day) => (
              <li key={day} className="overflow-hidden card">
                <div className={`border-b border-gray-100 px-4 py-2 text-[13px] font-medium ${day === today ? "bg-accent text-white" : "bg-gray-50 text-ink"}`}>
                  {day === today ? "Today, " : ""}
                  {dayLabel(day)}
                </div>
                <ul className="m-0 list-none p-0">
                  {byDay.get(day)!.map((a) => (
                    <li key={a.id} className="border-t border-gray-100 first:border-t-0">
                      <a href={`/dashboard/appointments/${a.id}`} className={`block px-4 py-3 no-underline ${a.status === "cancelled" ? "opacity-60" : ""}`}>
                        <div className="mb-1.5 text-[13px] text-ink">
                          <span className="tabular font-medium">{timeRange(a, tz)}</span> · {a.contact?.name || a.contact?.email || "Client"}
                        </div>
                        <ListingLine appointment={a} />
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
