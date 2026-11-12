// Service-role Supabase client -- SERVER-ONLY. Never import this from a
// "use client" component or anything that ships to the browser.
//
// Uses SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix -- deliberately not
// exposed to the browser) instead of the anon key. The service role bypasses
// Row-Level Security, so it's used only where that's the point, each behind
// its own check:
//   - self-serve signup (a new user has no tenant yet),
//   - the platform control panel and "view as" (ADMIN_EMAILS checked first),
//   - team invites/removal (caller must be an agency admin; needs auth.admin),
//   - GET /api/widget/messages (public; returns only team replies for one
//     conversation that matches the agency slug).
//   - removing a deleted client's stored files (POST /api/contacts/:id/erase;
//     only the paths the database returned after it checked the caller is
//     an admin of that agency), and deleting a cancelled agency (platform).
//
// Everything else in the dashboard goes through the regular anon-key client
// (lib/supabase/client.ts or server.ts) so RLS keeps doing its job.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set SUPABASE_SERVICE_ROLE_KEY " +
        "in Vercel (Production, Preview, Development) from Supabase → Project Settings → API → service_role key."
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
