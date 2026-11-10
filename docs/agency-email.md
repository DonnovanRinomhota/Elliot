# Agency email (0039, workflows 39 and 40)

Every agency gets its own email address on Elliot, and every email Elliot sends
for an agency goes out under the agency's name through Resend, not from the
platform owner's Gmail.

## How it works

**Incoming.** The agency forwards its inbox (for example `biuro@agency.pl`) to
its Elliot address, `<slug>@in.getelliot.eu` (shown in Settings → Email).
Resend receives the email and calls workflow 40, which:

1. fetches the email from Resend's API with our key (the webhook only says that
   an email arrived, so a fake webhook call cannot make Elliot answer anything);
2. finds the agency by its Elliot address, or by its own address;
3. skips newsletters, automatic emails and out-of-office replies; for portal
   enquiries (Otodom, OLX…) that come from a no-reply address, it answers the
   client in Reply-To;
4. hands the email to Elliot (workflow 01, channel `email`) and replies in the
   same thread through workflow 39.

Gmail's "confirm forwarding" email is caught and its code shown in Settings, so
the agency can finish the forward without help.

**Outgoing.** Workflow 39 sends every agency email: confirmations (12), approved
replies (15), follow-ups (20), escalation alerts (24), daily summaries (31),
viewing changes (37), reminders (38), replies (40), and Elliot's own
notifications (18, 35).

| Email for | From | Reply-To |
| --- | --- | --- |
| Clients | `Agency name <slug@mail.getelliot.eu>` (or Settings → Sender name) | the agency's own address, else `slug@in.getelliot.eu` |
| The agency's team | `Elliot · Agency name <slug@mail.getelliot.eu>` | none |
| You (no agency) | `Elliot <notifications@mail.getelliot.eu>` | none |

If Resend fails on a team email, 39 falls back to the Gmail credential. Client
emails never fall back: they would come from the wrong address. The caller
records the failure as before (for example "confirmation not sent").

Workflow 16 (the Gmail inbox) still works for a mailbox connected to n8n.
Both 16 and 40 now claim an email by its Message-ID, so an email that arrives
both ways is answered once.

## Set-up (once)

1. **Supabase → SQL Editor**: run `db/migrations/0039_agency_email.sql`.
2. **n8n → import `39-send-email.json`** and open it:
   - *Load Sender*: credential **Elliot Postgres (service role)**.
   - *Send via Resend*: credential **Resend API key** (check it: n8n may pick
     another Header Auth credential on import).
   - *Send via Gmail (team fallback)*: **Gmail account**.
   - Save, then **Publish**.
3. **Re-import 12, 15, 16, 18, 20, 24, 31, 35, 37, 38** (replace each). Their send
   nodes already point at 39 (id `gwZAVRJ6G4iph76o` on makodevops.app.n8n.cloud)
   with their inputs filled in. If 39 is ever re-created with a new id, pick it
   again in each send node *and* re-enter its inputs: n8n clears them when the
   workflow changes (values in the workflow JSON). Re-check credentials as usual,
   then publish.
4. **Import `40-email-inbound-forwarded.json`**: credentials on *Fetch Email*
   (**Resend API key**) and the Postgres nodes. Publish, then copy the *Resend Webhook* node's
   **Production URL**.
5. **Resend → Webhooks → Add endpoint**: paste that URL, event
   **email.received**, save.
6. **Settings → Email** for each agency: their own address and sender name.
   For the Elliot (sales) account, put `hello@getelliot.eu`.

## Test

1. From your personal email, write to `<slug>@in.getelliot.eu` (for example the
   demo agency's). Elliot answers within a minute from
   `Agency <slug@mail.getelliot.eu>`; Settings → Email shows "Working".
2. Reply to that answer: the reply goes to the agency's address (Reply-To).
   With the forward on, Elliot answers in the same thread.
3. Book a viewing in the website chat with your email: the confirmation comes
   from the agency's name.

## An agency's own domain (optional)

To send as `elliot@agency.pl` instead of `slug@mail.getelliot.eu`:

1. Resend → Domains → Add `agency.pl` (or a subdomain such as `mail.agency.pl`)
   and send the agency the DNS records; wait for **Verified**.
2. Supabase → SQL Editor:

   ```sql
   insert into email_sending_identities (tenant_id, from_address)
   select id, 'elliot@agency.pl' from tenants where slug = 'agency-slug'
   on conflict (tenant_id) do update set from_address = excluded.from_address;
   ```

Settings shows the new From address straight away. To go back:
`delete from email_sending_identities where tenant_id = (select id from tenants where slug = 'agency-slug');`

## Limits

- Text emails only (no HTML or attachments in replies). Attachments clients
  send are not read yet.
- Resend's free plan has a monthly and a daily email cap (about 3,000 a month
  and 100 a day when this was written; check resend.com/pricing). Move to a
  paid plan before several agencies are live.
