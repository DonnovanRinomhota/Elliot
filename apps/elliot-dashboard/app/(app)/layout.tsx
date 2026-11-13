import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ElliotLogo, ElliotMark } from "@/app/_ui/elliot-logo";
import { isAdminEmail } from "@/lib/admin";
import { getAdminView, getMembership } from "@/lib/tenant";
import SignOutButton from "./dashboard/sign-out-button";
import NavLink from "./dashboard/nav-link";
import ExitViewAs from "./dashboard/exit-view-as";
import AskElliot, { AskElliotButton } from "./dashboard/ask-elliot";
import { DEFAULT_TZ, dayKey, timeOf } from "@/lib/appointments";
import { untilLabel } from "@/lib/support-access";
import { trialBanner, type TrialFields } from "@/lib/trial";
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
  const [{ data: tenantUser }, { data: tenant }, adminView, me, { data: supportGrant }] = await Promise.all([
    supabase.from("tenant_users").select("tenant_id, email, role, full_name").eq("auth_user_id", user.id).maybeSingle(),
    supabase.from("tenants").select("id, name, timezone, assistant_mode, plan, status, trial_started_at, trial_ends_at").maybeSingle(),
    getAdminView(supabase),
    getMembership(supabase, user.id),
    // 0040: how long the agency's permission lasts, for the "viewing" banner.
    supabase.from("support_access_grants").select("expires_at").maybeSingle(),
  ]);

  // Badge counts -- RLS scopes both to the logged-in user's tenant automatically,
  // same assumption the rest of the dashboard already relies on.
  const { count: openEscalations } = await supabase
    .from("escalations")
    .select("id", { count: "exact", head: true })
    .neq("status", "resolved");

  // Emails and WhatsApp messages waiting for approval (the Approvals page shows both).
  const [{ count: pendingEmails }, { count: pendingWhatsapp }] = await Promise.all([
    supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("whatsapp_drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const pendingApprovals = (pendingEmails ?? 0) + (pendingWhatsapp ?? 0);
  // 0050: the agency's trial, if one is running or has ended.
  const trial = trialBanner(tenant as TrialFields | null);

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
        <p className="mb-1.5 px-3 text-[10.5px] font-medium uppercase tracking-[0.2em] text-white/40">Needs attention</p>
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
        <p className="mb-1.5 px-3 text-[10.5px] font-medium uppercase tracking-[0.2em] text-white/40">Customers</p>
        <NavLink href="/dashboard/leads" icon={<Users {...navIcon} />} label="Leads" />
        <NavLink href="/dashboard/appointments" icon={<Calendar {...navIcon} />} label="Appointments" />
        <NavLink href="/dashboard/calendar" icon={<CalendarDays {...navIcon} />} label="Calendar" />
        <NavLink href="/dashboard/conversations" icon={<MessageCircle {...navIcon} />} label="Conversations" />
        <NavLink href="/dashboard/follow-ups" icon={<Repeat {...navIcon} />} label="Follow-ups" />
      </div>

      <div className="mt-5">
        <p className="mb-1.5 px-3 text-[10.5px] font-medium uppercase tracking-[0.2em] text-white/40">Your agency</p>
        <NavLink href="/dashboard/listings" icon={<Home {...navIcon} />} label="Listings" />
        <NavLink href="/dashboard/knowledge" icon={<BookOpen {...navIcon} />} label="Knowledge base" />
        <NavLink href="/dashboard/team" icon={<UserCog {...navIcon} />} label="Team" />
      </div>

      {isAdmin && (
        <div className="mt-5">
          <p className="mb-1.5 px-3 text-[10.5px] font-medium uppercase tracking-[0.2em] text-white/40">Platform</p>
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
    <a href="/dashboard/calendar" className="block rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-3 no-underline hover:bg-glass-hi">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-white">Your day</span>
        <span className="tabular text-[12px] text-white/60">
          {todays.length ? `${doneToday} of ${todays.length} viewings done` : "No viewings"}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
        <div className="gold-fill h-full rounded-full" style={{ width: `${todays.length ? (doneToday / todays.length) * 100 : 0}%` }} />
      </div>
      <p className="m-0 mt-2 truncate text-[12px] text-white/60">
        {nextViewing
          ? `Next: ${timeOf(nextViewing.starts_at, tz)}${nextViewing.contact?.name ? `, ${nextViewing.contact.name}` : ""}`
          : todays.length
            ? "All done for today"
            : "Nothing booked for today"}
      </p>
    </a>
  );

  const brand = <ElliotLogo size={28} color="#eef2f9" />;

  // The agency this dashboard belongs to.
  const agency = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#1d4b8f,#2f6bff)] text-[13px] font-bold text-white"
      >
        {tenantName.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13.5px] font-semibold text-white">{tenantName}</div>
        <div className="flex items-center gap-1 text-[11.5px] text-white/55">
          <ElliotMark size={11} />
          Elliot assistant
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop: the navy sidebar, as in the website's colours */}
      <aside className="navy sticky top-0 z-20 hidden h-screen w-[256px] flex-shrink-0 shadow-[12px_0_40px_-22px_rgba(3,24,58,0.7)] md:block">
        <div className="flex h-full flex-col">
          <div className="px-6 pb-4 pt-6">{brand}</div>
          <div className="px-4">
            <AskElliotButton />
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
            {navSections}
          </nav>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 px-3 pb-4">
            {yourDay}
            <NavLink href="/dashboard/settings" icon={<Settings {...navIcon} />} label="Settings" />
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
              {agency}
              <div className="mt-3 flex min-w-0 items-center gap-2.5 border-t border-white/10 pt-3">
                <span aria-hidden="true" className="gold-fill flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold text-navy">
                  {initials || "?"}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-medium text-white">{displayName}</span>
                  <span className="block truncate text-[11.5px] text-white/55" title={userEmail}>
                    {userEmail}
                  </span>
                </span>
                <SignOutButton />
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile: navy top bar with a menu */}
      <header className="navy sticky top-0 z-20 md:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 [&::-webkit-details-marker]:hidden">
            {brand}
            <span className="rounded-full border border-white/25 px-3 py-1 text-[13px] text-white">Menu</span>
          </summary>
          <nav aria-label="Main" className="max-h-[calc(100vh-58px)] overflow-y-auto border-t border-white/10 px-3 pb-4 pt-3">
            <AskElliotButton />
            <div className="mt-4">{navSections}</div>
            <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-2 border-t border-white/10 pt-3">
              {agency}
              {yourDay}
              <NavLink href="/dashboard/settings" icon={<Settings {...navIcon} />} label="Settings" />
              <SignOutButton />
            </div>
          </nav>
        </details>
      </header>

      <main className="min-w-0 flex-1">
        {adminView && (
          <div className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brass/25 bg-brass-soft px-4 py-2.5 text-[13px] text-brass-dark md:ml-6 md:mr-6">
            <span>
              You&apos;re viewing <strong className="font-semibold">{tenantName}</strong>&apos;s dashboard
              {supportGrant?.expires_at && (tenant as { assistant_mode?: string } | null)?.assistant_mode === "agency"
                ? ` with their permission (until ${untilLabel(supportGrant.expires_at, tz)})`
                : ""}
              . What you change here changes for them, and they see each part you open in Settings.
            </span>
            <ExitViewAs />
          </div>
        )}
        {trial && (
          <div
            role={trial.tone === "alert" ? "alert" : "status"}
            className={`mx-3 mt-3 rounded-2xl border px-4 py-2.5 text-[13px] md:ml-6 md:mr-6 ${
              trial.tone === "alert"
                ? "border-alert/25 bg-alert-soft text-alert-dark"
                : trial.tone === "warning"
                  ? "border-brass/25 bg-brass-soft text-brass-dark"
                  : "border-gray-200 bg-glass text-gray-600"
            }`}
          >
            {trial.text}
          </div>
        )}
        <div className="w-full max-w-[1760px] px-4 py-6 md:px-6 md:py-7 lg:px-7">{children}</div>
      </main>

      {/* The built-in assistant: opened from the sidebar box, Ctrl/Cmd+K or "/". */}
      <AskElliot />
    </div>
  );
}
