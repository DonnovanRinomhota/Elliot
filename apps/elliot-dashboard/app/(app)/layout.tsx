import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./dashboard/sign-out-button";
import NavLink from "./dashboard/nav-link";
import {
  LayoutDashboard,
  AlertTriangle,
  CheckSquare,
  Users,
  Calendar,
  MessageCircle,
  Settings,
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

  const { data: tenantUser } = await supabase
    .from("tenant_users")
    .select("tenant_id, email, role")
    .eq("auth_user_id", user.id)
    .single();

  const { data: tenant } = tenantUser
    ? await supabase.from("tenants").select("name").eq("id", tenantUser.tenant_id).single()
    : { data: null };

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

  const initials =
    (tenantUser?.email || user.email || "")
      .split("@")[0]
      .split(/[._-]/)
      .map((p: string) => p[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "?";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px",
          borderBottom: "1px solid #eee",
          background: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "#111",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            E
          </div>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{tenant?.name || "Elliot"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "#666" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            Live
          </span>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "#eee",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 500,
            }}
            title={tenantUser?.email || user.email || ""}
          >
            {initials}
          </div>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1 }}>
        <nav
          style={{
            width: 200,
            background: "white",
            borderRight: "1px solid #eee",
            padding: "16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <NavLink href="/" icon={<LayoutDashboard size={15} strokeWidth={2} aria-hidden="true" />} label="Overview" />

          <div>
            <div style={{ fontSize: 11, color: "#999", padding: "0 8px 4px" }}>Needs attention</div>
            <NavLink
              href="/dashboard/escalations"
              icon={<AlertTriangle size={15} strokeWidth={2} aria-hidden="true" />}
              label="Escalations"
              badge={openEscalations}
              badgeTone="danger"
            />
            <NavLink
              href="/dashboard/approvals"
              icon={<CheckSquare size={15} strokeWidth={2} aria-hidden="true" />}
              label="Approvals"
              badge={pendingApprovals}
              badgeTone="warning"
            />
          </div>

          <div>
            <div style={{ fontSize: 11, color: "#999", padding: "0 8px 4px" }}>Customers</div>
            <NavLink href="/dashboard/leads" icon={<Users size={15} strokeWidth={2} aria-hidden="true" />} label="Leads" />
            <NavLink href="/dashboard/appointments" icon={<Calendar size={15} strokeWidth={2} aria-hidden="true" />} label="Appointments" />
            <NavLink href="/dashboard/conversations" icon={<MessageCircle size={15} strokeWidth={2} aria-hidden="true" />} label="Conversations" />
          </div>

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            <NavLink href="/dashboard/settings" icon={<Settings size={15} strokeWidth={2} aria-hidden="true" />} label="Settings" />
            <SignOutButton />
          </div>
        </nav>

        <main style={{ flex: 1, padding: 28 }}>{children}</main>
      </div>
    </div>
  );
}
