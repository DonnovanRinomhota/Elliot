# n8n Workflow Specs

One markdown file per workflow, written alongside (not always strictly before, in practice) the workflow it documents. Each spec covers:

- Trigger
- Inputs
- Nodes (in order, with config)
- Data passed between nodes
- Credentials required
- Error paths
- Expected output

Specs exist for every workflow in the codebase: `01` (main AI agent), `08`/`09` (knowledge ingestion/retrieval), `10` (lead capture), `11`/`12` (availability/booking), `13`–`17` (the full email agent: classify, draft, send, inbound trigger, manual send), `18` (demo request intake), `19` (tenant onboarding), `20` (follow-up sweep — also covers `21`, its entry point), `22` (CRM sync — also covers `23`, its sweep counterpart), `24` (escalate to human), `25`–`28` (the WhatsApp agent: inbound trigger, draft, send, manual send — mirrors 13–17's shape against a separate `whatsapp_drafts` table, reusing `13` for classification since it's channel-agnostic).

No gaps remain as of 21 Sep 2026. `13`–`17` were the last ones missing before that — built fast in Phase 7, written up later once flagged. `25`–`28` (WhatsApp) are new and untested against a real Meta number — see ROADMAP.md.
