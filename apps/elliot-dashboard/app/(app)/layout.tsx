import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getAdminView, getMembership } from "@/lib/tenant";
import SignOutButton from "./dashboard/sign-out-button";
import NavLink from "./dashboard/nav-link";
import ExitViewAs from "./dashboard/exit-view-as";
import AskElliot, { AskElliotButton } from "./dashboard/ask-elliot";
import { DEFAULT_TZ, dayKey, timeOf } from "@/lib/appointments";
import {
  LayoutDashboard,
  AlertTriangle,
  CheckSquare,
  Users,
  Calendar,
  CalendarDays,
  MessageCircle,
  Settings,
  BookOpen,
  Repeat,
  Inbox,
  Home,
  UserCog,
  Building2,
} from "lucide-react";

// Auth-gated layout for every real dashboard route (/ , /dashboard/*).
// Lives in the (app) route group specifically so /login -- a sibling
// route OUTSIDE this group -- never goes through this check. See
// app/layout.tsx (the true root) for why that split exists.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS returns only the agency this session is looking at: the user's own,
  // or the one a platform admin chose with "Open their dashboard".
  const [{ data: tenantUser }, { data: tenant }, adminView, me] = await Promise.all([
    supabase.from("tenant_users").select("tenant_id, email, role, full_name").eq("auth_user_id", user.id).maybeSingle(),
    supabase.from("tenants").select("id, name, timezone").maybeSingle(),
    getAdminView(supabase),
    getMembership(supabase, user.id),
  ]);

  // Badge counts -- RLS scopes both to the logged-in user's tenant automatically,
  // same assumption the rest of the dashboard already relies on.
  const { count: openEscalations } = await supabase
    .from("escalations")
    .select("id", { count: "exact", head: true })
    .neq("status", "resolved");

  const { count: pendingApprovals } = await supabase
    .from("email_drafts")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  // "Your day": today's viewings for the signed-in agent (the whole agency
  // when a platform admin is looking), done so far and what's next.
  const tz = (tenant as { timezone?: string } | null)?.timezone || DEFAULT_TZ;
  const now = new Date();
  let dayQuery = supabase
    .from("appointments")
    .select("id, starts_at, ends_at, contact:contacts(name)")
    .in("status", ["confirmed", "completed", "rescheduled"])
    .gte("starts_at", new Date(now.getTime() - 26 * 3600 * 1000).toISOString())
    .lte("starts_at", new Date(now.getTime() + 26 * 3600 * 1000).toISOString())
    .order("starts_at");
  if (me && !adminView) dayQuery = dayQuery.eq("agent_id", me.id);
  const { data: dayRows } = await dayQuery;
  const today = dayKey(now, tz);
  const todays = ((dayRows ?? []) as unknown as { id: string; starts_at: string; ends_at: string; contact: { name: string | null } | null }[]).filter(
    (a) => dayKey(a.starts_at, tz) === today
  );
  const doneToday = todays.filter((a) => new Date(a.ends_at) <= now).length;
  const nextViewing = todays.find((a) => new Date(a.ends_at) > now);

  const navIcon = { size: 17, strokeWidth: 1.75, "aria-hidden": true } as const;
  const tenantName = tenant?.name || "Elliot";
  const userEmail = tenantUser?.email || user.email || "";
  const isAdmin = isAdminEmail(user.email);

  const navSections = (
    <>
      <NavLink href="/" icon={<LayoutDashboard {...navIcon} />} label="Overview" />

      <div className="mt-5">
        <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.06em] text-gray-400">Needs attention</p>
        <NavLink href="/dashboard/inbox" icon={<Inbox {...navIcon} />} label="Inbox" badge={openEscalations} badgeTone="danger" />
        <NavLink
          href="/dashboard/escalations"
          icon={<AlertTriangle {...navIcon} />}
          label="Escalations"
        />
        <NavLink
          href="/dashboard/approvals"
          icon={<CheckSquare {...navIcon} />}
          label="Approvals"
          badge={pendingApprovals}
          badgeTone="warning"
        />
      </div>

      <div className="mt-5">
        <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.06em] text-gray-400">Customers</p>
        <NavLink href="/dashboard/leads" icon={<Users {...navIcon} />} label="Leads" />
        <NavLink href="/dashboard/appointments" icon={<Calendar {...navIcon} />} label="Appointments" />
        <NavLink href="/dashboard/calendar" icon={<CalendarDays {...navIcon} />} label="Calendar" />
        <NavLink href="/dashboard/conversations" icon={<MessageCircle {...navIcon} />} label="Conversations" />
        <NavLink href="/dashboard/follow-ups" icon={<Repeat {...navIcon} />} label="Follow-ups" />
      </div>

      <div className="mt-5">
        <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.06em] text-gray-400">Your agency</p>
        <NavLink href="/dashboard/listings" icon={<Home {...navIcon} />} label="Listings" />
        <NavLink href="/dashboard/knowledge" icon={<BookOpen {...navIcon} />} label="Knowledge base" />
        <NavLink href="/dashboard/team" icon={<UserCog {...navIcon} />} label="Team" />
      </div>

      {isAdmin && (
        <div className="mt-5">
          <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.06em] text-gray-400">Platform</p>
          <NavLink href="/platform" icon={<Building2 {...navIcon} />} label="Control panel" />
        </div>
      )}
    </>
  );

  const displayName = me?.full_name || (tenantUser as { full_name?: string | null } | null)?.full_name || userEmail.split("@")[0];
  const initials = displayName
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0]!.toUpperCase())
    .join("");

  const yourDay = (
    <a href="/dashboard/calendar" className="block rounded-2xl bg-gray-50 px-3.5 py-3 no-underline hover:bg-gray-100">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">Your day</span>
        <span className="tabular text-[12px] text-gray-500">
          {todays.length ? `${doneToday} of ${todays.length} viewings done` : "No viewings"}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${todays.length ? (doneToday / todays.length) * 100 : 0}%` }} />
      </div>
      <p className="m-0 mt-2 truncate text-[12px] text-gray-500">
        {nextViewing
          ? `Next: ${timeOf(nextViewing.starts_at, tz)}${nextViewing.contact?.name ? `, ${nextViewing.contact.name}` : ""}`
          : todays.length
            ? "All done for today"
            : "Nothing booked for today"}
      </p>
    </a>
  );

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-ink text-[15px] font-semibold text-white"
      >
        {tenantName.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">{tenantName}</div>
        <div className="text-[12px] text-gray-500">Elliot assistant</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop: a floating sidebar card */}
      <aside className="sticky top-0 hidden h-screen w-[268px] flex-shrink-0 p-3 pr-0 md:block">
        <div className="flex h-full flex-col rounded-[22px] border border-[#e8ebf1] bg-white shadow-card">
          <div className="px-4 pb-3 pt-4">{brand}</div>
          <div className="px-3">
            <AskElliotButton />
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
            {navSections}
          </nav>
          <div className="grid gap-2 px-3 pb-3">
            {yourDay}
            <NavLink href="/dashboard/settings" icon={<Settings {...navIcon} />} label="Settings" />
            <div className="flex min-w-0 items-center gap-2.5 rounded-2xl px-2 py-1.5">
              <span aria-hidden="true" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-dark">
                {initials || "?"}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-medium text-ink">{displayName}</span>
                <span className="block truncate text-[11.5px] text-gray-500" title={userEmail}>
                  {userEmail}
                </span>
              </span>
              <SignOutButton />
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile: top bar with a menu */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white md:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            {brand}
            <span className="rounded-full border border-gray-200 px-3 py-1 text-[13px] text-ink">Menu</span>
          </summary>
          <nav aria-label="Main" className="border-t border-gray-200 px-3 pb-4 pt-3">
            <AskElliotButton />
            <div className="mt-4">{navSections}</div>
            <div className="mt-5 grid gap-2 border-t border-gray-200 pt-3">
              {yourDay}
              <NavLink href="/dashboard/settings" icon={<Settings {...navIcon} />} label="Settings" />
              <SignOutButton />
            </div>
          </nav>
        </details>
      </header>

      <main className="min-w-0 flex-1">
        {adminView && (
          <div className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brass/25 bg-brass-soft px-4 py-2.5 text-[13px] text-brass-dark md:ml-6 md:mr-3">
            <span>
              You&apos;re viewing <strong className="font-semibold">{tenantName}</strong>&apos;s dashboard as a platform admin. What you change here
              changes for them.
            </span>
            <ExitViewAs />
          </div>
        )}
        <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>

      {/* The built-in assistant: opened from the sidebar box, Ctrl/Cmd+K or "/". */}
      <AskElliot />
    </div>
  );
}
