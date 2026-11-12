-- 0052: Archived conversations.
--
--   1. conversations.archived_at: when set, the conversation is out of the
--      way in the dashboard's Archived tab instead of the main lists.
--   2. A conversation is archived when it's closed, and comes back by itself
--      when either side writes again: the client (a new message from them)
--      or the agency (a reply from a person). It also comes back if it's
--      reopened (status no longer closed).
--   3. archive_conversation(id, archive): the dashboard's Archive and Move
--      back buttons. Any member of the agency; only its own conversations.
--   4. Closed conversations that exist today are archived once, here.
--
-- Archiving or bringing back doesn't change a conversation's updated_at, so
-- "last contact" and the order of lists stay as they were.
-- Nothing is deleted. Undo: drop the two triggers and their functions, drop
-- archive_conversation, alter table conversations drop column archived_at.

begin;
select begin_migration('0052', 'conversation_archive', '0051');

alter table conversations add column if not exists archived_at timestamptz;
create index if not exists idx_conversations_tenant_archived on conversations (tenant_id, archived_at);

-- ── Closing archives; reopening brings back; archiving alone keeps updated_at ──
-- Runs after trg_conversations_updated_at (triggers fire in name order).
create or replace function conversation_archive_rules()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.status = 'closed' and old.status is distinct from 'closed' then
        new.archived_at := coalesce(new.archived_at, now());
    elsif old.status = 'closed' and new.status is distinct from 'closed' then
        new.archived_at := null;
    end if;
    -- Only archived_at changed: not activity, so keep the old updated_at.
    if new.archived_at is distinct from old.archived_at
       and new.status is not distinct from old.status
       and new.assigned_human is not distinct from old.assigned_human
       and new.channel is not distinct from old.channel
       and new.contact_id is not distinct from old.contact_id then
        new.updated_at := old.updated_at;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_conversations_zz_archive on conversations;
create trigger trg_conversations_zz_archive
    before update on conversations
    for each row execute function conversation_archive_rules();

-- ── Either side writing again brings it back ──
create or replace function conversation_unarchive_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.role in ('user', 'human_agent') then
        update conversations set archived_at = null
         where id = new.conversation_id and archived_at is not null;
    end if;
    return new;
end;
$$;
revoke all on function conversation_unarchive_on_message() from public, anon, authenticated;

drop trigger if exists trg_messages_unarchive on messages;
create trigger trg_messages_unarchive
    after insert on messages
    for each row execute function conversation_unarchive_on_message();

-- ── The dashboard's Archive / Move back buttons ──
create or replace function archive_conversation(p_conversation_id uuid, p_archive boolean default true)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant uuid := current_tenant_id();
    v_at timestamptz;
begin
    if v_tenant is null
       or (not exists (select 1 from tenant_users where auth_user_id = auth.uid() and tenant_id = v_tenant)
           and current_admin_view() is distinct from v_tenant) then
        raise exception 'Only a member of this agency can archive its conversations';
    end if;
    update conversations
       set archived_at = case when p_archive then coalesce(archived_at, now()) else null end
     where id = p_conversation_id and tenant_id = v_tenant
    returning archived_at into v_at;
    if not found then
        raise exception 'Conversation not found';
    end if;
    return v_at;
end;
$$;
revoke all on function archive_conversation(uuid, boolean) from public, anon;
grant execute on function archive_conversation(uuid, boolean) to authenticated;

-- ── Closed conversations today go to the archive (updated_at kept) ──
update conversations set archived_at = coalesce(updated_at, created_at)
 where status = 'closed' and archived_at is null;

commit;
