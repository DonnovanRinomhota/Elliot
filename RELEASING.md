# Releasing a change

Elliot lives in four places, and **merging on GitHub only updates two of them.**

| Where | What | How it gets updated |
|---|---|---|
| Vercel `elliot-real-estate` | Dashboard, app.getelliot.eu | **Automatically** when `main` changes |
| Vercel `elliot-web` | Website, getelliot.eu (repo Elliot-web) | **Automatically** when its `main` changes |
| Supabase `drnthityffeuwlddjorx` | Database: tables, security, functions | **By hand**: run the migration in SQL Editor |
| n8n `makodevops.app.n8n.cloud` | Workflows: Elliot itself, email, WhatsApp, sweeps | **By hand**: import the workflow file |

A change that touches the database or a workflow is not live until you do
those steps. The Supabase project is named `elliot-dev`, but it is the one
production uses.

## 1. Before you merge: the checks

Every pull request runs **Checks** on GitHub (`.github/workflows/checks.yml`).
Wait for the green tick. A red cross means don't merge; open it to see which
step failed.

| Check | What it proves |
|---|---|
| No keys; every setting documented | No API key, token or password is in the repository (it is public). Every environment variable the dashboard reads is listed in `apps/elliot-dashboard/.env.example`. |
| Dashboard | Unit tests, TypeScript, ESLint and a production build all pass. |
| n8n workflow tests | The logic inside the workflow files does what its tests say (the files are tested, not your live n8n). |
| Migrations and database tests | Every migration, in order, builds a fresh database without an error. Then every database test passes: agency isolation, roles, bookings, follow-ups, reliability. |
| Website (Elliot-web) | ESLint and a production build. The build also fails if the English and Polish pages drift apart. |

The checks never touch production. They use a throw-away database inside
GitHub and have no keys.

To run the same checks on your computer:

```
cd ~/Elliot/apps/elliot-dashboard && npm ci && npm test && npx tsc --noEmit -p . && npm run lint
cd ~/Elliot/n8n/workflows/tests && npm ci && npm test
python3 ~/Elliot/scripts/check-secrets.py
```

The database checks need a local Postgres with pgvector:
`PGHOST=localhost PGUSER=postgres PGPASSWORD=… db/test/run.sh`.

## 2. After you merge: release in this order

Always **database first, then n8n, then check the dashboard.** Migrations
are written so the old workflows and the old dashboard keep working with the
new database for the few minutes in between. The reverse isn't true: a new
workflow can need a function that only the new migration adds.

### 2a. Supabase: migrations

