import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import OnboardingForm from "./onboarding-form";
import { Notice, PageHeader } from "../../../_ui/ui";

export default async function OnboardingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  if (!isAdminEmail(user.email)) {
    return (
      <div>
        <PageHeader title="New tenant" />
        <Notice tone="alert">Only platform admins can add new businesses.</Notice>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="New tenant" description="Add a new business to Elliot. You'll get the remaining setup steps once it's created." />
      <OnboardingForm />
    </div>
  );
}
