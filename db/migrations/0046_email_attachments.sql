-- 0046_email_attachments.sql
--
-- Files clients attach to their emails. Workflows 16 (Gmail) and 40
-- (forwarded to <slug>@in.getelliot.eu) save each attachment in the private
-- "email-attachments" storage bucket under <tenant_id>/<conversation_id>/,
-- record it here, and give Elliot the PDFs and photos to read. The team
-- sees and downloads every file on the conversation page.
--
--   * message_attachments: one row per file. Agencies read their own rows;
--     only n8n (service role) writes them. Downloads go through the
--     dashboard, which checks the row is the agency's before signing a
--     short-lived link with the service role.
--   * platform_settings.supabase_url: this project's URL, which n8n needs to
--     reach Storage. Set it once after running this file (see the end).
-- One transaction; safe to run again.

begin;

alter table platform_settings add column if not exists supabase_url text;
comment on column platform_settings.supabase_url is 'This Supabase project''s URL (https://<ref>.supabase.co). Workflows 16 and 40 use it to save email attachments in Storage (0046).';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-attachments', 'email-attachments', false, 26214400, null)
on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = null;

create table if not exists message_attachments (
    id               uuid primary key default gen_random_uuid(),
    tenant_id        uuid not null references tenants(id) on delete cascade,
    conversation_id  uuid references conversations(id) on delete set null,
    source           text not null default 'email' check (source in ('email')),
    email_message_id text,
    filename         text not null,
    content_type     text,
    size_bytes       bigint,
    storage_path     text not null unique,
    uploaded         boolean not null default false,
    read_by_elliot   boolean not null default false,
    created_at       timestamptz not null default now()
);
comment on table message_attachments is 'Files clients attached to emails (0046). The file is in the email-attachments bucket at storage_path; read_by_elliot = given to Claude (PDFs and photos within the size limits).';
create index if not exists idx_message_attachments_conversation on message_attachments(conversation_id, created_at);
create index if not exists idx_message_attachments_tenant on message_attachments(tenant_id, created_at desc);

alter table message_attachments enable row level security;
revoke all on message_attachments from anon, authenticated;
grant select on message_attachments to authenticated;
drop policy if exists tenant_reads_message_attachments on message_attachments;
create policy tenant_reads_message_attachments on message_attachments
    for select to authenticated
    using (tenant_id = current_tenant_id());

commit;

-- After running this file, once (Supabase → Project Settings → Data API → Project URL):
--   update platform_settings set supabase_url = 'https://YOUR-PROJECT-REF.supabase.co';
