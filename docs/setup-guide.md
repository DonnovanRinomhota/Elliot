# Setup Guide — Connecting Everything (Phase 1 + 2)

Do these in order. Each step tells you how to know it worked before moving to the next — don't skip the checks, since a silent failure early on (especially around RLS) is much harder to debug three steps later.

---

## 1. Supabase project

1. Go to supabase.com → New project. Pick a region close to your users (e.g. EU for Warsaw).
2. Once it's provisioned: **Project Settings → Database** — copy the connection string (you'll need it twice, differently, in step 4).
3. **SQL Editor** → run each file in `db/migrations/` in order, 0001 through 0008. Paste the whole file, hit Run, confirm no errors, move to the next.
4. Run `db/seed/dev_seed.sql` the same way — this creates two test tenants so you have something to point the workflow at.

**Check:** SQL Editor → run `select slug, name from tenants;` — you should see `zebra-dev` and `acme-dental-dev`.

---

## 2. n8n instance

You have two reasonable options — pick one:

**A. n8n Cloud** (fastest to get running, easiest for a solo dev right now): sign up at n8n.io, get a workspace.

**B. Self-hosted via Docker** (matches the architecture doc's recommendation for data control — better once you have real tenant data, not required yet):
```bash
docker run -it --rm --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
```
Then open `http://localhost:5678`.

Either way — **Check:** you can log into the n8n editor UI.

---

## 3. Import the workflow

1. In n8n: **Workflows → Import from File** (or copy-paste JSON, depending on your n8n version — check the current UI, this has moved before).
2. Select `n8n/workflows/01-main-ai-agent.json` from the repo.
3. It'll import with all 22 nodes but **broken credentials** — that's expected, you haven't created them yet. Next steps fix that.

**Check:** the workflow appears in your workflow list named "01 - Main AI Agent" with the node layout roughly matching the spec doc.

---

## 4. Create the Postgres credentials in n8n

You need **two** Postgres credentials, both pointing at the same Supabase database but conceptually distinct (see the workflow spec for why):

1. In Supabase: **Project Settings → Database → Connection info.** Use the **Session pooler** or **direct connection** string, NOT the transaction pooler — transaction pooling can break session-scoped `set_config`, which this workflow depends on. Verify current Supabase docs on which pooling mode preserves session state, since this has changed before.
2. In n8n: **Credentials → New → Postgres.** Name it exactly `Elliot Postgres (service role)`. Use the Supabase **service_role** connection details (bypasses RLS — this is intentional, used only for the tenant-lookup query before a tenant is known).
3. Create a second Postgres credential named exactly `Elliot Postgres (RLS-scoped)`. For Phase 2, it's fine to point this at the same service-role connection — true RLS-scoped app-level credentials (a non-superuser DB role) are a hardening step, not a Phase 2 blocker. Note this as a known simplification, not a finished security posture.
4. Open the imported workflow, click each Postgres node, and assign the matching credential by name.

**Check:** open the "Resolve Tenant" node, click "Execute step" with test input `{"tenant_slug": "zebra-dev"}` — it should return one row with `zebra-dev`'s tenant_id.

---

## 5. Create the Anthropic API credential

1. Get an API key from console.anthropic.com (Anthropic Console → API Keys).
2. In n8n: **Credentials → New → Header Auth.** Name it `Anthropic API Key (x-api-key header)`.
3. Header name: `x-api-key`. Header value: your key. (Not `Authorization: Bearer ...` — Claude's API uses its own header. Double-check this against current docs.claude.com before testing, since auth conventions are exactly the kind of detail that changes.)
4. Assign this credential to both "Call Claude (turn 1)" and "Call Claude (turn 2, with tool result)" nodes.

**Check:** open "Call Claude (turn 1)" and "Execute step" with a manually-crafted test input — you should get back a real Claude API response object, not a 401.

---

## 6. The Knowledge Retrieval sub-workflow forward-reference

The "Execute: Knowledge Retrieval Sub-Workflow" node currently points at a placeholder ID — that workflow doesn't exist yet (it's Phase 3). **Don't try to run the full end-to-end flow yet** — test everything up through "Did Claude Request a Tool?" first. Full end-to-end testing happens once Phase 3 ships.

For now, you can test the **non-tool path**: ask a question generic enough that Claude answers directly without calling `search_company_knowledge` (e.g. "hello, are you a bot?"). That exercises the whole workflow except the sub-workflow call.

---

## 7. First test run

1. Activate the workflow (toggle in the top-right of the n8n editor) — this makes the webhook live.
2. Copy the webhook URL from the "Chat Webhook" node (n8n shows both a test URL and a production URL — use the test URL while `active` is off, production URL once it's on).
3. From a terminal or Postman:
```bash
curl -X POST https://<your-n8n-instance>/webhook/chat \
  -H "Content-Type: application/json" \
  -d '{"tenant_slug": "zebra-dev", "message": "hello, are you a bot?"}'
```
4. Expected response shape:
```json
{ "conversation_id": "…", "reply": "…" }
```

**If this fails**, check in this order (matches the most likely failure points):
1. n8n execution log — click into the failed run, find the red node, read its error.
2. If "Resolve Tenant" fails: seed data didn't load, or tenant_slug typo.
3. If "Load AI Config" comes back with zero rows: this is the RLS-session-persistence risk flagged in the workflow spec — `app.current_tenant` isn't surviving between Postgres nodes. Fix per the note in `docs/workflow-specs/01-main-ai-agent.md`.
4. If "Call Claude" fails with 401: credential header name/value wrong.
5. If it all runs but `messages` table is empty afterward: check the RLS-scoped credential is actually the same session as "Set Tenant Session (RLS)" ran on.

---

## What to send me

Run step 7 and paste me the actual n8n execution log (success or failure) — I'll debug from there rather than guessing. Once the non-tool path works end to end, we move to Phase 3 (Knowledge Ingestion + Retrieval), which unblocks the tool-calling path fully.
