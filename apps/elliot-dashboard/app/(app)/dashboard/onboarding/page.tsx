import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import OnboardingForm from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  if (!isAdminEmail(user.email)) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-medium">New tenant</h1>
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          You don&apos;t have access to this page. Tenant onboarding is restricted to platform admins.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-medium">New tenant</h1>
      <p className="mb-1 text-sm text-gray-500">Onboard a new business onto Elliot.</p>
      <p className="mb-6 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        This page is now gated to admins listed in ADMIN_EMAILS. The underlying n8n webhook
        (19-tenant-onboarding.json) still has no auth of its own -- someone who finds that URL directly can still
        call it without going through this page at all. This fixes the dashboard-side gap, not that one.
      </p>
      <OnboardingForm />
    </div>
  );
}
