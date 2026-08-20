# Elliot Dashboard

Minimal Next.js dashboard: Supabase Auth login + a Pending Approvals page for
reviewing/approving/rejecting Elliot's email drafts.

## Setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase project settings -> API)
   - `NEXT_PUBLIC_N8N_SEND_WEBHOOK_URL` (the Production URL from workflow 17's webhook node, after you import and activate it)
3. `npm run dev` and open http://localhost:3000

## Known gaps / things to verify before trusting this in real use

1. **RLS on `email_drafts` may not work with this client as-is.** The migration's
   RLS policy checks `tenant_id = current_tenant_id()`, where `current_tenant_id()`
   was built for the n8n/service-role pattern. This dashboard uses the Supabase
   *anon* key plus a real logged-in user's session (via `auth.uid()`), which is a
   different auth context. You likely need either: (a) a version of
   `current_tenant_id()` that also works by looking up `tenant_users` via
   `auth.uid()`, or (b) a separate RLS policy on `email_drafts` specifically for
   authenticated dashboard users, joining through `tenant_users.auth_user_id =
   auth.uid()`. Test this by logging in and confirming the approvals list
   actually loads -- if it comes back empty or errors, this is why.

2. **Workflow 15's final status update is currently hardcoded to `'auto_sent'`**
   regardless of how it was triggered. Since workflow 17 also calls 15 (for
   human-approved sends), those will incorrectly show as `auto_sent` too. Fix:
   in 15's "Update Draft Status" node, use `{{ $('When Executed by Another
   Workflow').first().json.auto ? 'auto_sent' : 'sent' }}` instead of the fixed
   string, so the two paths stay distinguishable.

3. Only the Pending Approvals screen is built. The nav has placeholder text for
   Leads / Appointments / Conversations -- not real links yet, intentionally,
   per the "foundation now, screens later" scope decision.
