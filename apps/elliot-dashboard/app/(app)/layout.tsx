import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getAdminView } from "@/lib/tenant";
import SignOutButton from "./dashboard/sign-out-button";
import NavLink from "./dashboard/nav-link";
import ExitViewAs from "./dashboard/exit-view-as";
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
  const [{ data: tenantUser }, { data: tenant }, adminView] = await Promise.all([
    supabase.from("tenant_users").select("tenant_id, email, role").eq("auth_user_id", user.id).maybeSingle(),
    supabase.from("tenants").select("id, name").maybeSingle(),
    getAdminView(supabase),
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

  const navIcon = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
  const tenantName = tenant?.name || "Elliot";
  const userEmail = tenantUser?.email || user.email || "";
  const isAdmin = isAdminEmail(user.email);

  const navSections = (
    <>
      <NavLink href="/" icon={<LayoutDashboard {...navIcon} />} label="Overview" />

      <div className="mt-5">
        <p className="mb-1 px-2.5 text-[12px] text-gray-400">Needs attention</p>
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
        <p className="mb-1 px-2.5 text-[12px] text-gray-400">Customers</p>
        <NavLink href="/dashboard/leads" icon={<Users {...navIcon} />} label="Leads" />
        <NavLink href="/dashboard/appointments" icon={<Calendar {...navIcon} />} label="Appointments" />
        <NavLink href="/dashboard/calendar" icon={<CalendarDays {...navIcon} />} label="Calendar" />
        <NavLink href="/dashboard/conversations" icon={<MessageCircle {...navIcon} />} label="Conversations" />
        <NavLink href="/dashboard/follow-ups" icon={<Repeat {...navIcon} />} label="Follow-ups" />
      </div>

      <div className="mt-5">
        <p className="mb-1 px-2.5 text-[12px] text-gray-400">Your agency</p>
        <NavLink href="/dashboard/listings" icon={<Home {...navIcon} />} label="Listings" />
        <NavLink href="/dashboard/knowledge" icon={<BookOpen {...navIcon} />} label="Knowledge base" />
        <NavLink href="/dashboard/team" icon={<UserCog {...navIcon} />} label="Team" />
      </div>

      {isAdmin && (
        <div className="mt-5">
          <p className="mb-1 px-2.5 text-[12px] text-gray-400">Platform</p>
          <NavLink href="/platform" icon={<Building2 {...navIcon} />} label="Control panel" />
        </div>
      )}
    </>
  );

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-ink text-[14px] font-semibold text-white"
      >
        {tenantName.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[14px] font-semibold text-ink">{tenantName}</div>
        <div className="text-[12px] text-gray-400">Elliot assistant</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop: full-height sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[240px] flex-shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="border-b border-gray-200 px-4 py-4">{brand}</div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
          {navSections}
        </nav>
        <div className="border-t border-gray-200 px-3 py-3">
          <NavLink href="/dashboard/settings" icon={<Settings {...navIcon} />} label="Settings" />
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2 pl-2.5">
            <span className="min-w-0 truncate text-[12px] text-gray-400" title={userEmail}>
              {userEmail}
            </span>
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* Mobile: top bar with a menu */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white md:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            {brand}
            <span className="rounded-md border border-gray-300 px-2.5 py-1 text-[13px] text-ink">Menu</span>
          </summary>
          <nav aria-label="Main" className="border-t border-gray-200 px-3 pb-4 pt-2">
            {navSections}
            <div className="mt-5 border-t border-gray-200 pt-3">
              <NavLink href="/dashboard/settings" icon={<Settings {...navIcon} />} label="Settings" />
              <SignOutButton />
            </div>
          </nav>
        </details>
      </header>

      <main className="min-w-0 flex-1">
        {adminView && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brass/25 bg-brass-soft px-4 py-2.5 text-[13px] text-brass-dark md:px-10">
            <span>
              You&apos;re viewing <strong className="font-semibold">{tenantName}</strong>&apos;s dashboard as a platform admin. What you change here
              changes for them.
            </span>
            <ExitViewAs />
          </div>
        )}
        <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-10 md:py-9">{children}</div>
      </main>
    </div>
  );
}
