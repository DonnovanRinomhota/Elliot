# Owner and agency separation (0040)

**Control panel** (`/platform`, you only): agencies, plans, payments, usage
counts, AI cost, health and alerts. Business figures, not the agencies'
client data. It now needs **two-step sign-in**: your password plus a 6-digit
code from an authenticator app.

**An agency's dashboard** (their clients, conversations, leads, listings…):
"Open their dashboard" works only while the agency allows support access, and
the database checks this on every query, not just the button.

| | |
| --- | --- |
| Who turns it on | An admin of the agency: Settings → Elliot support access → 24 hours, 7 days or 30 days, or "Turn off now". |
| New agencies | Start with 30 days ("Elliot set-up") so you can set them up; they can turn it off. |
| Existing agencies | Start with access **off**. Ask them to allow it, or (if they've agreed, e.g. still in set-up) run the SQL below. |
| Elliot's own accounts | The sales (Elliot) and demo accounts need no permission, only two-step sign-in. |
| What they see | Each part you opened (Conversations, Leads, Settings…) with the time and your email, in Settings. The control panel shows you the same list on the agency's page. |
| How long a visit lasts | 8 hours at most, never past their permission. Turning it off ends your visit at once. |

## Set-up

1. **Supabase → SQL Editor**: run `db/migrations/0040_support_access.sql`.
2. **Supabase → Authentication → Multi-Factor** (or Sign In / Providers →
   Multi-Factor): check **TOTP (App Authenticator)** is enabled. It is by
   default.
3. Deploy the dashboard (the push), then open **Control panel**: you're asked
   to set up two-step sign-in once (scan the QR code with Google
   Authenticator, Microsoft Authenticator or 1Password, enter the code).
   After that, each new sign-in asks for the code before the control panel.

**Lost your phone?** Supabase → Authentication → Users → your user → delete
its MFA factor. The next visit to the control panel sets it up again.

## Giving an existing agency a set-up window

Only with the agency's agreement (for example it's in your contract that you
set them up):

```sql
insert into support_access_grants (tenant_id, granted_by_email, expires_at)
select id, 'Elliot set-up', now() + interval '30 days' from tenants where slug = 'their-slug'
on conflict (tenant_id) do update set granted_by_email = excluded.granted_by_email, expires_at = excluded.expires_at;
```

They see it in Settings and can turn it off.
