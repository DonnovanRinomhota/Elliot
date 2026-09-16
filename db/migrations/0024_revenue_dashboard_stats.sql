-- 0024_revenue_dashboard_stats.sql
--
-- "AI Revenue" dashboard: turns lead/appointment counts into an estimated
-- pipeline/closed value, so the Overview reads "Elliot generated an
-- estimated €X pipeline" instead of just "Elliot answered 500
-- conversations." There is no deal-value data anywhere in the schema
-- (leads and appointments both deliberately have no price/commission
-- field -- this product spans real estate, dental, and whatever else a
-- tenant does, where deal sizes have nothing in common), so this has to
-- be a per-tenant assumption the tenant sets themselves, not a computed
-- fact. If they never set one, this returns nulls rather than guessing a
-- number and presenting it as real -- an invented average would be worse
-- than no estimate at all.

alter table tenants
  add column if not exists avg_deal_value numeric check (avg_deal_value >= 0);

comment on column tenants.avg_deal_value is
  'Tenant-entered estimate of average revenue/commission per converted lead, in their own currency (no currency field exists yet -- assumed to match whatever the tenant is thinking in, shown unlabeled in the UI). Null until the tenant sets it in Settings; revenue estimates are not computed until then.';

create or replace function public.get_revenue_dashboard_stats(p_days int default 30)
returns table (
    avg_deal_value              numeric,
    qualified_leads_count       bigint,
    converted_leads_count       bigint,
    completed_appointments_count bigint,
    estimated_pipeline_value    numeric,
    estimated_closed_value      numeric
)
language sql
stable
security definer
set search_path = public
as $$
    with tid as (
        select current_tenant_id() as id
    ),
    since as (
        select now() - (p_days || ' days')::interval as ts
    ),
    deal_value as (
        select t.avg_deal_value as v from tenants t, tid where t.id = tid.id
    ),
    -- "Qualified" = actively in the pipeline and not yet resolved either
    -- way (QUALIFYING/HOT/WARM), matching the distinction the lead-scoring
    -- reasoning UI already draws -- not the same count as "new leads" on
    -- the main Overview, which includes everything regardless of status.
    qualified as (
        select count(*) as n from leads, tid, since
        where leads.tenant_id = tid.id and leads.status in ('QUALIFYING', 'HOT', 'WARM')
          and leads.created_at >= since.ts
    ),
    converted as (
        select count(*) as n from leads, tid, since
        where leads.tenant_id = tid.id and leads.status = 'CONVERTED'
          and leads.created_at >= since.ts
    ),
    completed_appts as (
        select count(*) as n from appointments, tid, since
        where appointments.tenant_id = tid.id and appointments.status = 'completed'
          and appointments.created_at >= since.ts
    )
    select
        (select v from deal_value) as avg_deal_value,
        (select n from qualified) as qualified_leads_count,
        (select n from converted) as converted_leads_count,
        (select n from completed_appts) as completed_appointments_count,
        -- Deliberately null (not 0) when avg_deal_value isn't set -- 0 would
        -- read as "Elliot generated €0", which is a false claim, not an
        -- honest "we don't know yet."
        case when (select v from deal_value) is not null
            then (select n from qualified) * (select v from deal_value)
            else null end as estimated_pipeline_value,
        case when (select v from deal_value) is not null
            then (select n from converted) * (select v from deal_value)
            else null end as estimated_closed_value;
$$;

comment on function public.get_revenue_dashboard_stats(int) is
    'Revenue estimate for the dashboard. Tenant-scoped via current_tenant_id(), same fail-closed pattern as get_dashboard_overview_stats (0021). Returns null estimates (not zero) when the tenant has not set avg_deal_value -- an assumed number, never a computed fact, and never invented on this function''s own initiative.';
