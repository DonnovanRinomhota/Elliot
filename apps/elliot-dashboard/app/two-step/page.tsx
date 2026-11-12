import { notFound, redirect } from "next/navigation";
import { getPlatformAdminStatus } from "@/lib/platform-auth";
import { ElliotLogo } from "@/app/_ui/elliot-logo";
import TwoStepForm from "./two-step-form";

export const dynamic = "force-dynamic";

// 0040: the control panel asks for a code from an authenticator app (Google
// Authenticator, Microsoft Authenticator, 1Password...) on top of the
// password. First visit: set one up. After that: enter the code.
export default async function TwoStepPage() {
  const admin = await getPlatformAdminStatus();
  if (!admin) notFound();
  if (admin.status === "ok") redirect("/platform");

  return (
    <div className="sky flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex justify-center">
          <ElliotLogo className="text-white" />
        </div>
        <div className="card p-6">
          <TwoStepForm mode={admin.status} email={admin.user.email ?? ""} />
        </div>
        <p className="mt-4 text-center text-[12.5px] text-white/70">
          <a href="/" className="text-white/80 underline">
            Back to my dashboard
          </a>
        </p>
      </div>
    </div>
  );
}
