-- Follow-Up Engine test data -- run in Supabase SQL editor.
-- Uses the "test-co" tenant already created via workflow 19's curl test.
-- Safe by default: test-co's ai_config has no send_follow_up autonomy key,
-- so this will land as a 'pending' draft in the dashboard, not send a real
-- email -- nothing to configure Gmail-wise just to prove the engine works.

-- 1. A contact + lead to run the sequence against.
with new_contact as (
    insert into contacts (tenant_id, name, email, source)
    select id, 'Test Lead', 'testlead@example.com', 'manual'
    from tenants where slug = 'test-co'
    returning id, tenant_id
)
insert into leads (tenant_id, contact_id, status)
select tenant_id, id, 'WARM' from new_contact
returning id as lead_id;
-- ^ COPY the lead_id this returns, you'll need it below and in the curl call.

-- 2. A 2-step sequence, both steps due almost immediately (day_offset 0)
-- so you don't have to wait days to see the sweep actually advance it.
insert into follow_up_sequences (tenant_id, name, steps)
select id, 'Test Sequence',
  '[
    {"day_offset": 0, "channel": "email", "subject": "Great speaking with you, {{contact_name}}", "body": "Hi {{contact_name}}, just checking in after our chat."},
    {"day_offset": 0, "channel": "email", "subject": "Still there, {{contact_name}}?", "body": "Hi {{contact_name}}, following up one more time."}
  ]'::jsonb
from tenants where slug = 'test-co'
returning id as sequence_id;
-- ^ COPY the sequence_id this returns too.
