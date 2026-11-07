-- 0030_appointment_listing_and_agent.sql
--
-- Each viewing knows which property it's for and which agent is doing it.
--   - appointments.listing_id: the listing being viewed. Elliot passes it when
--     it books (workflow 12, from search_listings). If it doesn't, a listing
--     reference written in the booking notes (e.g. "Viewing W-101") is used,
--     as long as exactly one listing matches.
--   - appointments.agent_id: the team member doing the viewing. Defaults to
--     whoever owns the client's lead (the round-robin owner from 0027).
--   - Both can be changed on the appointment's page in the dashboard.
--   - Existing appointments are filled in the same way, once.
--
-- One transaction; safe to run again.

begin;

alter table appointments add column if not exists listing_id uuid references listings(id) on delete set null;
alter table appointments add column if not exists agent_id   uuid references tenant_users(id) on delete set null;

create index if not exists idx_appointments_listing    on appointments(listing_id);
create index if not exists idx_appointments_agent_time on appointments(agent_id, starts_at);

comment on column appointments.listing_id is 'The listing being viewed. Set by workflow 12 from search_listings, guessed from a reference in the notes, or picked in the dashboard.';
comment on column appointments.agent_id is 'Team member doing the viewing. Defaults to the owner of the client''s lead; can be changed in the dashboard.';

-- ── The one listing whose reference appears in a piece of text ──
-- References shorter than 3 characters are ignored (too easy to match by
-- accident, e.g. "2" in "2 rooms"). More than one match = no guess.
create or replace function listing_from_text(p_tenant_id uuid, p_text text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    with hits as (
        select l.id
        from listings l
        where l.tenant_id = p_tenant_id
          and l.reference is not null
          and length(l.reference) >= 3
          and p_text ~* ('(^|[^[:alnum:]])'
                         || regexp_replace(l.reference, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
                         || '($|[^[:alnum:]])')
        limit 2
    )
    select case when (select count(*) from hits) = 1 then (select id from hits) end;
$$;

revoke all on function listing_from_text(uuid, text) from public, anon, authenticated;

-- ── Fill in and check listing + agent ──
create or replace function fill_appointment_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- A listing or agent from another agency is never accepted.
    if new.listing_id is not null
       and not exists (select 1 from listings where id = new.listing_id and tenant_id = new.tenant_id) then
        raise exception 'That listing belongs to another agency' using errcode = '23503';
    end if;
    if new.agent_id is not null
       and not exists (select 1 from tenant_users where id = new.agent_id and tenant_id = new.tenant_id) then
        raise exception 'That team member belongs to another agency' using errcode = '23503';
    end if;

    if tg_op = 'INSERT' then
        if new.agent_id is null then
            select l.assigned_to into new.agent_id
            from leads l
            join tenant_users u on u.id = l.assigned_to and u.removed_at is null
            where l.tenant_id = new.tenant_id and l.contact_id = new.contact_id
            order by l.updated_at desc
            limit 1;
        end if;
        if new.listing_id is null and new.notes is not null then
            new.listing_id := listing_from_text(new.tenant_id, new.notes);
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_appointments_fill_links on appointments;
create trigger trg_appointments_fill_links
    before insert or update of listing_id, agent_id on appointments
    for each row execute function fill_appointment_links();

-- ── Fill in existing appointments (only empty fields) ──
update appointments a
set agent_id = (
        select l.assigned_to
        from leads l
        join tenant_users u on u.id = l.assigned_to and u.removed_at is null
        where l.tenant_id = a.tenant_id and l.contact_id = a.contact_id
        order by l.updated_at desc
        limit 1
    )
where a.agent_id is null;

update appointments a
set listing_id = listing_from_text(a.tenant_id, a.notes)
where a.listing_id is null and a.notes is not null;

commit;
