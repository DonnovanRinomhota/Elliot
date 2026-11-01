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
      <p className="mb-6 text-sm text-gray-500">Onboard a new business onto Elliot.</p>
      <OnboardingForm />
    </div>
  );
}
