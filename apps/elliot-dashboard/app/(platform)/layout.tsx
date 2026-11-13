import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ElliotLogo } from "@/app/_ui/elliot-logo";
import { getPlatformAdminStatus } from "@/lib/platform-auth";
import PlatformTabs from "./platform-tabs";
import FastLinks from "@/app/_ui/fast-links";

// The control panel: every agency on Elliot, for platform admins only
// (ADMIN_EMAILS). Separate from the agency dashboard on purpose -- different
// audience, different data (it reads across all tenants with the service
// role, after this check). 0040: business figures only; an agency's own data
// is reached through "Open their dashboard", with the agency's permission.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user: signedIn },
  } = await supabase.auth.getUser();
  if (!signedIn) redirect("/login");
  // 0040: platform admins only, and only after the two-step code.
  const admin = await getPlatformAdminStatus();
  if (!admin) notFound();
  if (admin.status !== "ok") redirect("/two-step");
  const user = admin.user;

  return (
    <div className="min-h-screen">
      {/* Stays at the top while the page scrolls. */}
      <header className="navy sticky top-0 z-30 border-b border-white/10 text-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 md:px-8">
          <div className="flex items-center gap-4">
            <ElliotLogo />
            <span className="rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-gold-light">Control panel</span>
          </div>
          <div className="flex items-center gap-4 text-[13px]">
            <span className="hidden text-white/75 sm:inline">{user.email}</span>
            <a href="/" className="rounded-full border border-white/25 px-3.5 py-1.5 text-white no-underline hover:bg-glass-hi">
              My dashboard
            </a>
          </div>
        </div>
        <div className="mx-auto max-w-[1600px] px-4 md:px-8">
          <PlatformTabs />
        </div>
      </header>
      <FastLinks />
      <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
