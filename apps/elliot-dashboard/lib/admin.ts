/**
 * Platform-admin check for routes/actions that aren't scoped to a single
 * tenant (currently just /dashboard/onboarding -- creating new tenants).
 *
 * There's no role in the schema for this: tenant_users.role ('admin',
 * 'agent', 'viewer') is per-tenant, and nothing distinguishes "runs the
 * platform" from "runs one tenant's account." Rather than add a new table/
 * column for a single-operator product, this is a hardcoded allow-list via
 * env var -- deliberately simple, revisit with a real role/permission if
 * more than one person ever needs platform-admin access.
 *
 * Set ADMIN_EMAILS in Vercel (Production, Preview, and Development) as a
 * comma-separated list, e.g. "you@example.com,cofounder@example.com".
 * Server-only env var (no NEXT_PUBLIC_ prefix) -- never exposed to the
 * browser.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowList = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowList.includes(email.trim().toLowerCase());
}