1. **Back up first** (see [Backups](#backups)). Your plan has no automatic
   backups.
2. Supabase → SQL Editor, run:
   ```sql
   select * from migration_status();
   ```
   It lists every migration and whether this database has it. Any row marked
   **MISSING** must be run first. (Available once 0049 has been run. Before
   that, the last migration you ran is the one to continue from.)
3. Run each new file in `db/migrations/`, in number order: open it on GitHub
   → copy everything → paste into a new SQL Editor tab → Run.
4. Run `select * from migration_status();` again. The new ones show
   `in_database = true`.

**Never run an old migration again.** Many of them redefine functions, and an
old definition silently replaces the newer one. For example, re-running 0009
would undo part of 0047's security fixes. From 0049 on, a migration refuses
to run twice or out of order, and changes nothing when it refuses.

Some migrations end with a one-off step (e.g. 0046's `update platform_settings
set supabase_url = …`). The pull request and that migration's doc say so.

### 2b. n8n: workflows

For each workflow file the change touched (`n8n/workflows/NN-*.json`):

1. Open that workflow in n8n → **⋯ → Import from File** → pick the file.
   Importing into the open workflow keeps its ID, so other workflows still
   find it. (Don't use "Add workflow → Import": that makes a copy with a new ID.)
2. Check every node with a red warning: pick the credential it asks for.
   Database nodes use **Elliot Postgres (service role)**.
3. **Save**, and make sure it is **Active** (top right).

The files carry the links between workflows (24 Escalate, 37 Viewing
Changes), the error workflow (34) and database credentials, so an import
should keep them. Until that has been seen to hold on a few imports, open one
"Execute: …" node after importing 01 and check it still points at the right
workflow.

Secrets that live inside Code nodes (n8n Cloud Starter has no variables) are
kept as `PASTE_ME…` in the files. After importing a workflow that has one,
paste the real value back. The pull request says when this applies.

### 2c. Vercel: settings, then the deploy

If the change adds an environment variable, add it in Vercel → project →
Settings → Environment Variables **before** merging, then redeploy if the
merge has already deployed. The full list, with what each is for, is
`apps/elliot-dashboard/.env.example` (dashboard) and `.env.example` in
Elliot-web (website).

Checked against Vercel on 12 Nov 2026 (names only, values not read):

- **Missing in `elliot-real-estate`: `N8N_SEND_WHATSAPP_WEBHOOK_URL`.**
  Without it, sending an approved WhatsApp draft from the dashboard fails with
  "not configured". Set it to workflow 28's production webhook URL.
- Four are still set under their old `NEXT_PUBLIC_…` names (onboard, ingest,
  send, plus the missing one above). They work; rename them to the
  `N8N_…` names when convenient. They are only used on the server.
- Elliot-web has all four it reads.

### 2d. Check it works

After a release that touched Elliot's answers, email, WhatsApp or bookings:

- [ ] Send a message in the website chat on getelliot.eu. Elliot answers.
- [ ] Send an email to a test agency's Elliot address. A reply arrives in the same thread.
- [ ] Send a WhatsApp message to the test number. A reply arrives.
- [ ] Book a test viewing. It appears in the dashboard and in the agent's Google Calendar.
- [ ] n8n → Executions: no new red runs.
- [ ] Control panel → Health: no new alerts.

## 3. If something goes wrong

| What | Undo |
|---|---|
| Dashboard or website | Vercel → project → Deployments → the last good one → ⋯ → **Instant Rollback** (or Promote to Production). Takes seconds; the database is untouched. A rolled-back dashboard still talks to the newer database, which migrations are written to allow. |
| A workflow | Import the previous version: on GitHub open the file → History → the commit before → Raw → save → Import from File as above. |
| A migration that failed | Nothing to undo. Each migration from 0049 on is one transaction (`begin … commit`), so a failure leaves the database exactly as it was. Fix the cause and run it again. |
| A migration that worked but broke something | There is no automatic undo. Write a new migration that fixes forward (the usual way), or restore the backup you took in 2a step 1. Every migration from 0050 on says in its header what it changes and how to reverse it. |
| Data deleted by mistake | Restore from your backup (below). |

## Backups

**On Supabase's Free plan there are no backups you can restore from.**
[Supabase's docs](https://supabase.com/docs/guides/platform/backups) give
daily backups only from the Pro plan up (7 days on Pro, 14 on Team), and
advise Free projects to export their own. Backups never include files in
Storage (email attachments), only the database.

Before the first paying agency, do one of:

1. **Move to Pro.** Daily backups, restorable from the dashboard. Simplest.
2. **Take your own backup** before every migration and at least weekly, with
   the [Supabase CLI](https://supabase.com/docs/reference/cli/supabase-db-dump)
   on your computer. It runs `pg_dump` in a container, so Docker Desktop must
   be running. The connection string is in Supabase → Connect → Session
   pooler; never commit it.
   ```
   npx supabase db dump --remote="postgresql://…" -f elliot-schema.sql
   npx supabase db dump --remote="postgresql://…" --data-only -f elliot-data.sql
   ```
   Keep the files somewhere private, never in this repository. Try a restore
   once on a spare Supabase project, so you know it works before you need it.

## Writing a new migration

```sql
-- 0050: What this changes, in one line.
--
-- Why, and what it touches.
-- Undo: how to reverse it (e.g. "drop function x; drop column y").

begin;
select begin_migration('0050', 'short_name', '0049');

-- … the change …
-- New tables: tenant_id, row-level security, a policy on current_tenant_id().
-- New functions n8n calls: revoke all … from public, anon, authenticated;
-- New functions the dashboard calls: grant execute … to authenticated;

commit;
```

Add a test as `db/seed/test_0050_<name>.sql` that ends with
`select '0050 checks passed';` and rolls back what it creates. The Checks
run it automatically. They also fail if the new migration doesn't start with
`begin_migration`, or can be run twice.
