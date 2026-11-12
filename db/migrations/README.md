# Database migrations

Postgres schema, row-level security and functions for Supabase. Run every file
in number order in **Supabase → SQL Editor** (paste the whole file, Run).
Nothing runs them for you: a merged migration isn't live until you run it. The
release steps, backups and what to do if something goes wrong are in
[`RELEASING.md`](../../RELEASING.md).

**Which ones has the database got?** `select * from migration_status();`
(from 0049 on). **Never run one again**: thirteen of the older files fail on
a second run, and others silently replace newer function definitions with
older ones (re-running 0009 would undo part of 0047). From 0049 on, a
migration refuses to run twice or before the one it needs, and changes
nothing when it refuses.

Some files end with a one-off step (for example 0046's `update platform_settings
set supabase_url = …`); the feature doc for each migration lists its set-up.

## How access works

- **Agencies (dashboard):** signed in with Supabase Auth. Policies use
  `current_tenant_id()`, the user's agency, or the agency a platform admin is
  viewing (0027, 0040: only with two-step sign-in and, when the switch is on,
  the agency's permission).
- **n8n:** connects as the service role (`Elliot Postgres (service role)`) and
  passes the agency explicitly to each query or function.
- Tables an agency must never read directly (credentials, tokens) are
  revoked from `anon` and `authenticated`; only n8n and the dashboard server
  use them, through functions that leave secrets out.

## Files

| # | What it adds |
|---|---|
| 0001–0008 | Core schema: tenants, contacts, leads, conversations, messages, knowledge (pgvector), appointments, follow-ups, escalations, CRM sync, audit log, row-level security |
| 0009 | Tenant-scoped functions for n8n |
| 0010 | Embedding size fix (Voyage, 1024) |
| 0011 | Calendar ID on `ai_config`, one lead per contact |
| 0012 | Escalation function |
| 0013 | Email drafts and approval |
| 0014 | Agency Gmail address |
| 0015 | `current_tenant_id()` for the dashboard |
| 0016 | Proposed appointment on email drafts |
| 0017 | Demo requests from the website |
| 0018 | Follow-ups through email drafts |
| 0019 | CRM webhook URL |
| 0020 | Escalation alert email |
| 0021–0022 | Overview stats |
| 0023 | Team reply on email |
| 0024 | Revenue estimate |
| 0025 | WhatsApp drafts |
| 0026 | Automatic CRM sync and follow-up auto-enrol |
| 0027 | Control panel, listings, team, inbox, live takeover |
| 0028 | Listing available-from date |
| 0029 | Listing photos (Storage) |
| 0030 | Viewings linked to a property and an agent |
| 0031 | Chat contacts; duplicate messages removed |
| 0032 | WhatsApp instant replies |
| 0033 | Listing links, booking details |
| 0034 | Better search and viewings |
| 0035 | Email instant replies |
| 0036 | Health checks and alerts |
| 0037 | getelliot.eu: sales assistant, calls, demo agency |
| 0038 | Clients confirm, move or cancel viewings; reminders |
| 0039 | Agency email addresses (Resend) |
| 0040 | Support access and two-step sign-in for the control panel |
| 0041 | Switch: support access needs the agency's permission |
| 0042 | Each agent's own Google Calendar; overlapping viewings for different agents |
| 0043 | Sellers, landlords and valuation visits |
| 0044 | ASARI CRM listing sync |
| 0045 | Follow-ups by WhatsApp |
| 0046 | Email attachments (private Storage bucket) |
| 0047 | Security: agency isolation, roles, public key locked down ([security](../../docs/security.md)) |
| 0048 | Reliability: follow-up steps claimed once, STOP for follow-ups, escalation when Elliot can't answer, failed tools and WhatsApp deliveries logged, spaced-out CRM retries ([reliability](../../docs/reliability.md)) |
| 0049 | Migration record: `migration_status()`, `schema_migrations`, `begin_migration()` ([releasing](../../RELEASING.md)) |
| 0050 | Trials that pause, go-live checklist, failures per agency in the control panel ([onboarding](../../docs/onboarding.md)) |
| 0051 | Data protection: a client's copy and deletion, retention period, deleting a cancelled agency ([data protection](../../docs/data-protection.md)) |
| 0052 | Archived conversations: closed ones go to Archived, come back when the client or the agency writes again; Archive / Move back in the dashboard |

## Tests

`db/seed/test_00NN_*.sql` is a scenario test for migration 00NN (0026 onward).
Run them only on a **scratch** database with every migration applied: each
wraps itself in a transaction, rolls back, and ends with "00NN checks
passed". Some need Supabase's `storage` and `auth` schemas (present in every
Supabase project; the tests create small stand-ins if missing).
`db/seed/dev_seed.sql` adds example agencies for local development.
`test_follow_up_engine.sql` and `test_rls_isolation.sql` are older manual
walk-throughs, not automatic tests (0047 and 0048 cover what they checked).

**GitHub runs all of them on every pull request** (`db/test/run.sh`): it
builds a new database from `db/test/bootstrap.sql` (a stand-in for a fresh
Supabase project, including Supabase's default grants), runs every migration
in order, then every `test_0*.sql`. `test_0047_tenant_isolation.sql` is the
guard for new migrations: it fails if a table has no RLS, if the public key
(`anon`) gains access to anything, or if a signed-in user can run a function
that takes an agency ID.

## Rules for new migrations

- Start with `begin;` and `select begin_migration('NNNN', 'short_name',
  'previous');`, end with `commit;`. The header says how to undo it. Template
  in [`RELEASING.md`](../../RELEASING.md#writing-a-new-migration).

- New table with agency data: `tenant_id`, `enable row level security`, a
  policy on `current_tenant_id()`. Nothing for `anon`.
- New function for n8n (takes `p_tenant_id`): `revoke all on function … from
  public, anon, authenticated;` right after it.
- New function for the dashboard: work the agency out with
  `current_tenant_id()`, never take it as a parameter; `grant execute … to
  authenticated`.
- A table that points at another agency table: add it to the
  `enforce_same_tenant` list in 0047 §4 (in a new migration).
