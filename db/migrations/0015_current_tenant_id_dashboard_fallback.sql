-- 0015_current_tenant_id_dashboard_fallback.sql (revised)
--
-- First attempt caused infinite recursion: tenant_users almost certainly has
-- its own RLS policy that also calls current_tenant_id() to scope access, so
-- querying tenant_users FROM current_tenant_id() (as an ordinary caller-
-- privileged function) triggered current_tenant_id() again inside that
-- policy check, forever -> "stack depth limit exceeded".
--
-- Fix: mark this function SECURITY DEFINER so the internal tenant_users
-- lookup runs as the function owner (postgres, which bypasses RLS in
-- Supabase) instead of the caller -- breaking the recursive chain. This is
-- safe: the only thing this internal lookup does is resolve "which tenant
-- does this authenticated user belong to", not expose any additional data.

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    nullif(current_setting('app.current_tenant', true), '')::uuid,
    (select tenant_id from tenant_users where auth_user_id = auth.uid() limit 1)
  );
$function$;
