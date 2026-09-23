// Service-role Supabase client -- SERVER-ONLY. Never import this from a
// "use client" component or anything that ships to the browser.
//
// Uses SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix -- deliberately not
// exposed to the browser) instead of the anon key. The service role bypasses
// Row-Level Security, which is required exactly once in this app: creating a
// brand-new tenant + its first tenant_users row during self-serve signup,
// before that user has any tenant_id RLS could scope them to yet.
//
// Do not reuse this client for anything else. Every other read/write in the
// dashboard should go through the regular anon-key client (lib/supabase/
// client.ts or server.ts) so RLS keeps doing its job.
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
