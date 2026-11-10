-- One-off setup for getelliot.eu (run in Supabase → SQL Editor AFTER
-- migration 0037). Creates:
--   * "Elliot" (slug elliot, mode sales): the website's own assistant. Books
--     15-min intro calls and 30-min live demos into your Google Calendar,
--     every day 09:00-21:00 Warsaw time.
--   * "Demo Nieruchomości" (slug demo-nieruchomosci, mode demo): the public
--     demo agency with 10 sample flats. Bookings go to a SEPARATE calendar.
--
-- BEFORE RUNNING: replace PASTE_DEMO_CALENDAR_ID below with the ID of a new
-- Google Calendar called "Elliot Demo" (Google Calendar → Settings → the
-- calendar → Integrate calendar → Calendar ID, looks like
-- abc123...@group.calendar.google.com). Create it in the same Google account
-- n8n's "Elliot Google Calendar" credential uses.
--
-- Safe to run again: existing rows are updated, not duplicated.

begin;

-- ── The two accounts ──
insert into tenants (name, slug, industry, plan, status, timezone, assistant_mode, trial_ends_at, notes)
values ('Elliot', 'elliot', 'software', 'complimentary', 'active', 'Europe/Warsaw', 'sales', null,
        'Elliot''s own website assistant (getelliot.eu chat and consultation booking).'),
       ('Demo Nieruchomości', 'demo-nieruchomosci', 'real estate', 'complimentary', 'active', 'Europe/Warsaw', 'demo', null,
        'Public demo agency on getelliot.eu/demo. Sample data; visitor data deleted after 3 days.')
on conflict (slug) do update
    set assistant_mode = excluded.assistant_mode, plan = excluded.plan, status = 'active',
        timezone = excluded.timezone, industry = excluded.industry;

-- ── Settings: opening hours, calendars, everything on autopilot ──
with hours as (
    select jsonb_object_agg(d, jsonb_build_object('open', '09:00', 'close', '21:00')) as h
    from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) d
)
insert into ai_config (tenant_id, autonomy_rules, escalation_thresholds, business_hours, google_calendar_id)
select t.id,
       '{"send_email": {"mode": "autonomous"}, "book_appointment": {"mode": "autonomous"}}'::jsonb,
       '{"min_confidence": 0.6}'::jsonb,
       hours.h,
       case t.slug when 'elliot' then 'primary' else 'PASTE_DEMO_CALENDAR_ID' end
from tenants t, hours
where t.slug in ('elliot', 'demo-nieruchomosci')
on conflict (tenant_id) do update
    set business_hours = excluded.business_hours,
        google_calendar_id = excluded.google_calendar_id,
        autonomy_rules = excluded.autonomy_rules;

-- The demo agency never emails or messages anyone but the visitor.
update ai_config set escalation_notify_email = null, crm_webhook_url = null,
                     alert_email_enabled = false, alert_whatsapp_enabled = false
where tenant_id = (select id from tenants where slug = 'demo-nieruchomosci');

do $$
begin
    if exists (select 1 from ai_config ac join tenants t on t.id = ac.tenant_id
               where t.slug = 'demo-nieruchomosci'
                 and (ac.google_calendar_id like 'PASTE' || '\_%' or ac.google_calendar_id = 'primary')) then
        raise exception 'Put your "Elliot Demo" calendar ID in this script first (see the top), so demo bookings stay out of your own calendar.';
    end if;
end $$;

-- ── Ten sample flats for the demo agency (Warsaw, sale and rent) ──
with t as (select id from tenants where slug = 'demo-nieruchomosci')
insert into listings (tenant_id, reference, title, status, transaction_type, property_type, price, currency,
                      city, district, address, area_m2, rooms, bedrooms, bathrooms, floor, description, features)
