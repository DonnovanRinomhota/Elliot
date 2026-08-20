import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Confirms this auth user is linked to a tenant -- also gives us tenant context
  // for anything the layout itself needs later (e.g. showing tenant name).
  const { data: tenantUser } = await supabase
    .from("tenant_users")
    .select("tenant_id, email, role")
    .eq("auth_user_id", user.id)
    .single();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav
        style={{
          width: 220,
          background: "white",
          borderRight: "1px solid #eee",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, marginBottom: 24 }}>Elliot</h2>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>{tenantUser?.email}</div>

          <a href="/dashboard/approvals" style={{ display: "block", padding: "8px 0", fontSize: 14, color: "#111" }}>
            Pending Approvals
          </a>
          {/* Placeholder nav items -- not built yet, kept here as a visible map of what's coming. */}
          <span style={{ display: "block", padding: "8px 0", fontSize: 14, color: "#bbb" }}>Leads (soon)</span>
          <span style={{ display: "block", padding: "8px 0", fontSize: 14, color: "#bbb" }}>Appointments (soon)</span>
          <span style={{ display: "block", padding: "8px 0", fontSize: 14, color: "#bbb" }}>Conversations (soon)</span>
        </div>
        <SignOutButton />
      </nav>

      <main style={{ flex: 1, padding: 32 }}>{children}</main>
    </div>
  );
}
