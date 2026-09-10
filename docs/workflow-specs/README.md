# n8n Workflow Specs

One markdown file per workflow, written alongside (not always strictly before, in practice) the workflow it documents. Each spec covers:

- Trigger
- Inputs
- Nodes (in order, with config)
- Data passed between nodes
- Credentials required
- Error paths
- Expected output

Specs exist for: `01` (main AI agent), `08`/`09` (knowledge ingestion/retrieval), `10` (lead capture), `11`/`12` (availability/booking), `18` (demo request intake), `19` (tenant onboarding).

**Gap:** workflows `13`–`17` (email classify, draft, send, inbound trigger, manual send) are built and working but have no spec doc — they were built in a fast stretch (Phase 7) and the docs never caught up. Worth writing these retroactively at some point, mainly so a future you (or anyone else) doesn't have to reverse-engineer them from the JSON alone.
