// Server-only guard + audit helper for the platform control panel.
//
// 0040: the control panel needs two-step sign-in (a code from an
// authenticator app, Supabase MFA, "aal2"), not just the password. The
// database enforces the same for "view as" (current_tenant_id()).
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import type { User } from "@supabase/supabase-js";

export type PlatformAdminStatus =
  | { user: User; status: "ok" }
  | { user: User; status: "verify" } // has an authenticator app: enter the code
  | { user: User; status: "enroll" }; // no authenticator app yet: set one up

/** null: not signed in or not in ADMIN_EMAILS. */
export async function getPlatformAdminStatus(): Promise<PlatformAdminStatus | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return null;
  let data: { currentLevel: string | null; nextLevel: string | null } | null = null;
  try {
    ({ data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel());
  } catch {
    data = null; // unreadable session: treat as not verified
  }
  if (data?.currentLevel === "aal2") return { user, status: "ok" };
  const verified = (user.factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified");
  return { user, status: data?.nextLevel === "aal2" || verified ? "verify" : "enroll" };
}

/** The signed-in platform admin, signed in with two-step verification -- or null. */
export async function getPlatformAdmin() {
  const s = await getPlatformAdminStatus();
  return s?.status === "ok" ? s.user : null;
}

/** Records a control-panel action in audit_log (shown under Activity log). */
export async function logPlatformEvent(
  actorEmail: string,
  eventType: string,
  tenantId: string | null,
  details: Record<string, unknown> = {}
) {
  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_type: "system",
    actor_id: actorEmail,
    event_type: eventType,
    details,
  });
}