select t.id, v.* from t, (values
  ('DEMO-01', 'Bright 2-room flat near Metro Racławicka', 'available', 'sale', 'apartment', 849000, 'PLN', 'Warszawa', 'Mokotów', 'ul. Racławicka 12', 48.5, 2, 1, 1, 3,
   'Sunny corner flat 5 minutes from the metro, renovated in 2024, kitchen open to the living room, quiet bedroom facing the courtyard.', array['balcony','elevator','renovated','near metro']),
  ('DEMO-02', 'Family 3-room flat with garden view', 'available', 'sale', 'apartment', 1195000, 'PLN', 'Warszawa', 'Wilanów', 'ul. Branickiego 21', 72.0, 3, 2, 1, 1,
   'Spacious flat in a 2019 building, two bedrooms, large living room, storage room, view over the shared garden. Close to schools and parks.', array['garden view','parking space','storage','new building']),
  ('DEMO-03', 'Studio in the centre, ready to move in', 'available', 'sale', 'apartment', 589000, 'PLN', 'Warszawa', 'Śródmieście', 'ul. Hoża 41', 27.0, 1, 0, 1, 4,
   'Compact studio in a pre-war tenement, high ceilings, fully furnished. Ideal first flat or investment.', array['furnished','city centre','high ceilings']),
  ('DEMO-04', 'Modern 2-room flat on Wola with balcony', 'available', 'sale', 'apartment', 925000, 'PLN', 'Warszawa', 'Wola', 'ul. Kasprzaka 29', 51.2, 2, 1, 1, 7,
   'New-build flat with a south-facing balcony and city views, underground parking available, gym in the building.', array['balcony','city view','parking space','gym','elevator']),
  ('DEMO-05', '4-room penthouse with terrace', 'available', 'sale', 'apartment', 2390000, 'PLN', 'Warszawa', 'Mokotów', 'ul. Puławska 145', 118.0, 4, 3, 2, 9,
   'Top-floor penthouse with a 40 m² terrace, two bathrooms, three bedrooms and two parking spaces.', array['terrace','two parking spaces','elevator','air conditioning']),
  ('DEMO-06', 'House with garden in Ursynów', 'available', 'sale', 'house', 2150000, 'PLN', 'Warszawa', 'Ursynów', 'ul. Wąwozowa 8', 165.0, 5, 4, 2, null,
   'Detached family house on a 600 m² plot, four bedrooms, fireplace, garage for two cars, quiet street near the forest.', array['garden','garage','fireplace','quiet area']),
  ('DEMO-07', '2-room flat for rent near Pole Mokotowskie', 'available', 'rent', 'apartment', 4200, 'PLN', 'Warszawa', 'Ochota', 'ul. Grójecka 64', 44.0, 2, 1, 1, 2,
   'Furnished flat for long-term rent, washing machine and dishwasher, 10 minutes walk to Pole Mokotowskie park. Pets considered.', array['furnished','dishwasher','pets considered']),
  ('DEMO-08', 'Studio for rent in Praga, available now', 'available', 'rent', 'apartment', 2900, 'PLN', 'Warszawa', 'Praga-Północ', 'ul. Ząbkowska 15', 30.0, 1, 0, 1, 1,
   'Cosy studio in a renovated building on Ząbkowska, close to Koneser and the metro. Bills not included.', array['renovated','near metro']),
  ('DEMO-09', '3-room flat for rent on Żoliborz', 'available', 'rent', 'apartment', 6500, 'PLN', 'Warszawa', 'Żoliborz', 'ul. Słowackiego 18', 68.0, 3, 2, 1, 4,
   'Bright flat with two bedrooms and a balcony, garage space included, close to Plac Wilsona metro.', array['balcony','garage space','near metro','elevator']),
  ('DEMO-10', '2-room flat in Białołęka, great value', 'available', 'sale', 'apartment', 615000, 'PLN', 'Warszawa', 'Białołęka', 'ul. Głębocka 90', 46.0, 2, 1, 1, 2,
   'Well-kept flat in a 2017 building with a private storage unit and a playground in the courtyard. Bus to the centre in 25 minutes.', array['storage','playground','balcony'])
) as v(reference, title, status, transaction_type, property_type, price, currency, city, district, address, area_m2, rooms, bedrooms, bathrooms, floor, description, features)
on conflict (tenant_id, reference) where reference is not null do update
    set title = excluded.title, price = excluded.price, description = excluded.description, status = excluded.status;

commit;

select slug, assistant_mode, (select google_calendar_id from ai_config where tenant_id = t.id) as calendar,
       (select count(*) from listings l where l.tenant_id = t.id) as listings
from tenants t where slug in ('elliot', 'demo-nieruchomosci');
