import OnboardingForm from "./onboarding-form";

export default function OnboardingPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-medium">New tenant</h1>
      <p className="mb-1 text-sm text-gray-500">Onboard a new business onto Elliot.</p>
      <p className="mb-6 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Internal use only. Anyone logged into any tenant&apos;s dashboard can currently reach this page and
        create new tenants -- there is no platform-admin role or access gate yet (matching the underlying n8n
        webhook, which has no auth either -- see 19-tenant-onboarding.json). Do not share dashboard logins
        with anyone you wouldn&apos;t want creating tenants until that&apos;s addressed.
      </p>
      <OnboardingForm />
    </div>
  );
}
