# n8n scheduled workflows: how often they run

n8n Cloud counts every run of a workflow as an execution, even a run that
finds nothing to do. Until there are paying agencies the schedules are kept
slow, which cuts about 600 runs a day to about 120. None of these workflows
writes with AI; the only AI call is the health check's one-token "ping".

| Workflow | Runs | Was | What a slower schedule means |
|---|---|---|---|
| 20 Follow-up sweep | every hour | 15 min | A follow-up due "in 2 days" can go out up to an hour later. Up to 25 steps per run. |
| 29 Auto-enrol follow-ups | every hour | 15 min | A quiet lead is enrolled up to an hour later. |
| 23 CRM sync sweep | every 30 min | 5 min | New leads reach an agency's CRM up to 30 minutes later; 5 retries now span about 2.5 hours. |
| 33 Health check | every hour | 15 min | A broken key or login is reported up to an hour later. "Stale" adapts to the gap (0037), so the hourly rhythm is not reported as stale. |
| 42 ASARI sync | every hour | — | Deactivate in n8n while no agency uses ASARI (this also turns off its "Sync now" webhook). Activate it again before connecting an agency's ASARI. |
| 31, 36, 38, 43 | once a day | — | Unchanged. |

The trigger nodes keep their old names ("Every 15 Minutes", "Every 5
Minutes") so tests and the live workflows still match by name.

Change a schedule in n8n directly: open the workflow, open the trigger node,
change the interval, then Save and Publish. No re-import needed. Keep this
file and the workflow JSON in the repository in step.

**When agencies are live,** tighten 23 back to 5–10 minutes (agencies expect
leads in their CRM quickly) and 33 back to 15 minutes.

**Uptime monitors** (UptimeRobot on `GET /webhook/health`) also run workflow
33 on every check: set the monitor to 30–60 minutes, not 5.
