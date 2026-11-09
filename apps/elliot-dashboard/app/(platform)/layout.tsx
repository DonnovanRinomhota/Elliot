import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ElliotMark } from "@/app/_ui/elliot-logo";
import { isAdminEmail } from "@/lib/admin";
import PlatformTabs from "./platform-tabs";

// The control panel: every agency on Elliot, for platform admins only
// (ADMIN_EMAILS). Separate from the agency dashboard on purpose -- different
// audience, different data (it reads across all tenants with the service
// role, after this check).
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) notFound();

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-800 bg-ink text-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 md:px-8">
          <div className="flex items-center gap-2.5">
            <ElliotMark size={32} />
            <div className="leading-tight">
              <div className="text-[14px] font-semibold">Elliot</div>
              <div className="text-[12px] text-ink-200">Control panel</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[13px]">
            <span className="hidden text-ink-200 sm:inline">{user.email}</span>
            <a href="/" className="rounded-md border border-white/25 px-3 py-1.5 text-white no-underline hover:bg-white/10">
              My dashboard
            </a>
          </div>
        </div>
        <div className="mx-auto max-w-[1600px] px-4 md:px-8">
          <PlatformTabs />
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
