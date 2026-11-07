import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/tenant";
import {
  APPOINTMENT_SELECT,
  DEFAULT_TZ,
  addDays,
  dayKey,
  dayLabel,
  groupByDay,
  parseWeek,
  personName,
  queryBounds,
  timeRange,
  todayKey,
  weekLabel,
  weekStart,
  type Appointment,
  type TeamMember,
} from "@/lib/appointments";
import { PageHeader, btn } from "../../../_ui/ui";
import AgentSelect from "../agent-select";
import { ListingLine, ListingThumb, ViewingChip } from "../appointments/viewing-bits";

const WEEKS_AHEAD = 6;

// Week by week: one agent's viewings (their own by default), or the whole
// team side by side. Cancelled viewings are left out.
export default async function CalendarPage({ searchParams }: { searchParams: { week?: string; agent?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [membership, { data: team }, { data: tenant }] = await Promise.all([
    user ? getMembership(supabase, user.id) : Promise.resolve(null),
    supabase
      .from("tenant_users")
      .select("id, full_name, email, role")
      .is("removed_at", null)
      .in("role", ["admin", "agent"])
      .order("full_name"),
    supabase.from("tenants").select("timezone").maybeSingle(),
  ]);
  const members = (team ?? []) as TeamMember[];
  const tz = (tenant as { timezone?: string } | null)?.timezone || DEFAULT_TZ;
  const today = todayKey(tz);
  const week = parseWeek(searchParams.week, today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  // Whose calendar: "me" (default for team members), "all", "none" or an id.
  const isMember = Boolean(membership);
  const requested = searchParams.agent;
  const agent =
    requested === "all" || requested === "none" || members.some((m) => m.id === requested)
      ? requested!
      : requested === "me" && isMember
        ? "me"
        : isMember
          ? "me"
          : "all";
  const agentId = agent === "me" ? membership!.id : agent;

  // This week plus the next few, for the "coming weeks" strip.
  const until = addDays(week, 7 * WEEKS_AHEAD);
  const bounds = queryBounds(week, until);
  let query = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .neq("status", "cancelled")
    .gte("starts_at", bounds.from)
    .lt("starts_at", bounds.to)
    .order("starts_at");
  if (agentId === "none") query = query.is("agent_id", null);
  else if (agentId !== "all") query = query.eq("agent_id", agentId);
  const { data, error } = await query;

  const rows = ((data ?? []) as unknown as Appointment[]).filter((a) => {
    const k = dayKey(a.starts_at, tz);
    return k >= week && k < until;
  });
  const thisWeek = rows.filter((a) => dayKey(a.starts_at, tz) < addDays(week, 7));
  const byDay = groupByDay(thisWeek, tz);

  const link = (p: { week?: string; agent?: string }) => {
    const q = new URLSearchParams();
    const w = p.week ?? week;
    if (w !== weekStart(today)) q.set("week", w);
    const ag = p.agent ?? agent;
    if (ag !== (isMember ? "me" : "all")) q.set("agent", ag);
    const qs = q.toString();
    return `/dashboard/calendar${qs ? `?${qs}` : ""}`;
  };

  const who =
    agent === "me"
      ? "Your viewings"
      : agent === "all"
        ? "The whole team's viewings"
        : agent === "none"
          ? "Viewings nobody has been given yet"
          : `${personName(members.find((m) => m.id === agent))}'s viewings`;

  const agentOptions = [
    ...(isMember ? [{ value: "me", label: "My calendar" }] : []),
    { value: "all", label: "Whole team" },
    ...members.filter((m) => m.id !== membership?.id).map((m) => ({ value: m.id, label: personName(m) })),
    { value: "none", label: "Unassigned" },
  ];

  // Coming weeks strip.
  const weekStarts = Array.from({ length: WEEKS_AHEAD }, (_, i) => addDays(week, 7 * i));
  const perWeek = weekStarts.map((ws) => rows.filter((a) => weekStart(dayKey(a.starts_at, tz)) === ws).length);
  const busiest = Math.max(1, ...perWeek);

  return (
    <div>
      <PageHeader
        title="Calendar"
        description={`${who}, week by week. Open a viewing to see the property, its photos and the address.`}
        actions={<AgentSelect options={agentOptions} value={agent} basePath="/dashboard/calendar" label="Show" />}
      />

      {error && <p className="mb-4 text-[13px] text-alert">Couldn&apos;t load viewings: {error.message}</p>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <a href={link({ week: addDays(week, -7) })} className={`${btn.ghost} !px-2`} aria-label="Previous week">
            <ChevronLeft size={16} aria-hidden="true" />
          </a>
          <h2 className="m-0 min-w-[170px] text-center text-[15px] font-semibold text-ink">{weekLabel(week)}</h2>
          <a href={link({ week: addDays(week, 7) })} className={`${btn.ghost} !px-2`} aria-label="Next week">
            <ChevronRight size={16} aria-hidden="true" />
          </a>
          {week !== weekStart(today) && (
            <a href={link({ week: weekStart(today) })} className={`${btn.secondary} ${btn.small} ml-1`}>
              This week
            </a>
          )}
        </div>
        <p className="m-0 text-[13px] text-gray-600">
          <span className="tabular text-ink">{thisWeek.length}</span> viewing{thisWeek.length === 1 ? "" : "s"} this week
          {agent === "all" && thisWeek.some((a) => !a.agent) && (
            <>
              , <span className="font-medium text-brass-dark">{thisWeek.filter((a) => !a.agent).length} without an agent</span>
            </>
          )}
          .
        </p>
      </div>

      {agent === "all" ? (
        <TeamWeek days={days} today={today} tz={tz} members={members} appointments={thisWeek} agentLink={(id) => link({ agent: id })} />
      ) : (
        <AgentWeek days={days} today={today} tz={tz} byDay={byDay} />
      )}

      <section className="mt-8" aria-label="Coming weeks">
        <h2 className="m-0 mb-2 text-[14px] font-semibold text-ink">Coming weeks</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {weekStarts.map((ws, i) => (
            <a
              key={ws}
              href={link({ week: ws })}
              aria-current={ws === week ? "true" : undefined}
              className={`block rounded-[18px] border bg-white shadow-card px-3 py-2.5 no-underline hover:border-ink-400 ${ws === week ? "border-accent ring-1 ring-accent" : "border-gray-200"}`}
            >
              <div className="text-[12px] text-gray-500">
                {ws === weekStart(today) ? "This week" : weekLabel(ws).replace(/ \d{4}$/, "")}
              </div>
              <div className="tabular text-[18px] font-semibold text-ink">{perWeek[i]}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(perWeek[i] / busiest) * 100}%` }} />
              </div>
              <div className="mt-1 text-[11.5px] text-gray-500">viewing{perWeek[i] === 1 ? "" : "s"}</div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

// One person's week: a column per day, each viewing as a card with the property.
function AgentWeek({ days, today, tz, byDay }: { days: string[]; today: string; tz: string; byDay: Map<string, Appointment[]> }) {
  return (
    <div className="grid gap-3 md:grid-cols-7 md:gap-2">
      {days.map((day) => {
        const list = byDay.get(day) ?? [];
        const isToday = day === today;
        const past = day < today;
        return (
          <section
            key={day}
            className={`min-w-0 rounded-[18px] border bg-white shadow-card ${isToday ? "border-accent ring-1 ring-accent" : "border-gray-200"} ${past ? "opacity-70" : ""}`}
          >
            <h3 className={`m-0 border-b border-gray-100 px-3 py-2 text-[13px] font-medium ${isToday ? "text-ink" : "text-gray-600"}`}>
              {isToday ? "Today" : dayLabel(day, "weekday")} <span className="tabular text-gray-400">{Number(day.slice(8))}</span>
              {list.length > 0 && <span className="tabular float-right text-[12px] text-gray-400">{list.length}</span>}
            </h3>
            <div className="grid gap-2 p-2 md:min-h-[160px]">
              {list.length === 0 ? (
                <p className="m-0 px-1 py-1 text-[12.5px] text-gray-400">Free</p>
              ) : (
                list.map((a) => (
                  <a
                    key={a.id}
                    href={`/dashboard/appointments/${a.id}`}
                    className="block min-w-0 rounded-md border border-gray-200 p-2 no-underline hover:border-ink-400 hover:bg-gray-50"
                  >
                    <div className="tabular text-[12.5px] font-medium text-ink">{timeRange(a, tz)}</div>
                    <div className="mb-1.5 truncate text-[12.5px] text-gray-600">{a.contact?.name || a.contact?.email || "Client"}</div>
                    <div className="md:hidden">
                      <ListingLine appointment={a} />
                    </div>
                    <CompactListing appointment={a} />
                  </a>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// Narrow-column version of the property: photo on top, then title and area.
function CompactListing({ appointment }: { appointment: Appointment }) {
  const l = appointment.listing;
  return (
    <div className="hidden md:block">
      {l ? (
        <>
          <div className="mb-1">
            <ListingThumb listing={l} className="aspect-[3/2] h-auto w-full max-w-full" />
          </div>
          <div className="truncate text-[12px] text-ink">{l.title}</div>
          <div className="truncate text-[11.5px] text-gray-500">{[l.address, l.district].filter(Boolean).join(", ") || l.city || ""}</div>
        </>
      ) : (
        <div className="text-[11.5px] text-gray-400">Property not set</div>
      )}
    </div>
  );
}

// Everyone at once: a row per agent, a column per day.
function TeamWeek({
  days,
  today,
  tz,
  members,
  appointments,
  agentLink,
}: {
  days: string[];
  today: string;
  tz: string;
  members: TeamMember[];
  appointments: Appointment[];
  agentLink: (id: string) => string;
}) {
  const rows: { id: string; name: string; list: Appointment[] }[] = members.map((m) => ({
    id: m.id,
    name: personName(m),
    list: appointments.filter((a) => a.agent_id === m.id),
  }));
  const unassigned = appointments.filter((a) => !a.agent_id || !members.some((m) => m.id === a.agent_id));
  if (unassigned.length) rows.push({ id: "none", name: "Unassigned", list: unassigned });

  const nameOf = (a: Appointment) => (a.agent ? personName(a.agent) : "Unassigned");
  const byDayAll = groupByDay(appointments, tz);

  return (
    <>
      {/* Phone: each day with its viewings and who's going */}
      <div className="grid gap-3 md:hidden">
        {days.map((d) => {
          const list = byDayAll.get(d) ?? [];
          return (
            <section key={d} className={`rounded-[18px] border bg-white shadow-card ${d === today ? "border-accent" : "border-gray-200"}`}>
              <h3 className="m-0 border-b border-gray-100 px-3 py-2 text-[13px] font-medium text-ink">
                {d === today ? "Today, " : ""}
                {dayLabel(d)}
              </h3>
              {list.length === 0 ? (
                <p className="m-0 px-3 py-2 text-[12.5px] text-gray-400">No viewings</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {list.map((a) => (
                    <li key={a.id} className="border-t border-gray-100 first:border-t-0">
                      <a href={`/dashboard/appointments/${a.id}`} className="block px-3 py-2.5 no-underline">
                        <div className="mb-1.5 flex justify-between gap-2 text-[13px]">
                          <span className="text-ink">
                            <span className="tabular font-medium">{timeRange(a, tz)}</span> ·{" "}
                            {a.contact?.name || a.contact?.email || "Client"}
                          </span>
                          <span className={`flex-shrink-0 ${a.agent ? "text-gray-600" : "font-medium text-brass-dark"}`}>{nameOf(a)}</span>
                        </div>
                        <ListingLine appointment={a} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto card md:block">
        <table className="w-full min-w-[980px] table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[12px] text-gray-500">
              <th className="sticky left-0 z-[1] w-[170px] bg-gray-50 px-3 py-2 font-medium">Agent</th>
              {days.map((d) => (
                <th key={d} className={`px-2 py-2 font-medium ${d === today ? "text-ink" : ""}`}>
                  {d === today ? "Today" : dayLabel(d, "weekday")} <span className="tabular text-gray-400">{Number(d.slice(8))}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const byDay = groupByDay(r.list, tz);
              return (
                <tr key={r.id} className="border-b border-gray-100 align-top last:border-b-0">
                  <th scope="row" className="sticky left-0 z-[1] bg-white px-3 py-2.5 text-[13px] font-normal">
                    <a
                      href={agentLink(r.id)}
                      className={`font-medium no-underline hover:underline ${r.id === "none" ? "text-brass-dark" : "text-ink"}`}
                    >
                      {r.name}
                    </a>
                    <div className="tabular text-[12px] text-gray-500">
                      {r.list.length} viewing{r.list.length === 1 ? "" : "s"}
                    </div>
                  </th>
                  {days.map((d) => (
                    <td key={d} className={`px-1.5 py-2 ${d === today ? "bg-accent-soft/60" : ""}`}>
                      <div className="grid gap-1">
                        {(byDay.get(d) ?? []).map((a) => (
                          <ViewingChip key={a.id} appointment={a} tz={tz} showListing />
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[13px] text-gray-500">
                  No agents yet. Invite your team in Team.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
