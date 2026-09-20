# Workflow Spec: 20 - Follow-Up Sweep (+ 21 - Start Follow-Up Run)

## Why two workflows
`follow_up_sequences`/`follow_up_runs` have existed in the schema since Phase 1 with nothing driving them. The sweep engine (20) processes runs that already exist — but nothing created a `follow_up_runs` row either, so on its own the sweep would have nothing to ever act on. Workflow 21 is the missing piece: it's how a sequence actually gets started for a specific lead.

## What this does NOT solve
- **Nothing enrolls leads into a sequence automatically.** Workflow 21 is only reachable by calling its webhook by hand, so a sequence sends nothing until a run has been started for a lead. This is the main remaining gap in the follow-up feature.
- **Sequences are authored in the dashboard (`/dashboard/follow-ups`).** It reads and writes `follow_up_sequences` directly under RLS, with no n8n webhook involved. Hand-authoring via SQL still works. Steps look like:
  ```json
  [
    { "day_offset": 0, "channel": "email", "subject": "Great speaking with you", "body": "Hi {{contact_name}}, ..." },
    { "day_offset": 3, "channel": "email", "subject": "Following up", "body": "Hi {{contact_name}}, ..." }
  ]
  ```
  Note: this is a literal `subject`/`body`-per-step shape, not the `template` key name shown in migration `0005`'s original comment — a deliberate simplification (see "Design decisions" below).
  What the dashboard enforces before saving, because of how the sweep reads `steps`: steps are saved sorted by `day_offset` (runs track progress by array position, so order is load-bearing); each step needs its own day (0 to 365); `subject` and `body` are required; and only `{{contact_name}}` is allowed as a placeholder, since anything else would be sent to the contact as written. `channel` is always saved as `"email"`; the sweep doesn't read it. `day_offset` counts from when the run started, not from the previous step.
- **Deactivating a sequence only blocks new runs.** Workflow 21 checks `is_active`, but the sweep's due-runs query doesn't, so runs already in progress finish (or stop when the contact replies). The dashboard says so on the card.
- **Editing steps under in-flight runs can skip or repeat a message.** Runs store `current_step_index`, so inserting or removing a step ahead of that index shifts what "next" means. Appending steps at the end is safe. The editor warns when a sequence has runs in progress.
- **Advancing the sequence doesn't wait for actual approval/send.** If a step lands in `email_drafts` as `pending` (approval-required mode) and a human hasn't approved it yet, the *next* step still gets scheduled on time regardless. Drafts can pile up in the approvals queue while the sequence keeps marching forward. Documented, not silently hidden — fixing it properly would mean editing workflow `15` (already live in production) to report back when a send actually happens, which is out of scope here.
- **Autonomous send has the same single-shared-Gmail-credential limitation as everywhere else** in this codebase (15/16/18) — one workflow-level credential, not dynamic per-tenant resolution.

## Design decisions worth knowing
- **Content is literal, tenant-authored text, not Claude-drafted.** This is an unattended, scheduled process with no per-send human review in autonomous mode — letting an LLM freely generate outbound cold-follow-up content with no review gate felt like the wrong default for something that runs on a timer with nobody watching. The *engine's* job is state-machine logic (who's due, did they reply, what's next); content is the tenant's responsibility, authored once when the sequence is created. Only `{{contact_name}}` substitution is supported.
- **Every send — autonomous or approval-gated — creates an `email_drafts` row.** Reuses the existing approval-gate system end to end rather than building a parallel one: `status='pending'` surfaces in the dashboard's existing Pending Approvals screen for free, `status='auto_sent'` is still a full audit record. This directly matches the project's stated core design principle (every AI decision/action logged), and required only a small additive migration (`0018`: a `follow_up` category value, a nullable `follow_up_run_id` traceability column) rather than new schema.
- **"Contact replied" is checked fresh on every sweep**, not cached: any inbound message (`role='user'`) in any conversation for that contact created after the run started. If true, the run stops — no further steps send.
- **The big due-runs query is deliberately one round trip**, joining `follow_up_sequences`, `leads`, `contacts`, and `ai_config`, with the "replied" check as a correlated subquery in the same `SELECT`. Chaining separate Postgres nodes for each piece would either strip fields (a `RETURNING` clause replaces `$json` with only those columns — bit this project before, see `KNOWN_ISSUES.md`/lessons) or vanish the item entirely on a zero-row match. One query avoids both traps.
- **Workflow 21's resolver query uses scalar subqueries, not a JOIN**, for the same zero-rows-vanishes-the-item reason — it always returns exactly one row, with `tenant_id`/`lead_id`/`sequence_id` coming back `NULL` (not "no row at all") when something doesn't match, so the next node can always branch cleanly on what's missing.

## Workflow 21 — Start Follow-Up Run
**Trigger:** internal webhook (`POST /start-follow-up`), not linked anywhere public, same convention as `19`.
**Input:** `{ tenant_slug, lead_id, sequence_id }`
**Output:** `{ success: true, run_id, next_run_at }` or a clean error (404 tenant/lead/sequence not found or inactive, 409 a run is already active for this lead+sequence, 422 sequence has no steps).

## Workflow 20 — Follow-Up Sweep
**Trigger:** cron, every 15 minutes (matches `docs/architecture.md` section 4 — adjust directly in the n8n trigger node, no code change needed).
**Per due run, one of three outcomes:**
| Outcome | Condition | Result |
|---|---|---|
| Stop | contact replied since run started | `status='stopped'`, `stop_reason='contact_replied'` |
| Complete | no more steps in the sequence | `status='completed'` |
| Send | otherwise | insert `email_drafts` row, send now if autonomous, advance to next step (or complete if this was the last one) |

**Credentials required:** the shared Postgres credential (same as everywhere else), and the same Gmail OAuth2 credential already used by workflow `15`/`18` for the autonomous-send path (`Send via Gmail` node — only fires when `ai_config.autonomy_rules.send_follow_up.mode === 'autonomous'`; defaults to `approval_required` when that key is absent, which it is for every tenant onboarded via `19` so far).

## Error paths
- Gmail send failure (`continueOnFail: true`) never loses the draft — it's already inserted before the send attempt — and the run still advances regardless (see the advance-without-waiting-for-send limitation above).
- A sweep capped at 25 due runs per execution, so a large backlog spreads across multiple 15-minute sweeps rather than overloading one execution.
