-- dev_seed.sql
-- Local/dev only. Creates two tenants so isolation can be tested against real rows.
-- Run with a service-role connection (bypasses RLS) — never run against production.

insert into tenants (id, name, slug, industry, plan, timezone) values
    ('11111111-1111-1111-1111-111111111111', 'Zebra Real Estate (Dev)', 'zebra-dev', 'real_estate', 'trial', 'Europe/Warsaw'),
    ('22222222-2222-2222-2222-222222222222', 'Acme Dental (Dev)', 'acme-dental-dev', 'healthcare_services', 'trial', 'America/New_York');

insert into ai_config (tenant_id, autonomy_rules, escalation_thresholds, lead_scoring_rubric) values
    ('11111111-1111-1111-1111-111111111111',
     '{"send_email": {"mode": "approval_required"}, "book_appointment": {"mode": "autonomous"}}'::jsonb,
     '{"min_confidence": 0.6}'::jsonb,
     '{"budget": {"weight": 0.5}, "timeline": {"weight": 0.3}, "location_match": {"weight": 0.2}}'::jsonb),
    ('22222222-2222-2222-2222-222222222222',
     '{"send_email": {"mode": "approval_required"}, "book_appointment": {"mode": "autonomous"}}'::jsonb,
     '{"min_confidence": 0.7}'::jsonb,
     '{}'::jsonb);

insert into contacts (id, tenant_id, name, email, phone, source) values
    ('a1a1a1a1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Jan Kowalski', 'jan@example.com', '+48123456789', 'chat_widget'),
    ('b2b2b2b2-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Sarah Miller', 'sarah@example.com', '+15551234567', 'chat_widget');

insert into leads (tenant_id, contact_id, status, qualification_answers) values
    ('11111111-1111-1111-1111-111111111111', 'a1a1a1a1-0000-0000-0000-000000000001', 'QUALIFYING',
     '{"budget": "2M PLN", "timeline": "3 months", "requirement": "3-bedroom apartment, Mokotów"}'::jsonb),
    ('22222222-2222-2222-2222-222222222222', 'b2b2b2b2-0000-0000-0000-000000000001', 'NEW', '{}'::jsonb);
